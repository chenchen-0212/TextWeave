# 构建与打包

本文档说明如何从源码产出 Windows 与 macOS 的安装包。

---

## 一、最重要的一条约束

**Windows 产物只能在 Windows 上构建，macOS 产物只能在 macOS 上构建。**

这不是工具链配置问题，而是 Wails 的架构决定的：Wails 通过 **cgo** 调用各平台的原生
WebView 绑定（Windows 上是 WebView2，macOS 上是 Cocoa/WebKit）。cgo 无法交叉编译，
因此不存在「在 Windows 上产出一个能用的 macOS .app」这条路径。

| 想产出 | 必须在这台机器上构建 |
|---|---|
| `TextWeave.exe` + NSIS 安装包 | Windows 10/11 x64 |
| `TextWeave.app` + `.dmg` | macOS 10.15+，装好 Xcode Command Line Tools |

**两个平台都要，最省事的做法是走 CI**：`.github/workflows/release.yml` 会同时在
`windows-latest` 与 `macos-latest` 上构建，推送一个 `v*` tag 即可自动创建 Release。

---

## 二、环境准备

### 通用

| 依赖 | 版本 | 说明 |
|---|---|---|
| Go | 1.21+ | 本项目在 1.26.5 上验证 |
| Node.js | 18+ | 本项目在 22.23.2 上验证 |
| Wails CLI | v2.15.0 | `go install github.com/wailsapp/wails/v2/cmd/wails@v2.15.0` |

安装完 Wails CLI 后建议先跑一次 `wails doctor`，它会明确告诉你缺什么。

### Windows 额外需要

1. **WebView2 Runtime** — Windows 11 自带；Windows 10 若没有，安装包会自动下载安装。
2. **NSIS** — 用于生成 `.exe` 安装包：
   ```powershell
   winget install -e --id NSIS.NSIS
   ```
   装完后确认 `makensis` 在 PATH 中。若不在，把 `C:\Program Files (x86)\NSIS` 加进 PATH。

### macOS 额外需要

```bash
xcode-select --install
```

确认 `codesign`、`hdiutil`、`lipo` 可用（随 Xcode CLT 一起安装）。

---

## 三、快速开始

### Windows

```powershell
# 一条命令：构建 exe + NSIS 安装包，并整理到 dist/
powershell -ExecutionPolicy Bypass -File scripts/package-windows.ps1
```

或手动执行：

```powershell
$env:CGO_ENABLED = "1"
wails build -clean -platform windows/amd64 -nsis -webview2 download
```

产物：

```
build/bin/TextWeave.exe                    # 便携版，双击即用
build/bin/textweave-amd64-installer.exe    # NSIS 安装包
```

`-webview2 download` 的含义：安装包体积小，运行时若检测不到 WebView2 会自动下载安装。
若目标环境**完全离线**，改用 `-webview2 embed` 把运行时打进安装包（体积增加约 150 MB）。

### macOS

```bash
# 一条命令：构建 universal .app + 打包 .dmg 与 .zip
bash scripts/build-macos.sh
```

或手动执行：

```bash
export CGO_ENABLED=1
wails build -clean -platform darwin/universal
bash scripts/package-macos.sh 0.2.0
```

产物：

```
build/bin/TextWeave.app                              # 应用本体
dist/TextWeave-0.2.0-macos-universal.dmg             # 磁盘映像（拖拽安装）
dist/TextWeave-0.2.0-macos-universal.zip             # 备用分发格式
```

`darwin/universal` 会分别编译 `arm64` 与 `amd64` 再合并，因此首次构建较慢，
但产物能在 Apple Silicon 与 Intel 上原生运行。

---

## 四、macOS 签名与公证

**未签名的 .dmg 在别人机器上会被 Gatekeeper 拦截。** 用户需要右键「打开」，
或到「系统设置 → 隐私与安全性」里手动允许。

正式分发需要两步：

### 1. 代码签名

需要一张 `Developer ID Application` 证书。设置环境变量后脚本会自动签名：

```bash
export APPLE_SIGNING_IDENTITY="Developer ID Application: Your Name (TEAMID)"
bash scripts/build-macos.sh
```

签名时会带上 `build/darwin/entitlements.plist`。**这份 entitlements 是必需的**——
WKWebView 的 JavaScript 引擎在强化运行时下需要 JIT 相关权限，缺了会白屏或崩溃。

### 2. 公证（Notarization）

```bash
export APPLE_ID="you@example.com"
export APPLE_TEAM_ID="TEAMID"
export APPLE_APP_PASSWORD="xxxx-xxxx-xxxx-xxxx"   # App 专用密码，不是账号密码
bash scripts/build-macos.sh
```

脚本会调用 `notarytool submit --wait` 等待公证结果，通过后用 `stapler` 把凭据钉到
DMG 上，这样用户离线也能通过校验。

### 3. CI 中的配置

在 GitHub 仓库的 Settings → Secrets 里添加同名 Secret，工作流会自动读取：
`APPLE_SIGNING_IDENTITY`、`APPLE_ID`、`APPLE_TEAM_ID`、`APPLE_APP_PASSWORD`。

不配置这些 Secret 时 CI 依然会产出未签名的安装包，功能完整，只是首次打开需要用户手动放行。

---

## 五、应用图标

图标由脚本生成，**不手工维护二进制**：

```bash
node scripts/make-icon.mjs        # 或 task icon
```

产物：

| 文件 | 用途 |
|---|---|
| `build/appicon.png` | 1024×1024，Wails 构建时的图标源 |
| `build/windows/icon.ico` | Windows 多尺寸（16/24/32/48/64/128/256） |
| `build/darwin/icons.icns` | macOS 多尺寸（32/64/128/256/512/1024） |
| `build/icon/preview/` | 各尺寸预览图，改完图标用肉眼核对 |

图形来源是 [Lucide](https://lucide.dev) 的 `gallery-horizontal-end`（ISC 许可，可商用、无需署名），
完整说明与许可见 `build/icon/README.md`。

**改图标只需替换 `build/icon/*.svg` 再跑一次脚本。**

脚本有两个细节值得注意，改的时候别踩回去：

1. **每个尺寸单独光栅化**，不是从 1024px 缩下去 —— 缩小会把描边糊掉。
2. **小尺寸单独一套参数**（`profile()` 函数）。原设计是 24px 网格 / 2px 描边，
   等比缩到 16px 时描边只剩 0.7px，卡片内圈留白会被抗锯齿抹平。
   因此 ≤16px 时把图形放大到 92%、描边加粗到 3.2px。

生成脚本依赖 `sharp`（frontend 的 devDependency），执行前先 `cd frontend && npm install`。

---

## 六、项目体积说明

应用**不内置任何中文字体**（对应产品决策 D-12），使用系统已装字体 + 用户上传。
这让安装包保持在 12 MB 量级。若内置完整中文字体，体积会直接翻倍到 25 MB 以上，
且多数商用中文字体的分发授权需要单独购买。

| 产物 | 体积 |
|---|---|
| `TextWeave.exe` | 约 11.5 MB |
| Windows NSIS 安装包 | 约 6.3 MB |
| macOS `.app`（universal） | 约 12 MB |
| macOS `.dmg` | 约 6 MB |

---

## 七、常用命令

| 目的 | 命令 |
|---|---|
| 开发模式（前端热重载） | `wails dev` |
| 只做静态检查 | `go vet ./...` + `cd frontend && npm run build` |
| 跑逻辑验证 | `node scripts/test-core.mjs` + `node scripts/test-template.mjs` |
| 重新生成应用图标 | `node scripts/make-icon.mjs` |
| 检查构建环境 | `wails doctor` |
| 构建 Windows 产物 | `wails build -clean -platform windows/amd64 -nsis -webview2 download` |
| 构建 macOS 产物 | `wails build -clean -platform darwin/universal` |
| 构建 Linux 产物 | `wails build -clean -platform linux/amd64` |

安装了 [go-task](https://taskfile.dev) 的话，`task --list` 可以看到全部任务。

> **提示**：应用正在运行时 `wails build` 会因可执行文件被占用而失败
> （`unlinkat: Access is denied`）。先关掉应用再构建。

---

## 八、常见问题

**`Warning: Cannot create installer: makensis not found`**
NSIS 没装或不在 PATH。`winget install -e --id NSIS.NSIS`，然后把
`C:\Program Files (x86)\NSIS` 加进 PATH 再重试。

**macOS 构建报 cgo 相关错误**
`CGO_ENABLED=1` 必须设置。同时确认 Xcode CLT 已安装（`xcode-select -p` 有输出）。

**签名后的 macOS 应用白屏**
entitlements 缺失或不全。确认 `build/darwin/entitlements.plist` 里的
`com.apple.security.cs.allow-jit` 与 `disable-library-validation` 都已开启。

**`frontend/dist` 为空导致 `go build` 失败**
`main.go` 里有 `//go:embed all:frontend/dist`，该目录必须存在。
先跑一次 `cd frontend && npm run build`，或直接用 `wails build`（它会自动先构建前端）。

**首次构建很慢**
Go 依赖下载 + 前端 npm install + 前端编译。后续增量构建在 15 秒量级。

**Windows 构建时杀毒软件报警**
NSIS 生成安装包的行为会被部分杀软误判。属正常现象，把项目目录加入白名单即可。
