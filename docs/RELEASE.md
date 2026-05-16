# Versa 发布指南

## 触发一次发布

```bash
git tag v0.1.0
git push origin v0.1.0
```

GitHub Actions 的 `build` workflow 会自动：

- 在 macOS (arm64 + x64) / Linux / Windows 各跑一遍 `tauri build`
- 用 updater 私钥签名生成 `.tar.gz.sig`
- 把所有产物上传到 GitHub Release（草稿状态）

到 [Releases 页面](https://github.com/moxiaohao0616-alt/Versa/releases) 把草稿改为正式发布即可。

## 必填 Secrets（仓库 Settings → Secrets and variables → Actions）

| Secret | 说明 |
| --- | --- |
| `TAURI_SIGNING_PRIVATE_KEY` | `~/.tauri/versa.key` 文件**内容**（不是路径） |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | 生成时如果用了密码就填，没用就留空 |

把私钥内容贴进 GitHub 之前，**把 `~/.tauri/versa.key` 文件本身备份好** —— 弄丢私钥相当于丢失所有现有用户的更新通道，必须发新公钥重新签整个 app。

## 可选 Secrets — macOS 签名 + 公证

买了 [Apple Developer 账号](https://developer.apple.com/programs/)（$99/年）后：

```bash
# 1. 在 Apple Developer 后台导出 "Developer ID Application" 证书为 .p12
# 2. 编码为 base64 贴到 GitHub Secrets
base64 -i DeveloperID.p12 -o cert.b64
# 3. 在 https://appleid.apple.com 生成 app-specific password
```

| Secret | 说明 |
| --- | --- |
| `APPLE_CERTIFICATE` | `cert.b64` 文件内容 |
| `APPLE_CERTIFICATE_PASSWORD` | 导出 .p12 时设的密码 |
| `APPLE_SIGNING_IDENTITY` | 例如 `Developer ID Application: Your Name (TEAMID)` |
| `APPLE_ID` | 你的 Apple ID 邮箱 |
| `APPLE_PASSWORD` | app-specific password（不是 Apple ID 登录密码） |
| `APPLE_TEAM_ID` | 10 位字符的 Team ID |

填完之后 push 一个新 tag，`build.yml` 会自动跑签名 + 公证流程，产出的 `.app` / `.dmg` 用户可以双击直接打开，不再有 Gatekeeper 警告。

> 没填 Apple secrets 也能 build，只是产出的是未签名版本，macOS 用户首次打开要"右键 → 打开"绕过 Gatekeeper。

## 可选 Secrets — Windows 代码签名

需要从证书机构（DigiCert / Sectigo / SSL.com 等）购买 [Code Signing Certificate](https://www.digicert.com/signing/code-signing-certificates)（≈ $200/年起）。
拿到 `.pfx` 后：

```jsonc
// src-tauri/tauri.conf.json
"windows": {
  "certificateThumbprint": "<你的证书指纹>",
  ...
}
```

证书装到 GitHub Actions runner 的方式跟 macOS 类似（base64 → secret → 解码导入），具体见 [tauri-action 文档](https://github.com/tauri-apps/tauri-action#windows-codesigning)。

没买证书可以照常发，只是 Windows 10/11 的 SmartScreen 会弹"未识别的应用"警告，第一批用户需要点"仍要运行"。

## 用户那一侧

装上 Versa 之后会在启动时静默检查更新；用户也能从 **设置 → 关于 Versa → 检查更新** 手动触发。
有新版本时弹"下载并安装"，下载完会自动重启进新版。

## 私钥保管

- `~/.tauri/versa.key`（**私钥**）—— 备份到 1Password / iCloud Keychain，丢了就玩完
- `~/.tauri/versa.key.pub`（**公钥**）—— 已经写进 `src-tauri/tauri.conf.json`，公开
