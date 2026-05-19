//! Real PTY-backed terminal sessions.
//!
//! Each session owns a child shell process attached to a pseudo-terminal so
//! interactive programs (vim, less, top, `git rebase -i`, oh-my-zsh prompt
//! escape sequences, …) work like they do in iTerm / Alacritty / Windows
//! Terminal. Bytes from the PTY are streamed to the webview as base64 chunks
//! on a per-session event; keyboard input round-trips back through
//! `pty_write`.
//!
//! Sessions are owned by a global registry keyed by an opaque id the frontend
//! generates; this lets `<Terminal />` unmount/remount or live alongside
//! background tab work without losing state.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::Mutex;

use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use tauri::{AppHandle, Emitter, Runtime};

/// Live PTY session: master half + writer + child handle. We hand out
/// only the id; the registry keeps everything alive.
struct Session {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    #[allow(dead_code)]
    child: Box<dyn portable_pty::Child + Send + Sync>,
}

#[derive(Default)]
pub struct PtyRegistry(Mutex<HashMap<String, Session>>);

fn fe<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

/// Spawn a fresh PTY running the user's `$SHELL` (interactive) at `cwd`,
/// register it, and start the reader thread that pumps output to the
/// webview as `pty:out:<session_id>` events. Already-existing sessions
/// with the same id are silently replaced.
#[tauri::command]
pub fn pty_open<R: Runtime>(
    app: AppHandle<R>,
    state: tauri::State<'_, PtyRegistry>,
    session_id: String,
    cwd: String,
    rows: u16,
    cols: u16,
) -> Result<(), String> {
    // Idempotent: if the frontend ever calls open twice with the same id
    // (e.g. React strict-mode double mount, or accidental retry), don't
    // spawn a second shell. Returning Ok lets the caller proceed to attach
    // listeners to the already-running PTY.
    {
        let map = state.0.lock().unwrap();
        if map.contains_key(&session_id) {
            return Ok(());
        }
    }

    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: rows.max(2),
            cols: cols.max(2),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(fe)?;

    // Pick the user's shell; fall back to /bin/sh. `-l` so login files
    // (zprofile / bash_profile) source — this gets the user's PATH and
    // friends. We deliberately omit `-i` so the shell decides interactive
    // mode based on having a TTY (which we just gave it).
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".into());
    let mut cmd = CommandBuilder::new(&shell);
    cmd.arg("-l");
    // Fall back to $HOME if frontend doesn't have a repo path. We don't
    // want to inherit the app bundle's cwd (which is somewhere random).
    let resolved_cwd = if cwd.trim().is_empty() {
        std::env::var("HOME").unwrap_or_else(|_| "/".into())
    } else {
        cwd
    };
    cmd.cwd(&resolved_cwd);
    // Hint truecolor + 256 to anything reading $TERM. Most modern shells
    // and tmux/vim look better with this set.
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");

    let child = pair.slave.spawn_command(cmd).map_err(fe)?;
    drop(pair.slave); // slave fd no longer needed in this process

    let writer = pair.master.take_writer().map_err(fe)?;
    let reader = pair.master.try_clone_reader().map_err(fe)?;

    {
        let mut map = state.0.lock().unwrap();
        // Replace any existing session with this id (and dropping it
        // closes the previous PTY).
        map.insert(
            session_id.clone(),
            Session {
                master: pair.master,
                writer,
                child,
            },
        );
    }

    // Reader thread: blocks on read, emits chunks to the webview. We send
    // raw bytes as a base64 string so we don't have to assume UTF-8 (TUI
    // programs splatter arbitrary bytes).
    std::thread::spawn(move || {
        let mut reader = reader;
        let mut buf = vec![0u8; 8192];
        let event_name = format!("pty:out:{session_id}");
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let chunk = &buf[..n];
                    let encoded = base64_encode(chunk);
                    // Broadcast to all windows so the frontend listener
                    // can be in any of them.
                    let _ = app.emit(&event_name, encoded);
                }
                Err(_) => break,
            }
        }
        // Tell the frontend the child is gone so it can render an
        // [exit] notice or auto-reopen.
        let _ = app.emit(&format!("pty:exit:{session_id}"), ());
    });

    Ok(())
}

#[tauri::command]
pub fn pty_write(
    state: tauri::State<'_, PtyRegistry>,
    session_id: String,
    data: String,
) -> Result<(), String> {
    let mut map = state.0.lock().unwrap();
    let session = map.get_mut(&session_id).ok_or("session not found")?;
    // Frontend sends raw text (typed keystrokes / paste payload). PTY
    // expects bytes; UTF-8 is fine for everything we care about.
    session.writer.write_all(data.as_bytes()).map_err(fe)?;
    session.writer.flush().map_err(fe)?;
    Ok(())
}

#[tauri::command]
pub fn pty_resize(
    state: tauri::State<'_, PtyRegistry>,
    session_id: String,
    rows: u16,
    cols: u16,
) -> Result<(), String> {
    let map = state.0.lock().unwrap();
    let session = map.get(&session_id).ok_or("session not found")?;
    session
        .master
        .resize(PtySize {
            rows: rows.max(2),
            cols: cols.max(2),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(fe)?;
    Ok(())
}

#[tauri::command]
pub fn pty_close(
    state: tauri::State<'_, PtyRegistry>,
    session_id: String,
) -> Result<(), String> {
    let mut map = state.0.lock().unwrap();
    map.remove(&session_id); // Drop closes the master, which terminates the child.
    Ok(())
}

/// Tiny base64 encoder so we don't need to pull in the `base64` crate just
/// for one call. Standard alphabet, no padding-trimming surprises.
fn base64_encode(input: &[u8]) -> String {
    const ALPHA: &[u8; 64] =
        b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(input.len().div_ceil(3) * 4);
    let mut i = 0;
    while i + 3 <= input.len() {
        let n = ((input[i] as u32) << 16) | ((input[i + 1] as u32) << 8) | input[i + 2] as u32;
        out.push(ALPHA[((n >> 18) & 0x3f) as usize] as char);
        out.push(ALPHA[((n >> 12) & 0x3f) as usize] as char);
        out.push(ALPHA[((n >> 6) & 0x3f) as usize] as char);
        out.push(ALPHA[(n & 0x3f) as usize] as char);
        i += 3;
    }
    let rem = input.len() - i;
    if rem == 1 {
        let n = (input[i] as u32) << 16;
        out.push(ALPHA[((n >> 18) & 0x3f) as usize] as char);
        out.push(ALPHA[((n >> 12) & 0x3f) as usize] as char);
        out.push('=');
        out.push('=');
    } else if rem == 2 {
        let n = ((input[i] as u32) << 16) | ((input[i + 1] as u32) << 8);
        out.push(ALPHA[((n >> 18) & 0x3f) as usize] as char);
        out.push(ALPHA[((n >> 12) & 0x3f) as usize] as char);
        out.push(ALPHA[((n >> 6) & 0x3f) as usize] as char);
        out.push('=');
    }
    out
}
