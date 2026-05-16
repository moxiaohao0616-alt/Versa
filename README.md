<div align="center">
  <img src="src-tauri/icons/icon-source.svg.png" width="120" alt="Versa logo" />
  <h1>Versa</h1>
  <p><strong>Easy Git for Everyone</strong></p>
  <p>
    <a href="https://github.com/moxiaohao0616-alt/Versa/actions/workflows/check.yml"><img src="https://github.com/moxiaohao0616-alt/Versa/actions/workflows/check.yml/badge.svg" alt="check" /></a>
    <a href="https://github.com/moxiaohao0616-alt/Versa/actions/workflows/build.yml"><img src="https://github.com/moxiaohao0616-alt/Versa/actions/workflows/build.yml/badge.svg" alt="build" /></a>
    <a href="https://github.com/moxiaohao0616-alt/Versa/releases"><img src="https://img.shields.io/github/v/release/moxiaohao0616-alt/Versa?include_prereleases&label=release" alt="release" /></a>
    <a href="LICENSE"><img src="https://img.shields.io/github/license/moxiaohao0616-alt/Versa" alt="license" /></a>
  </p>
</div>

Versa is a desktop Git client built for full-stack engineers who want a fast,
opinionated UI without leaving the speed and depth of the command line.
Every git verb is translated into something a human says — "save progress",
"this commit is good / bad", "go back to this step" — without ever hiding the
real thing underneath.

> **Status: developer preview.** It builds on macOS, Linux and Windows, but
> bug surface is still wide. Feedback and PRs welcome.

---

## Why

Most Git GUIs land in one of two buckets:

- _Heavy IDE plugins_ that bind you to one editor and feel sluggish.
- _Visual git wrappers_ (SourceTree, GitKraken Free, Tower) that tell you
  the verbs but not the consequences.

Versa is the third option: **a standalone app that respects you know what
git is doing**, but renders the moves so you stop staring at man pages.

## Key features

<details open><summary><b>Everyday git, but readable</b></summary>

- Working-tree → stage → commit → push with progress
- **Hunk-level staging** — pick the change, not the file
- Multi-tab repo management with per-tab state snapshots
- Visual graph view with lane rendering, search and load-more
- Embedded xterm.js terminal for the moments you do want CLI

</details>

<details open><summary><b>3-way merge that doesn't make you cry</b></summary>

- Inline side-by-side conflict view with "use ours / theirs / both"
- Per-hunk choice — not just per-file
- Detects nested git repos and explains them instead of failing silently

</details>

<details open><summary><b>Branch, tag, remote management</b></summary>

- Full Tags lifecycle (lightweight + annotated, push, delete remote)
- Branch rename / delete / force-delete with "type the name to confirm"
- Remote add / rename / change URL / remove
- Independent **Fetch** (no auto-merge) and **Reset** (soft / mixed / hard)

</details>

<details open><summary><b>Interactive rebase you can actually understand</b></summary>

- Drag-and-drop to reorder
- Pick / squash / reword / drop with inline message editor
- Clear rollback at every step

</details>

<details open><summary><b>Bisect with AI assist</b></summary>

- One-button "this is good / bad / skip"
- Jump straight from the bisect banner to the current candidate's diff
- AI can suggest a starting commit by reading recent commit messages

</details>

<details open><summary><b>Stash, reflog, blame</b></summary>

- First-class Stash UI with apply / pop / drop and two-step confirm
- **Reflog "Time Machine"** — browse and `git reset --hard` to any past HEAD
  position; the reset itself is logged, so you can undo with the same tool
- Per-line Blame view with author, timestamp and commit summary

</details>

<details open><summary><b>Submodules + Git LFS</b></summary>

- List / add / init / update / sync / deinit / fully remove submodules
- LFS install detection, tracked-pattern editor, ls-files view, pull / fetch

</details>

<details open><summary><b>Diff viewer optimized for big files</b></summary>

- Virtual scrolling (10k+ line diffs still snappy)
- Word-level inline highlighting (toggleable)
- Ignore whitespace toggle
- ⌘F search inside the diff with navigation and highlight
- Syntax highlighting for 19 common languages

</details>

<details open><summary><b>AI integration (BYO API key)</b></summary>

- Providers: Anthropic Claude · OpenAI · DeepSeek · Kimi · any OpenAI-compatible
- **Streaming with `Esc` to cancel** mid-generation
- Generate commit messages from the staged diff
- Explain any commit "in plain English"
- Pre-merge conflict risk report
- Suggest a bisect starting commit

</details>

<details open><summary><b>Quality-of-life</b></summary>

- Bilingual (English / 中文) UI, language switch in Settings
- First-launch onboarding tour
- Keyboard cheatsheet (`?`) and many shortcuts
- Settings import / export as JSON for moving between machines
- Optional GPG / SSH commit signing
- Right-side aux panel: project runner, AI explain, stash quick-view
- About modal with one-click diagnostic copy for bug reports

</details>

---

## Install

### Pre-built binaries

Grab the latest from [Releases](https://github.com/moxiaohao0616-alt/Versa/releases):

- **macOS**: `Versa_*.dmg` (Apple Silicon and Intel separate)
- **Linux**: `Versa_*.AppImage` or `.deb`
- **Windows**: `Versa_*-setup.exe`

> macOS until we ship code signing, first launch will hit Gatekeeper —
> right-click → Open. We're tracking [Apple notarization](docs/RELEASE.md)
> for an upcoming release.

### From source

```bash
# 1. Toolchain
#   - Rust stable (https://rustup.rs)
#   - Node 18+

# 2. Platform deps
#   macOS:    xcode-select --install
#   Linux:    sudo apt install libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf libssl-dev
#   Windows:  Microsoft Edge WebView2 runtime (preinstalled on Win11)

git clone https://github.com/moxiaohao0616-alt/Versa.git
cd Versa
npm install
npm run tauri dev     # hot-reload dev shell
npm run tauri build   # production bundle in src-tauri/target/release/bundle/
```

## Configuring AI

Versa never sees your code unless you give it an API key. To enable AI features:

1. Open **Settings → AI 服务商 / AI provider**
2. Pick your provider and paste a key. The key only ever lives in
   your machine's `localStorage`; it is never sent to a Versa server
   (there is no Versa server).
3. Optionally pick a specific model — defaults are reasonable:

| Provider | Default model | Notes |
| --- | --- | --- |
| Anthropic Claude | `claude-sonnet-4-6` | best quality / costliest |
| OpenAI | `gpt-4o-mini` | cheap and fast |
| DeepSeek | `deepseek-chat` | strong code reasoning, low cost |
| Kimi (Moonshot) | `moonshot-v1-32k` | huge context window |
| OpenAI-compatible | _you supply_ | for vLLM, Ollama, Together, Groq, etc. |

If you don't configure AI, the rest of Versa works fine.

## Architecture

```
┌─────────────────────────────────────────────────────┐
│           React 18 + TypeScript + Zustand           │
│   (xterm.js, highlight.js, react-i18next, vite)     │
└────────────────────────┬────────────────────────────┘
                         │  Tauri IPC (commands + events)
┌────────────────────────┴────────────────────────────┐
│              Rust (src-tauri/) · Tauri 2            │
│   git2 (libgit2) · shell `git` for niches           │
│   reqwest + futures-util for SSE AI streaming       │
│   notify for filesystem watch & auto-refresh        │
└─────────────────────────────────────────────────────┘
```

- **`src/`** — UI; one component per folder, single Zustand store, hot reload
- **`src-tauri/src/commands.rs`** — every Git operation as a Tauri command
- **`src-tauri/src/watcher.rs`** — fs watcher → `repo:changed` events
- **`src/i18n/`** — zh + en resource files; default language follows OS
- **`docs/`** — `RELEASE.md` (signing & publishing), `PERFORMANCE.md` (perf audit)

## Roadmap status

The `v0.x` work is largely done — see [Releases](https://github.com/moxiaohao0616-alt/Versa/releases) for shipped versions. What's still cooking before a public 1.0:

- ✅ Hunk staging · Tag mgmt · Reflog · Blame · Reset · Fetch · Remotes · Submodules · LFS
- ✅ AI streaming with Esc-cancel, multi-provider
- ✅ macOS / Linux / Windows CI matrix
- ✅ Bilingual UI (en / zh), error boundary, auto-updater
- 🚧 macOS code signing + notarization (needs Apple Developer ID)
- 🚧 Windows code signing (needs SmartScreen cert)
- 🚧 GraphView virtualization for 50k+ commit repos
- 🚧 Full i18n sweep across all components (resource files ready)
- 🔭 Side-by-side diff layout, in-app issue tracker integration, cloud sync

## Tests

```bash
npm test                                    # 9 frontend tests
cargo test --manifest-path src-tauri/...    # 9 backend tests
```

CI runs both on every push and PR (`.github/workflows/check.yml`).

## Contributing

Issues and PRs are very welcome. The bar is "make a focused change, attach
a screenshot if it's UI" — no contributor agreement, no checklist.

If you find a bug, the **About → Copy diagnostic info** button gives you a
ready-to-paste system summary, the error toast and the error boundary also
expose the same shortcut.

## License

Apache 2.0 — see [LICENSE](LICENSE).

Versa stands on the shoulders of [Tauri](https://tauri.app),
[libgit2 / git2-rs](https://github.com/rust-lang/git2-rs),
[React](https://react.dev), [highlight.js](https://highlightjs.org), and
[xterm.js](https://xtermjs.org). Thanks ❤️
