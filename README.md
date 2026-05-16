# Versa

> Git for Everyone — 专为全栈工程师设计的 Git GUI

## 技术栈

- **框架**: Tauri 2.0 (Rust + React)
- **前端**: React 18 + TypeScript + Zustand
- **Git 底层**: git2-rs (libgit2 binding)
- **构建**: Vite 5

## 本地开发

### 环境要求

```bash
# 1. 安装 Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# 2. 安装 Node.js 18+
# https://nodejs.org

# 3. 安装 Tauri CLI 依赖 (macOS)
xcode-select --install

# 3. 安装 Tauri CLI 依赖 (Linux)
sudo apt install libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf
```

### 启动开发环境

```bash
# 安装前端依赖
npm install

# 启动 Tauri 开发模式（同时启动 Vite + Rust）
npm run tauri dev
```

### 构建发布版本

```bash
npm run tauri build
```

## 项目结构

```
versa/
├── src/                      # React 前端
│   ├── components/
│   │   ├── Sidebar/          # 文件列表 + 提交区
│   │   ├── Diff/             # 代码差异视图
│   │   ├── Terminal/         # 内置 Terminal
│   │   ├── Branch/           # 分支图 (TODO)
│   │   ├── Conflict/         # 冲突解决 (TODO)
│   │   └── WelcomeScreen.tsx
│   ├── store/                # Zustand 全局状态
│   ├── styles/               # 全局样式
│   ├── App.tsx
│   └── main.tsx
├── src-tauri/                # Rust 后端
│   └── src/
│       ├── lib.rs            # 所有 Tauri commands (git2)
│       └── main.rs
└── package.json
```

## 功能路线图

### v0.1 MVP ✅
- [x] 项目骨架 (Tauri + React + git2-rs)
- [x] 打开仓库
- [x] 查看文件变更
- [x] Diff 视图
- [x] 保存进度 (stage all + commit)
- [x] 提交历史
- [x] 内置 Terminal

### v0.2 核心卖点
- [ ] Merge 冲突三栏可视化
- [ ] 多仓库 Tab 管理
- [ ] AI 生成 commit message
- [ ] Push / Pull (通过 git2 + SSH)

### v0.3 差异化
- [ ] 分支图可视化 (D3.js)
- [ ] Interactive rebase UI
- [ ] AI 辅助解决冲突
- [ ] 自动识别项目类型

### v1.0 商业化
- [ ] 付费功能解锁
- [ ] 云端设置同步
- [ ] 团队协作功能
