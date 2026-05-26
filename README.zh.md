<div align="center">
  <img src="src-tauri/icons/icon-source.svg.png" width="120" alt="Versa logo" />
  <h1>Versa</h1>
  <p><strong>为 vibe coding 而生的轻量 Git</strong></p>
  <p>
    <a href="README.md">English</a> · 中文
  </p>
  <p>
    <a href="https://github.com/moxiaohao0616-alt/Versa/actions/workflows/check.yml"><img src="https://github.com/moxiaohao0616-alt/Versa/actions/workflows/check.yml/badge.svg" alt="check" /></a>
    <a href="https://github.com/moxiaohao0616-alt/Versa/actions/workflows/build.yml"><img src="https://github.com/moxiaohao0616-alt/Versa/actions/workflows/build.yml/badge.svg" alt="build" /></a>
    <a href="https://github.com/moxiaohao0616-alt/Versa/releases"><img src="https://img.shields.io/github/v/release/moxiaohao0616-alt/Versa?include_prereleases&sort=semver&label=release" alt="release" /></a>
    <a href="LICENSE"><img src="https://img.shields.io/github/license/moxiaohao0616-alt/Versa" alt="license" /></a>
  </p>
</div>

一款为 AI 编码时代打造的 Git GUI。AI 帮你写 commit message、解冲突、解释老
commit、起草 PR ——用**你自己的** API key，请求**直接**发给模型，绝不经过我们
的服务器。整个界面把 git 黑话翻译成人话，需要纯命令时一个快捷键就能呼出多
标签终端。

> **状态**：开发者预览版。常用路径稳定；边角场景仍有 bug。欢迎反馈和 PR。

---

## 核心亮点

### 🤖 AI 原生，自带 API key

- **从已暂存的 diff 直接生成 commit message** —— 一段你的语气的描述，严格限定
  在当前 changelist 范围内。
- **三方冲突推荐器** —— 每个 hunk 给"用我的 / 用他的 / 都要"建议，附一句理由。
- **解释任意 commit** —— 在 History 选一行，点 ✨，AI 把这次改动讲清楚。
- **PR 描述初稿** —— 从分支区间生成（带 Jira / Linear / GitHub Issue 上下文，
  规划中）。
- 支持的供应商：Anthropic · OpenAI · DeepSeek · Kimi · 任何兼容 OpenAI 协议的
  接口。Key 只存在本机 localStorage，**不经过** Versa 任何服务器。流式输出可
  随时 `Esc` 取消。

### 📦 JetBrains 风格 Changelist

把"这次提交不想带上"的文件停到独立 group 里。把任意 group 设为 **提交目标**，
"保存进度"就严格只提交这个 group——再也不会"咦我刚刚到底提交了什么"。AI 写
commit message 也遵守同样的范围。

### 🗂️ 多仓库工作区，秒切

左侧仓库 dock（收藏 + 最近，可折叠到只剩图标）。`⌘P` 模糊搜索。每个仓库的
终端、文件列表、changelist、搜索结果都是隔离的——切仓库是带状态的跳转，不是
清屏重来。

### 🔎 全工作区代码搜索

`⌘⇧F` 打开搜索弹窗，`git grep` 后端覆盖整个工作区（monorepo 时连子仓库一起
搜）。支持正则、大小写敏感、pathspec 过滤，结果点开右侧预览自动滚到目标行
并把所有匹配高亮。

### 🪜 引导式工作流，不再"乱按按钮"

- **"时光机"Reflog** —— 每一次 HEAD 移动都是一行可点的记录。选任意一个过去的
  HEAD → "回到这步"。这次回退本身也会记入 reflog，所以再点一次就能撤销——这是
  大多数 GUI 不暴露给你的安全网。
- **三方合并编辑器** —— ours / base / theirs 三列并排 + 同步滚动的合并预览
  + 全部解决之后的"复审 staged diff"页面。Rebase / Revert / Cherry-pick 共用
  同一套 UI。
- **Bisect** —— AI 根据最近 commit 的标题推荐起点，一键 good / bad / skip。
- **交互式 Rebase** —— 拖拽排序，drop / squash / reword 都有内联编辑器。

### 🧱 为大仓库设计

Rust + libgit2 做数据层。虚拟滚动让 10k+ 行的 diff 也流畅。Commit graph 的
通道宽度会自动压缩，30 条并行分支仍能看清 message。每个仓库的状态绑定在自己
的 tab 里，切仓库不会引发卡顿。

### 💬 人话界面，命令行内核

"保存进度"代替"git commit"、"这版好 / 这版坏"代替"git bisect good / bad"、
"回退到这版"代替"git reset --hard"。UI 实在表达不了的细节，`⌘\`` 一键呼出
仓库根目录的多标签 xterm——不会被困在 GUI 里。

### 其他细节

- 文件树 / 平铺两种视图 · Hunk 级 staging
- 并排 diff，行内单词级高亮
- 未跟踪文件标 **N**（不再是模糊的 `?`）
- 任意文件夹都能打开 —— 非 git 文件夹会提示 `git init`，并附带覆盖 Node /
  Rust / Python / Java / Android / iOS / Flutter / Go / C++ 的 `.gitignore`
- 默认隐藏 vim swap / `.DS_Store` / emacs 锁文件这类编辑器临时文件
- 可选 GPG / SSH 提交签名
- 中英双语 UI —— 默认跟随系统语言

---

## 安装

### 预编译版本

去 [Releases](https://github.com/moxiaohao0616-alt/Versa/releases) 下载：

- **macOS**：`Versa_*_aarch64.dmg` —— **仅支持 Apple Silicon（M 系列芯片）**，
  Intel Mac 暂未提供。
- **Linux**：`.AppImage` / `.deb` / `.rpm`
- **Windows**：`*-setup.exe`

> **macOS 首次打开说明。** 暂未做代码签名，所以系统会拦截。多数情况下"右键 →
> 打开"就能放行。如果系统仍然提示 *"Versa.app 已损坏，无法打开"*，运行下面这
> 条命令去掉隔离属性：
>
> ```bash
> sudo xattr -r -d com.apple.quarantine /Applications/Versa.app
> ```

### 从源码构建

```bash
# 需要 Rust stable + Node 18+
# Linux 依赖：sudo apt install libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf libssl-dev

git clone https://github.com/moxiaohao0616-alt/Versa.git
cd Versa
npm install
npm run tauri dev     # 热重载开发
npm run tauri build   # 打包生产版本
```

---

## 配置 AI

**Settings → AI provider** 里粘贴你的 key。Key 只存在本机 localStorage，请求
直接发给你选的供应商——Versa **看不到**你的代码或 prompt。

| 供应商 | 默认模型 |
| --- | --- |
| Anthropic Claude | `claude-sonnet-4-6` |
| OpenAI | `gpt-4o-mini` |
| DeepSeek | `deepseek-chat` |
| Kimi（月之暗面） | `moonshot-v1-32k` |
| OpenAI-compatible | _你自己填_ |

如果当前有 active changelist，AI 写 commit message 和 AI Review 会自动缩窄到
那个 group 的文件。

---

## 键盘快捷键

App 内按 `?` 查看完整列表。`⌘` 在 Windows / Linux 上是 `Ctrl`。

| 快捷键 | 作用 |
| --- | --- |
| `⌘P` | 仓库快速切换 |
| `⌘⇧F` | 全工作区代码搜索 |
| `⌘\`` | 切换底部终端 |
| `⌘↑ / ⌘↓` | 上一个 / 下一个 diff 文件 |
| `⌥↑ / ⌥↓` | 上一个 / 下一个 hunk |
| `Esc` | 关闭弹窗 · 取消 AI 流 |

---

## 贡献

欢迎提 Issue 和 PR。**About → 复制诊断信息** 按钮会生成一段可直接粘贴的系统
摘要，方便提 bug。

## License

Apache 2.0 —— 见 [LICENSE](LICENSE)。

站在 [Tauri](https://tauri.app)、[libgit2 / git2-rs](https://github.com/rust-lang/git2-rs)、
[React](https://react.dev)、[xterm.js](https://xtermjs.org) 的肩膀上。感谢 ❤️
