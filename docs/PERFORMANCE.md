# Versa 性能审计 · v0.1

代码已经审计过的热点路径 + 已知瓶颈。给后续专项优化做参考。

## 已经做好的事

### Diff 视图
- ✅ **虚拟滚动**：`src/components/Diff/index.tsx` 用偏移数组 + 二分查找定位可视范围，再加 15 行 overscan。即使是 10k 行的 diff 也能瞬时打开
- ✅ **行高固定**：file=30 / hunk=24 / line=20，避免每次测量
- ✅ **词级 inline diff 限制长度**：单行超过 500 字符直接整行 del/add（`wordDiff.ts` 早退）
- ✅ **hljs 高亮缓存**：每行只在 render 时算一次，jsx 自带 memo

### AI 流式
- ✅ **取消信号下沉到 backend**：`call_ai_stream` 在每个 chunk 边界检查 `AtomicBool`
- ✅ **Esc 触发的取消**：通过 Tauri command 写共享 flag，不靠 await 取消

### Untracked 目录
- ✅ **>1 MiB 单文件跳过**、非 UTF-8 跳过、`.git` 子目录跳过、symlink 跳过（`synthesize_untracked_dir_diff`）

### 提交历史
- ✅ **分页**：默认 200 / "再加载" 增量，避免一次拉所有

## 已知瓶颈（还没动）

### Graph 视图 — **大仓库主要瓶颈**
**位置**：`src/components/Graph/index.tsx:515`
```tsx
{rowsToRender.map(renderRow)}
```
**问题**：所有 commit row + SVG 连线一次性渲染。
- 200 行：流畅
- 1000 行："再加载"几次后开始卡 scroll
- 50k+ 行（monorepo "加载全部"）：DOM 撑爆，几乎卡死

**修法**：复制 DiffView 的虚拟滚动模式
- 计算 row 偏移数组
- 监听 `.graph-scroll` 的 scrollTop
- 只渲染 viewport ± overscan 区间的 row
- SVG 连线 path 数据仍然全量算（O(N)），但 `<path>` 元素只渲染可视部分

预估工作量：半天。需要单独的优化轮，建议有真实大仓库压测案例后再做。

### 状态更新风暴
**位置**：`src-tauri/src/watcher.rs` + store.refreshRepo
**问题**：FS watcher 监听 `.git/` 全目录，rebase / 大 commit 期间会触发数十次 refresh，每次 refresh 都重新 `git status` + UI 重渲染。
- 缓解措施：已经有 250ms debounce（`App.tsx:117`）
- **没解决**：长时间 rebase 全期间 UI 仍可能闪烁

**修法选项**：
1. 把 debounce 拉到 500ms
2. 检测 repo 是否处于 "rebasing"/"merging" 等中间态，期间 skip refresh
3. 让 watcher 只监听 working tree 关键路径，不监听 `.git/objects/`

### libgit2 statuses 在大仓库慢
**位置**：`get_status` 内部走 `repo.statuses()`
**问题**：仓库 working tree 几 GB 时，一次 statuses 调用要 100ms+。每次 refresh 都跑一遍。

**修法**：
- 用 `notify` 监听具体改动的文件，只对它们跑 status
- 或缓存上次 statuses 结果，按 mtime diff 增量更新

### 启动冷启动
**问题**：第一次打开 100k commit 仓库时，`open_repo` + 初次 `get_status` + 初次 `get_graph(200)` 串行调用，总耗时 ~3–5 秒，UI 全黑。

**修法**：把这三个调用并行化，先用最小数据点亮 UI 再补全。

## 建议的下一步

如果你拿到一个真的卡的大仓库，**优先做 Graph 虚拟化**——这是用户最容易感知的卡顿。其它 3 项可以等具体反馈再说。

需要测量工具：
- Chrome DevTools Performance panel（透过 Tauri webview 起 devtools）
- `cargo flamegraph` 看 Rust 侧热点
