<div align="center">
  <img src="src-tauri/icons/icon-source.svg.png" width="120" alt="Versa logo" />
  <h1>Versa</h1>
  <p><strong>Easy Git for Everyone</strong></p>
  <p>
    <a href="https://github.com/moxiaohao0616-alt/Versa/actions/workflows/check.yml"><img src="https://github.com/moxiaohao0616-alt/Versa/actions/workflows/check.yml/badge.svg" alt="check" /></a>
    <a href="https://github.com/moxiaohao0616-alt/Versa/actions/workflows/build.yml"><img src="https://github.com/moxiaohao0616-alt/Versa/actions/workflows/build.yml/badge.svg" alt="build" /></a>
    <a href="https://github.com/moxiaohao0616-alt/Versa/releases"><img src="https://img.shields.io/github/v/release/moxiaohao0616-alt/Versa?include_prereleases&sort=semver&label=release" alt="release" /></a>
    <a href="LICENSE"><img src="https://img.shields.io/github/license/moxiaohao0616-alt/Versa" alt="license" /></a>
  </p>
</div>

**Versa is a Git client built for the vibe-coding era** — for engineers
who spend most of their day pairing with Cursor, Claude Code, Copilot,
or any other AI coding partner, and want a Git GUI that fits *that*
workflow instead of the 2014 one. Generate commit messages from the
staged diff, get a real recommendation on a 3-way merge conflict, park
the files you don't want in this commit into a changelist, walk through
hairy operations (rebase, bisect, reflog rewind) without leaving the UI.
Every git verb is translated into something a human says — "save
progress", "this commit is good / bad", "go back to this step" — without
ever hiding the real command underneath. When you'd rather drop to a
shell, ⌘\` opens a multi-tab xterm at the repo root.

> **Status: developer preview.** Builds on macOS, Linux and Windows. The
> happy paths are stable; bug surface around edge cases is still real.
> Feedback and PRs very welcome.

---

## Why Versa

Most Git GUIs either bind you to one editor (heavy IDE plugins) or paper
over what git is actually doing (SourceTree / GitKraken Free / Tower).
Versa picks a different lane — and earns each line below by being
something the others aren't:

- **AI commit messages, AI conflict resolution — BYO key, no Versa
  server in the loop.** Generate commit messages from the staged diff,
  get a "use ours / theirs / both" recommendation with a one-sentence
  rationale on a real 3-way merge conflict, ask "what does this commit
  do?" in plain English. Anthropic, OpenAI, DeepSeek, Kimi, or any
  OpenAI-compatible endpoint — your key only lives in this machine's
  localStorage. Code, diffs and API keys never leave the box.
- **Changelists for selective commits.** Park files you don't want in
  *this* commit into a custom group (drag-and-drop between groups,
  including whole folders in tree mode). Designate any group as the
  "commit target" and **Save Progress is hard-scoped to it** — only
  those files end up in the commit, regardless of what else is staged.
  AI commit-message generation respects the same scope.
- **A 3-way conflict editor that doesn't punt to your IDE.** Inline
  ours / base / theirs columns with per-hunk "use mine / theirs / both /
  neither", a live merged-result preview that **scrolls in sync** with
  whichever hunk you're inspecting, and once everything is resolved a
  review screen with the full staged diff — see exactly what's about to
  ship before clicking "Finish merge".
- **Multi-tab terminal at the repo root.** ⌘\` toggles a real xterm with
  per-repo tabs that survive panel toggles AND repo switches. The UI
  walks you through hairy workflows; when you'd rather drop to git CLI,
  you're one keystroke away.
- **Rust + libgit2 for the data plane.** Native libgit2 instead of
  shelling out for every status call, virtualized diff rendering keeps
  10K+ line diffs scrollable, and the commit-history graph auto-compresses
  lane spacing so a repo with 30 concurrent branches still reads cleanly.
- **Reflog "Time Machine".** Every HEAD-moving operation (commit, checkout,
  reset, rebase, pull, cherry-pick…) is a clickable row with a friendly
  2-char verb chip. Pick any past HEAD, hit "Go back here", done. The reset
  itself is logged, so you can undo with the same tool — it's the safety
  net most GUIs don't even surface.
- **Bisect + Interactive rebase as guided workflows.** Drag-and-drop rebase
  with drop / squash / reword; bisect with an AI-suggested starting commit
  read from recent commit messages and one-click good / bad / skip.
- **Multi-tab repo management.** Each repo runs in its own tab with
  isolated state — file lists, terminals, changelists, AI streams all
  scoped per tab.
- **Free, open source, no tiers.** Apache 2.0; no "GitKraken Pro for
  private repos", no Tower subscription, no contributor agreement. An
  optional Versa Cloud is in the works for cross-machine settings sync
  + reflog backup — the local client will always stay free and offline-only.
- **Bilingual UI (Chinese / English) out of the box.** First-class
  internal i18n that follows your OS language, not a community
  translation plugin.

## Key features

<details open><summary><b>Everyday git, but readable</b></summary>

- Working-tree → stage → commit → push with live progress bars
- **Hunk-level staging** — pick the change, not the file
- **Folder tree view** for staged/unstaged lists (Settings → General toggle),
  flat list otherwise; per-folder collapse state survives working-tree refresh
- Multi-tab repo management with per-tab state snapshots
- Click any file path in the diff header to copy its absolute path (paste into
  IDE, Finder, terminal — no more selecting Next.js route segments by hand)
- Multi-tab embedded xterm (⌘\`) for the moments you do want CLI

</details>

<details open><summary><b>Changelists — JetBrains-style selective commits</b></summary>

- Per-repo file groups inside the Unstaged list, persisted to localStorage
- Default group is the next-commit inbox; new file changes always land there
- Create custom groups ("Later", "Lint fixes", etc.) to **park** files you
  don't want in this commit
- Set any group as the **commit target** (☆ star button); `Save Progress`
  hard-scopes to that group via a new `save_progress_pathspec` backend command
- AI commit-message + AI review honor the same scope — the message
  describes only what's actually about to be committed
- Drag files OR whole folders (in tree view) between groups
- Custom groups stay visible even when empty (delete via 🗑 button)

</details>

<details open><summary><b>Commit history, as a first-class view</b></summary>

- Full-page graph view, not a sub-tab on the side
- **Adaptive lane width** — the graph compresses itself when a repo has
  many concurrent branches so the message column always stays readable
- Per-commit kebab: checkout, revert, cherry-pick, tag, reset, hard reset
- Search by message / author / time-range, load-more with on-demand "load all"
- Click a commit → see its files in the sidebar, click a file → see its diff

</details>

<details open><summary><b>3-way merge that doesn't make you cry</b></summary>

- Inline ours / base / theirs columns with **per-hunk** "use mine / theirs /
  both / neither"
- Live **merged-result preview** with a draggable splitter — defaults to half
  the window, syncs scroll position to whichever hunk you're inspecting,
  highlights the current hunk's region in green
- When every conflict is resolved, swap to a **review screen** that shows the
  full staged diff (file-by-file, expandable) — see exactly what's about to
  ship before clicking "Finish merge"
- AI can read the conflict and recommend ours / theirs / both with a
  one-sentence rationale
- Works for merge, rebase, revert and cherry-pick — same UI, mode-aware labels
- Detects nested git repos in the working tree and explains them instead of
  failing the commit silently

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
- **Reflog "Time Machine"** — every HEAD-moving operation (commit, checkout,
  reset, rebase, pull, cherry-pick…) gets a friendly 2-char verb chip with
  the raw reflog token on hover. Pick any past HEAD position and
  `git reset --hard` back; the reset itself is logged, so you can undo with
  the same tool
- Per-line Blame view with author, timestamp and commit summary

</details>

<details open><summary><b>Submodules + Git LFS</b></summary>

- List / add / init / update / sync / deinit / fully remove submodules
- LFS install detection, tracked-pattern editor, ls-files view, pull / fetch

</details>

<details open><summary><b>Diff viewer optimized for big files</b></summary>

- Virtual scrolling (10k+ line diffs still snappy)
- Side-by-side or unified layout (Settings → Diff toggle)
- Word-level inline highlighting (toggleable)
- Ignore whitespace toggle
- ⌘F search inside the diff with navigation and highlight
- Syntax highlighting for 19 common languages

</details>

<details open><summary><b>Embedded terminal (multi-tab)</b></summary>

- ⌘\` toggles a bottom panel with xterm.js + a real PTY (zsh / bash / etc.)
- **Per-repo tab strip**: every repo keeps its own list of terminal tabs.
  Switching repos shows that repo's tabs; switching back restores them.
- Sessions survive panel toggle (`⌘\`` close + reopen → tabs intact)
- One-click new (+) / close (×) on every tab
- Honors the user's `$SHELL` and login files so `$PATH` / aliases just work

</details>

<details open><summary><b>AI integration (BYO API key, streaming)</b></summary>

- Providers: Anthropic Claude · OpenAI · DeepSeek · Kimi · any OpenAI-compatible
- **Streaming with `Esc` to cancel** mid-generation; total read-timeout is
  120s of *silence*, not 60s of total request time — large diffs no longer
  get axed mid-thought
- Generate commit messages from the staged diff (respects the active changelist)
- AI code review of the about-to-commit diff (also respects active changelist)
- Explain any commit "in plain English"
- 3-way conflict recommender (ours / theirs / both) with rationale
- Suggest a bisect starting commit
- AI-drafted PR description from a branch range + commit list

</details>

<details><summary><b>Versa Cloud (preview — client-side only, no backend yet)</b></summary>

The local client ships an opt-in Cloud sign-in flow built on top of Tauri's
OS keychain (macOS Keychain / Linux secret-service / Windows Credential
Manager). The backend (`api.versago.app`) is not deployed yet, so the
sign-in button currently only works against a `wrangler dev` localhost.

When the backend ships, Cloud will provide:

- Cross-machine sync of UI settings, prompt templates, keymap (**never**
  source code, **never** AI API keys)
- Reflog backup for cross-device "where did that commit go" recovery
- Optional managed AI Gateway with prompt-cache pricing for users who
  don't want to manage provider keys themselves

The local client stays **forever free, fully functional offline, with the
same privacy guarantees**. Cloud is an opt-in convenience.

</details>

<details open><summary><b>Quality-of-life</b></summary>

- Bilingual (English / Chinese) UI, language switch in Settings
- First-launch onboarding tour
- Keyboard cheatsheet (`?`) and many shortcuts
- Settings import / export as JSON for moving between machines
- Optional GPG / SSH commit signing
- Right-side aux panel: project runner, AI explain, stash quick-view
- About modal + error toasts both have a one-click **"copy diagnostic info"**
  button so bug reports come with `versa / tauri / libgit2 / OS` versions
  pre-filled
- Auto-updater (when notarized builds are available)

</details>

---

## Install

### Pre-built binaries

Grab the latest from [Releases](https://github.com/moxiaohao0616-alt/Versa/releases):

- **macOS**: `Versa_*_aarch64.dmg` (Apple Silicon). Intel `.dmg` lands when
  we re-add the macOS x64 CI runner.
- **Linux**: `Versa_*.AppImage`, `.deb` or `.rpm`
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

## Keyboard cheatsheet

Press `?` anytime for the full sheet. Highlights (`⌘` is `Ctrl` on Windows / Linux):

| Key | What it does |
| --- | --- |
| `?` | Open this cheatsheet |
| `Esc` | Close the current modal · cancel the active AI stream |
| `⌘\`` | Toggle the embedded terminal panel |
| `⌘W` | Close the current repo tab |
| `⌘⇧] / ⌘⇧[` | Next / previous repo tab |
| `⌘F` | Search inside the current diff |
| `⌘↑ / ⌘↓` | Previous / next **file** in the diff |
| `⌥↑ / ⌥↓` | Previous / next **hunk** in the diff |

## Configuring AI

Versa never sees your code unless you give it an API key. To enable AI features:

1. Open **Settings → AI provider**
2. Pick your provider and paste a key. The key only ever lives in
   your machine's `localStorage`; it never crosses the network except
   directly to the provider you chose.
3. Optionally pick a specific model — defaults are reasonable:

| Provider | Default model | Notes |
| --- | --- | --- |
| Anthropic Claude | `claude-sonnet-4-6` | best quality / costliest |
| OpenAI | `gpt-4o-mini` | cheap and fast |
| DeepSeek | `deepseek-chat` | strong code reasoning, low cost |
| Kimi (Moonshot) | `moonshot-v1-32k` | huge context window |
| OpenAI-compatible | _you supply_ | for vLLM, Ollama, Together, Groq, etc. |

If you have a changelist set as the commit target, AI commit-message
generation and AI review automatically narrow their scope to that
group's files — the model describes only what's about to ship, not your
half-baked drafts in other groups.

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
│   portable-pty for the multi-session terminal       │
│   keyring for OS-native token storage (Cloud)       │
│   notify for filesystem watch & auto-refresh        │
└─────────────────────────────────────────────────────┘
```

- **`src/`** — UI; one component per folder, single Zustand store + a small
  per-feature one (`cloud`, `changelists`), hot reload
- **`src-tauri/src/commands.rs`** — every Git operation as a Tauri command
- **`src-tauri/src/cloud/`** — Cloud client (sign-in, sync, token storage)
- **`src-tauri/src/pty.rs`** — multi-session PTY registry
- **`src-tauri/src/watcher.rs`** — fs watcher → `repo:changed` events
- **`src/i18n/`** — zh + en resource files; default language follows OS
- **`docs/`** — `RELEASE.md` (signing & publishing), `PERFORMANCE.md` (perf audit)

## Roadmap status

The `v0.x` work is largely done — see [Releases](https://github.com/moxiaohao0616-alt/Versa/releases)
for shipped versions. What's done vs. what's still cooking before a public 1.0:

**Shipped**

- ✅ Hunk staging · Tag mgmt · Reflog · Blame · Reset · Fetch · Remotes · Submodules · LFS
- ✅ Interactive rebase (drag-and-drop, drop / squash / reword)
- ✅ Bisect (with AI start-commit suggestion)
- ✅ AI streaming with Esc-cancel, multi-provider (Anthropic / OpenAI / DeepSeek / Kimi / compatible)
- ✅ 3-way conflict editor with live preview, sync-scroll, AI hint, post-resolve review screen
- ✅ Adaptive commit graph (auto lane compression)
- ✅ Side-by-side diff layout, switchable per-user
- ✅ **Changelists** (JetBrains-style parking-lot groups, drag-drop, active commit target)
- ✅ **Multi-tab terminal** (per-repo, preserved across switches)
- ✅ **Folder tree view** for staged/unstaged lists
- ✅ AI scope automatically narrows to the active changelist
- ✅ Linux / Windows CI matrix · auto-updater · macOS arm64 (built locally)
- ✅ Bilingual UI (en / zh), error boundary, diagnostic copy
- ✅ Cloud client (Tauri side): device pairing, settings sync, OS-keychain token storage

**In progress**

- 🚧 Versa Cloud backend (Workers + D1 + Hono) — client ready, server not yet deployed
- 🚧 macOS code signing + notarization (needs Apple Developer ID)
- 🚧 Windows code signing (needs SmartScreen cert)
- 🚧 macOS x64 / Linux ARM CI runners
- 🚧 GraphView virtualization for 50k+ commit repos
- 🚧 Full i18n sweep across all components (resource files ready)

**Looking further**

- 🔭 In-app issue tracker integration (GitHub Issues / Jira)
- 🔭 AI PR description with linked-ticket context
- 🔭 Versa Cloud AI Gateway (managed prompt-cache layer for teams)

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
