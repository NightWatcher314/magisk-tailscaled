---
status: 已完成
---

## 问题陈述 <!-- prd:problem -->

当前 `v2.3.1.0` 已具备可用的 KernelSU/APatch WebUI、配置管理、Peer 列表和按需诊断，但仍有四类可观察问题：模块升级会把 `config.env` 移入备份后生成默认配置；单包 Peer 测试会把首包 DERP 路径误解成稳定路径；固定十秒状态刷新和整段 Peer DOM 重建仍会造成迟滞；发布依赖 Tag push，但当前维护凭据下 Tag push 未可靠触发 GitHub Actions，只能手工创建 Release。

运行时还缺少可选崩溃恢复、日志上限、集中健康检查、脱敏诊断报告和配置复制/导入能力。WebUI 的 shell bridge、运行时协议、状态管理和 DOM 逻辑集中在 `app.ts`，关键编排行为难以通过稳定接口测试。

## 期望结果 <!-- prd:outcome -->

发布 `v2.4.0.0`，并达到以下可观察结果：

1. 覆盖安装保留原有配置和节点状态；新配置字段使用默认值补齐，失败时保留可恢复备份。
2. Peer 卡片明确区分“状态路径（最近活动）”和“本次探测”；手动探测发五个包，显示路径演进、本次最后探测路径、延迟与时间，不再把首包 DERP 当成稳定路径。
3. WebUI 使用自适应刷新；隐藏、诊断和无变化状态不做无效刷新或 Peer 重建，旧数据以“过期”标识保留。
4. WebUI 提供手动健康检查、结构化 Netcheck 摘要、原始输出和一键复制脱敏报告。
5. 用户可选择启用 watchdog，并配置日志大小上限；主动停止不会被 watchdog 拉起，崩溃重启具有退避和次数记录。
6. 用户可复制当前运行配置，也可粘贴 JSON 到 WebUI 预览并通过现有保存流程导入；节点密钥和状态文件不进入导出内容。
7. shell bridge 与运行时命令收敛到可测试的 `RuntimeClient` 接口，UI 调用方不再理解 marker、KernelSU spawn、fallback、timeout 和 stderr 细节。
8. GitHub Actions 的手动发布入口能完成版本校验、构建、测试、Tag/Release、SHA256SUMS、发布后下载校验；Tag 与仓库版本不一致时失败而不是在 CI 临时修改源码。

## 用户故事或验收结果

1. 作为现有模块用户，我升级后原有 Headscale URL、hostname、启动参数和 WebUI 设置保持不变。
2. 作为排障用户，我能看懂 Peer 的最近活动状态路径与五包探测路径变化，并知道结果产生时间。
3. 作为移动设备用户，我在 Peer 较多时滚动和点击仍保持响应，页面隐藏时不产生状态轮询。
4. 作为维护者，我能复制不含节点私钥的诊断报告，并据此判断 daemon、Backend、TUN、SELinux、日志和网络探测状态。
5. 作为维护者，我能通过单一、可回读的发布入口生成可校验的正式版本。

## 实现决策 <!-- prd:implementation -->

- 版本更新为 `v2.4.0.0`，`versionCode=02040000`。继续固定 `tailscale-android-cli v1.98.8-android`；不升级 Android 内核，不把内核升级作为本任务的交互决策。
- 不向上游仓库创建 PR；只维护并发布 `NightWatcher314/magisk-tailscaled`。
- `customize.sh` 覆盖安装时复制 `config.env` 到版本备份，同时保留原文件；二进制、脚本和运行日志仍按现有策略替换。缺失的新字段由 `settings.sh` 默认值补齐。安装后验证配置可读取；失败时保留备份并中止，不能静默重置。
- 新增配置键仅限 watchdog 开关、日志大小上限和必要的运行时内部状态；继续通过 `tailscaled.config` 白名单、原子写入和 `0600` 权限管理。
- watchdog 默认关闭。启用后只监控非主动停止的 daemon；使用主动停止标记、有限重试、指数退避和可见计数。模块禁用或配置关闭时停止 watchdog。
- 日志轮转由一个运行时实现集中处理 daemon 与 operation 日志；采用大小阈值和有限历史文件，不新增独立日志服务，输出通过与命令同生命周期的轻量 writer 持续轮转。
- Peer 探测保持手动，使用 `tailscale ping -c 5 --until-direct=false --timeout 2s`，不在后台持续探测。解析所有 `pong` 行，输出路径序列、本次最后探测路径、平均延迟和时间戳。状态路径变化后标记旧探测已过期。
- 健康检查为手动操作。快速状态刷新不自动运行 `netcheck`、SELinux 日志扫描或多包 Ping。健康检查返回结构化 JSON；Netcheck 单独按需使用 `tailscale netcheck --format=json`，stderr 警告与 JSON stdout 分离。
- 配置导出仅包含 `tailscaled.config get` 已管理字段；导入只接受同一白名单字段，先填充 UI 并标记未保存，再由现有 `set-many` 保存路径完成校验和持久化。
- 新建 WebUI `RuntimeClient` 深模块，接口至少覆盖 snapshot、log、saveConfig、action、peerProbe、netcheck、health。KernelSU `spawn`、旧 `exec`、Android fallback、shell quoting、退出 marker 和 timeout 留在实现内部。
- 自适应刷新使用单一调度器：页面隐藏时停止；页面恢复、用户动作完成时立即刷新；空闲时降低频率；诊断期间暂停。Peer 以 ID、状态 map key、首个 Tailscale IP 依次作为稳定键；展示 ViewModel 未变化时不替换卡片 DOM。
- 发布工作流不在 Tag job 中临时改版本文件。手动入口以已提交的 `module.prop` 和 update JSON 为真值，创建或校验匹配 Tag，上传当前版本两个 ZIP 与 `SHA256SUMS`，再重新下载并校验。

## 测试决策 <!-- prd:testing -->

- 新增升级安装测试，覆盖配置保留、新字段默认、备份存在和非法配置失败不重置。
- 扩展 shell 集成测试，覆盖 watchdog 主动停止、崩溃退避、日志轮转、health JSON、五包 peer-test、JSON Netcheck 和参数注入拒绝。
- WebUI 单测覆盖多包路径序列、DERP 到 Peer Relay/直连演进、延迟解析、过期判定、配置导入白名单和结构化 Netcheck。
- RuntimeClient 通过 mock KernelSU spawn、legacy exec 和 Android fallback 测试成功、非零退出、stderr、timeout 和并发刷新。
- 运行 TypeScript typecheck、ESLint、Node tests、shell integration、shell syntax、npm audit、Parcel build、ZIP 内容与 SHA256 校验。
- 使用真实浏览器和 KernelSU bridge mock 检查移动视口：初始状态、Peer 探测、健康检查、报告复制、配置导入、隐藏/恢复刷新、无 console error。
- 发布后通过 GitHub API 回读 main、Tag、Release、update JSON 和 asset digest，并重新下载两个 ZIP 校验。

## 假设与开放问题

- watchdog 默认关闭，避免未经用户选择改变续航和故障行为。
- 日志默认上限采用保守值，由实现阶段依据现有日志量选择；WebUI 可调整但必须限定合理范围。
- KernelSU Next 覆盖升级已于 2026-08-07 使用 `v2.4.0.3` 真机验证通过；CI 固定 KernelSU Next v3.2.0 官方 BusyBox，并在 `ASH_STANDALONE=1` 下运行 shell 回归。
- Magisk、APatch 真机覆盖仍未验证；保留可执行真机回归清单并明确该覆盖缺口。

## 风险与依赖

- `tailscale ping` 人类可读输出可能随 Android CLI 版本变化；解析必须保留未知路径和原始输出，而不是失败或误报。
- Android BusyBox/Toybox 命令差异可能影响 watchdog、日志大小和超时实现；脚本只能使用当前模块已依赖且测试覆盖的可用命令。
- `config.env` 是 shell 文件；升级验证不能执行未受信任的新内容或把秘密写入诊断报告。
- watchdog 错误识别主动停止会造成重启循环，因此主动停止标记和退避测试是发布阻断项。
- 发布工作流依赖 GitHub Actions 与 Release API；本地构建和手动回读仍作为失败回退路径。

## 范围外

- Android 内核升级、刷写或内核配置修改。
- 替换为非 Android 专用的 Tailscale core 二进制。
- 持续后台 Ping、自动 Netcheck 或高频链路探测。
- 向上游仓库创建或更新 PR。
- 导出 `tailscaled.state`、节点密钥、SSH 私钥、证书或其他敏感状态。

## 参考

- `README.md`
- `docs/webui-and-runtime.md`
- `customize.sh`
- `tailscale/settings.sh`
- `tailscale/scripts/start.sh`
- `tailscale/scripts/tailscaled.config`
- `tailscale/scripts/tailscaled.service`
- `webui/src/app.ts`
- `webui/src/peers.ts`
- `.github/workflows/release.yml`
- `.github/tools/build.sh`
- `tests/test-config.sh`
- Commit `95721dd` (`v2.3.1.0`)

## 完成提示 <!-- prd:completion -->

实现本 PRD 并完成所需验证后，对任务 diff 运行 `skills/simplify-code`。只应用本 PRD 范围内有依据、保持行为不变的简化，然后重新运行受影响验证。

对最终简化后的 diff 运行一次 `skills/code-review`。同时覆盖 Standards 和 Spec，并修复或明确报告所有发现。

只有在实现、简化、验证和最终审查全部完成后，才能把本文件顶部的 `status` 从 `待实现` 改为 `已完成`。

然后询问用户是否调用 `skills/task-closeout`。持久文档和时间线的路由交给该工作流，未经用户确认不得运行。
