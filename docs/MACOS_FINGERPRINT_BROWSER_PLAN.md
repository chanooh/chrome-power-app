# macOS 指纹浏览器能力对齐计划

创建日期：2026-07-03

## 目标与边界

本计划只面向 macOS，目标是把当前项目从“Chrome 多开 / 配置管理工具”逐步补齐为更接近成熟指纹浏览器的本地桌面产品。使用边界应限定在合法的隐私保护、账号隔离、测试、客服运营、跨地区 QA、自动化回归等场景。

不做绕过网站风控、规避身份验证、批量注册滥用、隐藏恶意自动化等用途的功能设计或文档化指导。

## 当前判断

当前项目已经具备一些基础能力：

- Electron + React 桌面应用框架。
- SQLite / Knex 本地数据存储。
- Chrome 多窗口 / 多 profile 启动能力。
- 代理、扩展、标签、分组等管理入口。
- 多窗口同步操作的雏形。
- 本地 API 和示例自动化脚本。

但它更像是“本地 Chrome profile 管理器”，还不是成熟意义上的指纹浏览器。主要原因是：

- 默认使用本机 Chrome，浏览器内核、版本、UA、TLS/网络行为、Google 服务和自动更新都不完全可控。
- 指纹参数没有形成稳定、成套、macOS 一致的 profile 模板。
- Canvas / WebGL / WebGPU / AudioContext / fonts / media devices / permissions 等指纹面尚未产品化。
- 网络隐私层、WebRTC、DNS、代理一致性检查还不完整。
- 本地 API 缺少认证和访问边界，安全性需要先补齐。
- 扩展、profile 数据、团队协作、审计、自动化接口等成熟产品能力仍较弱。

## 竞品能力参考

参考对象包括 AdsPower、GoLogin、Multilogin、Dolphin Anty 等成熟产品。它们通常覆盖：

- 多 profile 隔离和批量管理。
- 浏览器 / 设备 / 网络指纹配置。
- Canvas、WebGL、WebGPU、AudioContext、字体、屏幕、时区、语言等参数。
- IP、DNS、WebRTC、代理检测与一致性。
- Cookies、缓存、历史、扩展、会话数据的独立保存。
- 自动化 API、OpenAPI、Puppeteer / Playwright / Selenium 兼容。
- 临时 profile、批量创建、导入导出。
- 团队协作、权限、审计日志。
- 同步器、RPA 或批量操作能力。

参考链接：

- AdsPower: https://www.adspower.com/
- GoLogin: https://gologin.com/features/
- Multilogin: https://multilogin.com/antidetect/web-automation/
- Dolphin Anty: https://dolphin-anty.com/blog/en/dolphin-anty-updates-in-the-past-three-months/

## 优先级路线

### P0：安全与可控基础

这是进入下一阶段前必须先做的底座。

- 本地 Express API 只监听 `127.0.0.1`。
- 本地 API 增加 token 认证，避免局域网或网页侧误调用。
- 收紧 CORS，避免任意来源访问。
- 清理键盘 / 鼠标同步模块里的详细事件日志，尤其是键盘事件。
- 明确生产环境自动更新策略，避免未经确认的二进制更新。
- macOS 全局输入仅使用项目自有 `window-addon`，不引入第三方全局键盘监听库。
- 继续保持 `.npmrc` 中 `ignore-scripts=true`，避免依赖安装阶段自动下载或执行脚本。
- 对 native binary 建立受控构建或校验流程，至少记录来源、版本、hash。

验收标准：

- 本地 API 无 token 时不可调用。
- 服务不绑定 `0.0.0.0`。
- 依赖安装不会下载或构建第三方全局输入监听库。
- 日志中不记录原始键盘事件内容。

### P1：可控浏览器内核

成熟指纹浏览器首先需要控制浏览器内核，而不是直接依赖用户本机 Chrome。

- 引入固定版本的 Chromium / Chrome for Testing 运行时。
- 禁止运行时自动更新浏览器核心。
- 建立浏览器核心版本和 profile 指纹模板的绑定关系。
- 关闭或隔离不必要的 Google 服务。
- 统一启动参数，避免不同 profile 因启动参数漂移产生差异。
- 明确 CDP remote debugging 的生命周期和端口隔离。
- 做浏览器核心完整性校验，例如版本、路径、hash。

验收标准：

- 同一版本应用在不同 macOS 机器上启动相同浏览器核心。
- profile 的 UA、浏览器版本、核心版本保持一致。
- 浏览器核心升级必须显式触发、可回滚、可记录。

### P2：macOS 一致性指纹模板

不要做零散参数开关，而是生成“成套一致”的 macOS profile。

- 建立 macOS 设备模板，例如 MacBook Air、MacBook Pro、iMac、Mac mini。
- UA、platform、hardwareConcurrency、deviceMemory、screen、DPR、timezone、locale、language 形成一致组合。
- 字体列表按 macOS 版本和设备类型建模。
- WebGL vendor / renderer 与 macOS 设备模板匹配。
- Canvas、WebGL、WebGPU、AudioContext 指纹有稳定策略。
- Media devices、battery、permissions、notifications、clipboard 等权限面统一管理。
- 为每个 profile 生成不可随意漂移的 fingerprint snapshot。

验收标准：

- 同一个 profile 多次启动后指纹稳定。
- 不同 profile 之间具备合理差异。
- 所有参数能解释为同一台合理的 macOS 设备。
- 提供指纹一致性检查页面或内部诊断结果。

### P3：网络隐私与代理一致性

网络层需要和浏览器指纹互相匹配。

- WebRTC IP 泄露控制。
- DNS 查询路径控制或检测。
- 代理健康检查，包括出口 IP、国家、城市、ASN、延迟、失败率。
- 代理与 timezone / locale / language 的一致性提示。
- 每个 profile 绑定独立代理配置和检测历史。
- 代理失败时给出明确状态，而不是静默回落本机网络。
- 支持 HTTP、HTTPS、SOCKS5，必要时支持用户名密码认证。

验收标准：

- WebRTC 不泄露本机局域网或真实公网 IP。
- profile 出口 IP 与配置代理一致。
- 代理异常不会悄悄使用直连。
- UI 能看到代理检测结果和最近失败原因。

### P4：profile 数据隔离与安全

成熟产品的核心体验是“一个 profile 就是一台独立设备”。

- Cookies、localStorage、IndexedDB、Cache、History、Bookmarks、Downloads 路径隔离。
- profile 支持备份、恢复、导入、导出。
- 支持批量迁移 profile。
- 敏感配置使用 macOS Keychain 或等效机制保存。
- profile 文件权限收紧，避免被其他本地进程随意读取。
- 提供 profile 数据体积、最后访问时间、异常状态等诊断信息。

验收标准：

- profile 之间不能共享 cookie / storage / cache。
- 备份恢复后 profile 可正常启动并保持会话。
- 密码、代理凭据、API token 不以明文散落在普通配置文件里。

### P5：扩展中心与扩展版本控制

指纹浏览器通常需要可控扩展，而不是让扩展自行更新造成环境漂移。

- 建立本地扩展仓库。
- 扩展按 profile、分组、批量策略安装。
- 固定扩展版本，禁止自动更新。
- 展示扩展权限列表。
- 检测扩展冲突、缺失、加载失败。
- 支持扩展模板，例如一组 profile 共享同一批扩展配置。

验收标准：

- profile 扩展版本可复现。
- 扩展更新必须显式确认。
- 批量应用扩展策略不会破坏已有 profile。

### P6：自动化 API 产品化

当前已有示例脚本，但还需要产品化为稳定 API。

- 增加 OpenAPI / Swagger 文档。
- API token 和权限模型。
- 创建、启动、停止、删除、导入、导出 profile 的完整接口。
- 支持临时 profile。
- 返回标准化错误码。
- 提供 Puppeteer / Playwright / Selenium 连接示例。
- 明确 remote debugging port 的获取方式和生命周期。

验收标准：

- 外部脚本能通过 API 完整管理 profile 生命周期。
- API 文档可直接生成客户端或用于调试。
- 错误返回可定位问题，而不是只返回通用失败。

### P7：同步器与 RPA

已有多窗口同步的基础，但需要产品化和权限化。

- 明确同步器开关、作用范围、目标窗口列表。
- 鼠标、键盘、滚动、点击、输入分别可控。
- 敏感输入场景提供暂停或提醒。
- 移除原始键盘事件日志。
- 增加同步操作状态、失败窗口、延迟统计。
- 后续再考虑简单 RPA 录制 / 回放。

验收标准：

- 用户能清楚知道哪些窗口正在被同步。
- 可以随时暂停同步。
- 日志不包含敏感输入内容。

### P8：团队、权限与审计

如果产品未来面向多人使用，需要补齐协作能力。

- workspace / team 概念。
- profile 所有者、共享、只读、可启动、可编辑等权限。
- 操作审计日志。
- 批量分组和标签权限。
- 敏感操作二次确认，例如删除 profile、导出数据、修改代理。

验收标准：

- 不同成员只能看到和操作授权 profile。
- 关键操作可追溯。
- 批量操作有审计记录和失败明细。

## 建议实施顺序

1. 先做 P0：本地 API 安全、依赖锁定、日志清理。
2. 再做 P1：固定浏览器核心，解决“可控运行环境”。
3. 然后做 P2 + P3：macOS 指纹模板和网络一致性。
4. 接着做 P4 + P5：profile 数据和扩展版本控制。
5. 最后做 P6 + P7 + P8：自动化、同步器、团队协作。

## 首批可拆任务

- 将本地 API 绑定到 `127.0.0.1`。
- 为本地 API 增加 token 认证。
- 收紧 CORS。
- 删除或脱敏键盘事件日志。
- 梳理当前 Chrome 启动参数，形成统一 launch config。
- 新增 profile fingerprint snapshot 数据结构。
- 新增 macOS profile template 数据结构。
- 新增代理检测结果表。
- 新增扩展版本锁定字段。
- 新增 OpenAPI 文档入口。

## 近期不建议先做

- 不建议先做大量 UI 美化，底层可控性还不够。
- 不建议先堆很多指纹参数开关，容易制造不一致 profile。
- 不建议继续扩大本机 Chrome 依赖，后续迁移到固定浏览器核心会返工。
- 不建议在没有 API token 的情况下开放更多本地接口。
- 不建议引入自动下载或自动升级的第三方 native 输入依赖。

## 参考代码位置

- 主进程入口：`packages/main/src/index.ts`
- 主窗口：`packages/main/src/mainWindow.ts`
- 本地 API：`packages/main/src/server/index.ts`
- Chrome 启动逻辑：`packages/main/src/fingerprint/index.ts`
- 设置读取：`packages/main/src/utils/get-settings.ts`
- 多窗口同步：`packages/main/src/services/multi-window-sync-service.ts`
- preload bridge：`packages/preload/src/index.ts`
- renderer 路由：`packages/renderer/src/routes/index.tsx`
