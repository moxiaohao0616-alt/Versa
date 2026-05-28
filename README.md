<div align="center">
  <img src="src-tauri/icons/icon-source.svg.png" width="120" alt="Versa logo" />
  <h1>Versa</h1>
  <p><strong>Easy Git for vibe coders</strong></p>
  <p>
    English · <a href="README.zh.md">中文</a>
  </p>
  <p>
    <a href="https://github.com/moxiaohao0616-alt/Versa/actions/workflows/check.yml"><img src="https://github.com/moxiaohao0616-alt/Versa/actions/workflows/check.yml/badge.svg" alt="check" /></a>
    <a href="https://github.com/moxiaohao0616-alt/Versa/actions/workflows/build.yml"><img src="https://github.com/moxiaohao0616-alt/Versa/actions/workflows/build.yml/badge.svg" alt="build" /></a>
    <a href="https://github.com/moxiaohao0616-alt/Versa/releases"><img src="https://img.shields.io/github/v/release/moxiaohao0616-alt/Versa?include_prereleases&sort=semver&label=release" alt="release" /></a>
    <a href="LICENSE"><img src="https://img.shields.io/github/license/moxiaohao0616-alt/Versa" alt="license" /></a>
  </p>
</div>

A Git GUI built for the AI coding era. AI writes your commit messages,
resolves your merge conflicts, explains old commits, and drafts your PRs —
using **your** provider keys, sent **directly** to the model, never through
our server. Plain language replaces git jargon throughout, and a real
multi-tab terminal is always one keystroke away when you need it.

> **Status**: developer preview. Stable on the common paths; bug surface
> around edges is real. Feedback and PRs welcome.

---

## Highlights

### 🤖 AI-native, BYO key

- **Commit messages from your staged diff** — one paragraph in your voice,
  hard-scoped to the active changelist.
- **3-way conflict recommender** — ours / theirs / both per hunk, with a
  one-sentence rationale.
- **Explain any commit** in plain English — pick a row in History, click ✨.
- **PR drafts** from a branch range (with linked-ticket context coming soon).
- Providers: Anthropic · OpenAI · DeepSeek · Kimi · any OpenAI-compatible.
  Keys live in this machine's localStorage; nothing routes through Versa.
  Streams are `Esc`-cancellable.

### 📦 JetBrains-style changelists

Park files you don't want in *this* commit. Pick one group as the **commit
target** — Save Progress hard-scopes to it, no more "wait, what's actually
getting committed?" AI commit-message generation respects the same scope.

### 🗂️ Multi-repo workspaces with quick-switch

Left dock of open repos (starred + recent, collapsible to icons). `⌘P` fuzzy
switcher. Each repo has isolated terminals, file lists, changelists, search
results — switching repos is a stateful jump, not a wipe.

### 🔎 Global content search

`⌘⇧F` opens a `git grep`-backed search across the workspace (every sub-repo
when in a monorepo). Regex, case, pathspec, inline-highlighted preview that
auto-scrolls to the clicked line.

### 🪜 Walk-through workflows, not button mashing

- **Reflog "Time Machine"** — every HEAD-moving op as a clickable row. Pick
  any past HEAD → "Go back here". The reset is itself logged, so you can
  undo with the same tool — the safety net most GUIs hide.
- **3-way merge editor** — ours / base / theirs columns + sync-scrolling
  merged-result preview + post-resolve review screen. Same UI for rebase,
  revert, cherry-pick.
- **Bisect** with an AI-suggested starting commit and one-click good / bad /
  skip.
- **Interactive rebase** drag-and-drop, drop / squash / reword.

### 🧱 Built for big repos

Rust + libgit2 data plane. Virtualized 10k+ line diffs. Adaptive commit-graph
lane width keeps 30 concurrent branches readable. Per-repo state isolated to
the active tab so switching repos doesn't thrash.

### 💬 Plain language, real git underneath

"Save progress" instead of "git commit". "This commit is good / bad" instead
of "git bisect good / bad". "Go back to this step" instead of "git reset
--hard". `⌘\`` opens a multi-tab xterm at the repo root for anything the GUI
can't say — never trapped.

### Other touches

- Folder tree view for staged/unstaged lists · hunk-level staging
- Side-by-side diff with word-level highlight
- Untracked files marked **N** (not the ambiguous `?`)
- Open any folder — non-git folders offer `git init` with a batteries-included
  `.gitignore` (Node / Rust / Python / Java / Android / iOS / Flutter / Go / C++)
- Hide vim swap / `.DS_Store` / emacs lockfiles from the unstaged list by default
- Optional GPG / SSH commit signing
- Bilingual UI (English / 中文) — follows OS language

---

## What's stable vs experimental

Versa is still pre-1.0 — here's what to trust as a first-time user.

**Stable** — common paths are well-tested; treat these as production-ready:

- File / hunk staging · commit · push · pull · fetch
- Branch list / create / switch / delete / rename / tag lifecycle · stash
- History view (graph + per-commit kebab) · commit detail (files + diff) · file & block history
- Diff viewer (unified + synced side-by-side · word-level · ignore whitespace)
- Multi-tab xterm at repo root · multi-repo workspaces (`⌘P`, drag-reorder, `⌘1-9`)
- Global content search (`⌘⇧F`, matches contents + filenames + untracked files)
- Open / `git init` any folder with a batteries-included `.gitignore`
- Bilingual UI

**Experimental** — works, but rough edges or recent additions:

- 3-way merge / rebase / revert / cherry-pick editor (handles the common cases; weird whitespace / encoding may surprise)
- Interactive rebase drag-and-drop (use the reflog if you regret a step)
- Bisect with AI-suggested starting commit (heuristic — verify the result)
- AI features (commit message · explain · review · conflict · PR draft) — quality varies per provider; markdown output still being tuned
- Reflog "Time Machine" — undo is reliable; advanced restore scenarios are best-effort
- Changelists — the parking-lot scoping works; edge cases when files move between groups
- Versa Cloud sign-in — client ships, backend not yet deployed
- Branch filter on History · drag-reorder repos · pre-commit AI explain (all very recent)

First-time users: stay on the **Stable** list. The Experimental items still ship working code, just with a higher "huh, that's weird" rate.

---

## Install

### Pre-built binaries

From [Releases](https://github.com/moxiaohao0616-alt/Versa/releases):

- **macOS**: `Versa_*_aarch64.dmg` — **Apple Silicon (M-series) only**;
  Intel build is not currently shipped.
- **Linux**: `.AppImage` / `.deb` / `.rpm`
- **Windows**: `*-setup.exe`

> **macOS first launch.** Code signing is still pending, so the OS will
> block the app the first time. Right-click → Open works for most users.
> If macOS still refuses with *"Versa.app is damaged and can't be opened"*,
> strip the quarantine attribute:
>
> ```bash
> sudo xattr -r -d com.apple.quarantine /Applications/Versa.app
> ```

### From source

```bash
# Requires Rust stable + Node 18+
# Linux deps: sudo apt install libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf libssl-dev

git clone https://github.com/moxiaohao0616-alt/Versa.git
cd Versa
npm install
npm run tauri dev     # hot-reload dev
npm run tauri build   # production bundle
```

---

## Configuring AI

**Settings → AI provider**, paste your key. The key lives in this machine's
localStorage only; requests go directly to the provider — Versa never sees
them.

| Provider | Default model |
| --- | --- |
| Anthropic Claude | `claude-sonnet-4-6` |
| OpenAI | `gpt-4o-mini` |
| DeepSeek | `deepseek-chat` |
| Kimi (Moonshot) | `moonshot-v1-32k` |
| OpenAI-compatible | _you supply_ |

If a changelist is active, AI commit-message generation + AI review narrow to
that group automatically.

---

## Keyboard

Press `?` in-app for the full list. `⌘` = `Ctrl` on Windows / Linux.

| Key | Action |
| --- | --- |
| `⌘P` | Repo quick-switcher |
| `⌘⇧F` | Global content search |
| `⌘\`` | Toggle embedded terminal |
| `⌘↑ / ⌘↓` | Prev / next file in diff |
| `⌥↑ / ⌥↓` | Prev / next hunk in diff |
| `Esc` | Close modal · cancel AI stream |

---

## Contributing

Issues and PRs welcome. **About → Copy diagnostic info** gives you a
paste-ready system summary for bug reports.

## License

Apache 2.0 — see [LICENSE](LICENSE).

Built on [Tauri](https://tauri.app), [libgit2 / git2-rs](https://github.com/rust-lang/git2-rs),
[React](https://react.dev), [xterm.js](https://xtermjs.org). Thanks ❤️
