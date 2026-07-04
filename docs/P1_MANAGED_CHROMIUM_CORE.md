# P1 Managed Chromium Core

创建日期：2026-07-04

## 目标

P1 将默认浏览器运行时从用户本机 Chrome 切换为项目管理的固定 Chromium stable tag。项目源码仍保留在当前仓库目录，大体积数据统一放到 F 盘。

锁定内核：

- Chromium version/tag: `150.0.7871.47`
- Chromium commit: `0c3cca15d78645281db2d339b2dc3d6fad4ee90a`
- macOS arch: `arm64`
- depot_tools commit: `1b1b01fa912786b88a79f3504176a275183839b5`

## F 盘目录

```text
/Volumes/F/ChromePowerBuild/depot_tools
/Volumes/F/ChromePowerBuild/git-cache
/Volumes/F/ChromePowerBuild/cipd-cache
/Volumes/F/ChromePowerBuild/vpython-root
/Volumes/F/ChromePowerBuild/chromium/src
/Volumes/F/ChromePowerBuild/tmp
/Volumes/F/ChromePowerCore/chromium/150.0.7871.47/mac-arm64/Chromium.app
/Volumes/F/ChromePowerCache/managed-chromium/150.0.7871.47/<profile_id>
```

这些目录不进入 git，也不会被 Electron 打包进 DMG。

## Xcode

当前实现优先使用：

```text
/Volumes/F/MacOffload/Xcode/Xcode.app
```

其次使用：

```text
/Volumes/F/Applications/Xcode.app
```

如果这里不存在，则 fallback 到：

```text
/Applications/Xcode.app
```

建议从 Apple Developer 手动下载 Xcode `.xip` 到 `/Volumes/F/Downloads`，展开后移动到 `/Volumes/F/MacOffload/Xcode/Xcode.app`。不要使用 App Store 默认安装方式，否则 Xcode 会安装到系统盘。

如果需要兼容 Apple 工具的默认查找路径，可以让 `/Applications/Xcode.app` 指向 F 盘中的 Xcode：

```text
/Applications/Xcode.app -> /Volumes/F/MacOffload/Xcode/Xcode.app
```

首次使用前需要在终端中接受 Xcode license：

```bash
sudo xcodebuild -license
```

或在你已经确认许可内容后执行：

```bash
sudo xcodebuild -license accept
```

首次初始化 Xcode 组件：

```bash
DEVELOPER_DIR=/Volumes/F/MacOffload/Xcode/Xcode.app/Contents/Developer xcodebuild -runFirstLaunch
```

Chromium 的 ANGLE Metal shader 构建需要 Xcode Metal Toolchain。先查看可用 build version：

```bash
DEVELOPER_DIR=/Volumes/F/MacOffload/Xcode/Xcode.app/Contents/Developer xcodebuild -showComponent MetalToolchain -json
```

然后按输出里的 `buildVersion` 下载，例如当前机器为 `17F109`：

```bash
DEVELOPER_DIR=/Volumes/F/MacOffload/Xcode/Xcode.app/Contents/Developer xcodebuild -downloadComponent MetalToolchain -buildVersion 17F109
```

该组件由 Apple 安装到系统资产缓存，例如 `/System/Library/AssetsV2/com_apple_MobileAsset_MetalToolchain`。这部分不支持强制搬到 F 盘，本机实测约 673MB；Xcode.app 本体仍在 F 盘。

如果 Chromium 工具或 Xcode 报权限问题，可以启用 F 盘 ownership：

```bash
diskutil enableOwnership /Volumes/F
```

## 手动构建流程

所有命令都必须显式运行，不会在 `npm install` 或 `postinstall` 中自动触发。

```bash
npm run chromium:prepare
npm run chromium:sync
npm run chromium:build
npm run chromium:install-core
npm run chromium:verify
```

`chromium:prepare` 会检查：

- 当前系统是 macOS arm64。
- `/Volumes/F` 已挂载且是 APFS。
- 完整 Xcode 可用，`xcrun --show-sdk-path` 指向 Xcode SDK。
- Xcode Metal Toolchain 可用，`xcrun metal -v` 能正常执行。
- `depot_tools` 已 checkout 并锁定到指定 commit。

## 运行时行为

默认设置：

- `browserMode`: `managed`
- `managedBrowserRoot`: `/Volumes/F/ChromePowerCore`
- `managedBrowserVersion`: `150.0.7871.47`
- `managedBrowserManifestPath`: `/Volumes/F/ChromePowerCore/chromium/150.0.7871.47/mac-arm64/manifest.json`
- `profileCachePath`: `/Volumes/F/ChromePowerCache`

打开窗口时会校验：

- F 盘是否挂载。
- manifest 是否存在。
- Chromium 可执行文件是否存在。
- manifest 版本、tag、commit、arch 是否匹配。
- Chromium 可执行文件 sha256 是否匹配。
- `Chromium --version` 是否包含锁定版本。
- 临时启动 Chromium，绑定 `127.0.0.1:<随机端口>`，读取 CDP `/json/version`，确认内核可被本地 DevTools Protocol 控制。

任一失败都会报错并停止，不会自动 fallback 到本机 Chrome。

## 验收

完成构建和安装后：

1. `npm run chromium:verify` 成功，包括 manifest/hash/version 和 CDP 启动校验。
2. 设置页显示 managed core `Ready`。
3. 新 profile 写入 `/Volumes/F/ChromePowerCache/managed-chromium/150.0.7871.47/`。
4. 本机 Chrome 版本变化不影响 managed profile。
5. 卸载 F 盘后，打开窗口明确失败，且不会在系统盘创建假 `/Volumes/F` 数据目录。

## 不包含

P1 不做 Canvas、WebGL、Audio、字体等指纹修改；这些属于 P2。

P1 不接 Google API keys，不把 Widevine/DRM 作为验收项，不使用 Chrome for Testing，不自动下载或自动升级运行内核。
