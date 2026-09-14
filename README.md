# 妙笔 · Prompt Enhance (`dsh-prompt-enhance`)

<p align="center">
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/License-MIT-blue.svg"></a>
  <img alt="tests" src="https://img.shields.io/badge/tests-214%20passing-brightgreen">
  <img alt="kernel changes" src="https://img.shields.io/badge/host%20kernel%20changes-0-success">
  <img alt="platform" src="https://img.shields.io/badge/platform-agnostic%20core-8A2BE2">
</p>

> **一句话简介**：一个功能强大的提示词增强器插件 —— 在 agent 的输入框里加一颗 ✦，把随手的草稿一键变成高质量提示词。生而用于 DeepSeek Harness，**生而不止于 DeepSeek Harness**：平台无关的核心 + 薄适配层，让同一套能力可以便捷接入任何 agent 框架。

你有没有过这样的时刻：对着输入框敲了半句「帮我写个东西」，自己都觉得这提示词拿不出手？妙笔就是为这一刻准备的 —— 不用离开输入框、不用切换工具，点一下 ✦，会话当前的模型立刻把你的草稿改写成结构完整、约束清晰的提示词，改坏了随时一键还原。

对标 WorkBuddy 的同名能力，且**零改动 dsh 内核** —— 只用公开扩展点：`ctx.commands` / `ctx.llm` / slot / 已挂载的 `remote.commands`。

- 形态：双半插件（host `dist/index.js` + client `dist/client.cjs`），`link:` 挂载进 profile
- 许可：MIT
- 兼容：DSH Desktop 2.0.5（`@deepseek-ai/*` `0.1.2-rc.1`）验证通过；dsh 生态后续版本以 `npm run verify:install` 实测为准

---

## ✨ 项目亮点

**1. 真取消，真安全，绝不弄丢你的原文。**
失败契约是这个插件最较真的地方：任何失败（超时、模型报错、网络中断、结果为空），草稿**逐字符不变**；按钮转警告态并给出人话原因 + 机器诊断码；再点即重试。增强中再点一次是**真中断**（`AbortSignal` 直达模型 provider，不是前端摆设）。结果落地前比对 `(text, draftRev)`，你中途手改过的草稿永远不会被迟到的结果覆盖。

**2. 隐私优先的传输设计。**
草稿从不以明文形态上路 —— UTF-8 字节的 unpadded base64url token（`b64:` 前缀），`recordInput: false` 让命令日志连 token 都不留；host 日志只记长度、耗时与结果码，不记正文。

**3. 工程级可信：不是"能跑"，是"可证明"。**
214 个离线单测（不需要浏览器和模型）；一键 `npm run verify` 串联提示词资产哈希校验 → 构建 → 全部单测 → 装载检查；`verify:install` 专查只有装机时才暴露的坑（link 落地、图标导出表、座席撞车）。`docs/` 里有两份带完整取证链的事故复盘 —— 我们把踩过的坑变成了工具和守卫，而不是注释里的"注意"。

**4. 平台无关的内核，薄到可以数清的适配面。**
见下文[通用架构与扩展性](#-通用架构与扩展性)。这不是口号：host 半边对 dsh 包**零运行时值导入**，全部能力经 `ctx` 结构化到达；两半共用的协议层是纯函数。移植到别的 agent 框架 = 实现四个适配函数。

---

## 核心功能

| 场景 | 行为 |
|---|---|
| 草稿非空 | 按钮可用；点击 → 转圈 → 输入框内容被改写后的提示词替换 |
| 草稿为空/全空格 | 按钮 `disabled`，hover 提示「先写点内容再增强」 |
| 增强中再点一次 | **真中断**（`AbortSignal` 直达 provider），回到 `idle`，不报错 |
| 增强中用户手改草稿 | 结果到达后**静默丢弃**，不覆盖、不报错 |
| 任意失败 | 草稿**逐字符不变**；显示可读原因 + 机器诊断码；再点即重试 |
| 成功后 | 出现「恢复原文」小按钮；用户一编辑该按钮即消失 |
| 切换会话 | 进行中的增强不会写进另一个会话的输入框（按会话绑定，天然隔离） |

失败文案统一带一句「原文没动」/「Your text is untouched」——这是整个失败契约里最要紧的信息。

**位置与外观**：`conversation.input.right` 槽、`order = 40`（紧贴模型选择器左侧）、四角星图标、28×28 幽灵按钮，全部读 `--dsw-alias-*` 语义令牌随主题适配。

**命令入口**：`/enhance-prompt <文字>` 同样可用（也可作手工测试入口）。

---

## 🧩 通用架构与扩展性

### 分层：内核与平台各归其位

```
┌────────────────────────────────────────────────────────────┐
│                    平台适配层（薄，可替换）                    │
│   host: apply() 注册命令 (~10 行) · resolveSelection() 会话模型  │
│   client: apply() 注册槽位 · startRewrite → remote 通道        │
├────────────────────────────────────────────────────────────┤
│                    能力契约层（结构化，不 import 平台包）        │
│   llm.js 流式终态分类 · deadline.js 超时预算 · errors.js 错误归一  │
├────────────────────────────────────────────────────────────┤
│                    领域内核层（纯函数，100% 平台无关）           │
│   shared/codec.js base64url 编解码 · shared/codes.js 错误码    │
│   host/prompts.js 提示词资产（sha256 锚点）                    │
│   client/state.js 状态机 · client/transport.js 传输解释        │
└────────────────────────────────────────────────────────────┘
```

这个分层不是事后包装，而是写代码时的硬约束，源码头注可查：

- **host 半边零运行时值导入**（`src/host/index.js`）：「every host capability arrives through `ctx`, and the `Message`/`StreamChunk` shapes are handled structurally」—— 对 dsh 包没有一行 import，模型消息与流式分块全按结构处理；
- **可判定逻辑全部是纯函数**：状态机、传输解释、错误归一化、编解码，无一依赖平台对象，也是 214 个离线测试能在 CI 里跑完的原因；
- **提示词资产独立成文件**（`src/host/prompts.js`）：带 sha256 锚点防「抄漏一行」式劣化，换平台时资产原样带走。

### 移植到另一个 agent 框架 = 四个适配函数

平台耦合面被刻意压到最小，全部适配工作就是：

| # | 适配点 | 现有实现 | 你需要提供的等价物 |
|---|---|---|---|
| 1 | 命令注册 | `ctx.commands.register({ name, recordInput: false, handler })` | 框架的自定义斜杠命令/工具注册 API |
| 2 | 会话模型解析 | `resolveSelection(agent)` 读当前会话的路由 | 框架的"当前会话用的是哪个模型"查询 |
| 3 | 模型流式调用 | `llm.stream({ system, messages, signal })` + 终态块分类 | 任意 OpenAI 兼容 API / 框架内置 LLM 门面 |
| 4 | 输入框 UI 座席 | `ctx.slots` 槽位 + `remote.commands` 通道 | 框架的输入区扩展点；纯前端框架甚至可直连 LLM API 省去 #1/#2 |

其余全部照搬：领域内核零改动，失败契约（原文不动 + 诊断码）、CAS 竞态保护、取消语义、隐私编码，都是平台无关的设计，换框架不会打折。

> **Roadmap**：欢迎把适配层做成独立包提回来（`adapters/<your-platform>/`），核心层保持不动。第一个想看的：Claude Code / 任意 OpenAI 兼容端点的纯前端版。

### 与"另一个提示词优化工具"的区别

市面上的同类能力通常是独立网页或独立应用：你要把想法**复制出去**，拿到结果再**粘贴回来**，上下文（你在这个会话里正在干什么）全部丢失。妙笔生在输入框里：用**会话当前生效的模型**（带着你会话的上下文路由）、改写**当前草稿**、结果**原地落地**、失败**绝不动原文** —— 这四件事合在一起，才是"增强提示词"而不是"又开了一个聊天窗口"。

---

## 安装

前提：本机已装 DSH Desktop，且 `~/.dsh/profiles/` 下有 `web` / `desktop` 两个 profile。

```bash
# 0. 克隆并构建
git clone https://github.com/LeiQAQ/dsh-prompt-enhance.git
cd dsh-prompt-enhance
npm run build          # → dist/index.js + dist/client.cjs

# 1. 挂进 profile —— web 与 desktop 两个都要挂
#    （桌面端启动哪个 profile 由 %APPDATA%\DSH Desktop\profile-selection\state.json
#      的 "active" 决定，默认 desktop；只装 web 会静默无图标、无报错）
#
#    各自的 ~/.dsh/profiles/<p>/package.json：
#      dependencies 加：
#        "dsh-prompt-enhance": "link:<本仓库克隆路径>"
#      dsh.profile.bundles 加：
#        "dsh-prompt-enhance"

# 2. 让 profile 的 node_modules 真的能看到它（link: 依赖需要落一个链接）
#    Linux/macOS:  ln -s <本仓库克隆路径> ~/.dsh/profiles/<p>/node_modules/dsh-prompt-enhance
#    Windows:      New-Item -ItemType Junction `
#                    -Path "$env:USERPROFILE\.dsh\profiles\<p>\node_modules\dsh-prompt-enhance" `
#                    -Target "<本仓库克隆路径>"

# 3. 确认装载（对每个 profile 各跑一次）
node scripts/verify-install.mjs
node scripts/verify-profile-roster.mjs --profile "$USERPROFILE/.dsh/profiles/web"
node scripts/verify-profile-roster.mjs --profile "$USERPROFILE/.dsh/profiles/desktop"
```

重启 DSH Desktop 后，输入框右侧工具条出现四角星按钮。

### ⚠️ 「重启」必须是真重启 —— 再点一次图标不算

DSH Desktop 是 Electron 且带**单实例锁**：进程还在跑时再去双击启动器，不会产生新进程，只是把已有窗口拉到前台。客户端 roster 与 host 模块都是**启动时读一次**的，所以这种"重启"之后插件不出现/改动不生效，**且没有任何报错**。

自查（直接告诉你到底要不要重启）：

```bash
npm run check:restart
#   ok   no DSH Desktop instance is running — just launch it …
# 或
#   FAIL FULL RESTART REQUIRED — the running instance booted at … , but desktop last changed at …
```

要真退出，别点窗口的 ×（可能只是收进托盘）：

```powershell
Stop-Process -Name "DSH Desktop" -Force
# 或右键托盘图标 → Quit
```

**卸载**：从 `dsh.profile.bundles` 移除条目 → 重启。要彻底清干净再删 `node_modules` 里的链接和 `dependencies` 条目。

---

## 配置

| 项 | 方式 | 默认 |
|---|---|---|
| 调用超时 | `cordis.patch.yml` 的 `config.timeoutMs` | `120000`（120s） |
| 草稿长度上限 | `src/shared/protocol.js` 的 `MAX_DRAFT_LENGTH` | `20000` 字符（超限在客户端本地拦截，不花往返） |
| 模型 | 无需配置 —— 自动跟随会话当前生效模型；拿不到时报 `no_model` 并给出指引 | 会话模型 → 部署默认 |
| 提示词资产 | `src/host/prompts.js`（带 sha256 锚点，`npm run verify:prompts` 校验，防止"抄漏一行"式劣化） | WorkBuddy 同款资产逐字符复用 |

---

## 校验与测试

```bash
npm run verify          # prompts 哈希 → 构建 → 全部单测 → 装载检查
npm run verify:prompts  # 只校验 prompt 资产哈希
npm test                # 只跑单测（214 个离线用例，不需要浏览器和模型）
npm run verify:install  # 只跑装载检查（可 --profile <目录>）
```

`verify:install` 查的是只有装机时才会暴露的坑：`link:` 是否落地、`dsh.client.inject` 名字是否真是 client 插件入口、`cordis.patch.yml` 是否可解析、座席位置/命令名是否撞车、**从 primitives 导入的每个图标名是否真在前端 bundle 的导出表里**（平台模块是前端 shell 内置 seed word，磁盘上没有包——名字写错时构建、单测、npm 解析全通过，只有运行时渲染出一个空按钮）。

结构：

```
src/shared/    两半共用的唯一真相：协议常量、错误码、传输编解码（纯函数）
src/host/      ctx.commands 注册 + ctx.llm 单次调用 + 超时 + 模型路由解析
src/client/    座席组件、状态机、传输解释、文案、样式
scripts/       build / gen-prompts / verify-prompts / verify-install / verify-profile-roster / check-desktop-restart
tests/         214 个离线用例（fake React + fake module loader）
docs/          两份事故复盘（profile 不显示 / 传输失败），含完整取证链
```

---

## 设计要点

**为什么走命令通道**：client 半能用的 remote 命名空间在构建期就固定了，第三方插件开不出自己的命名空间，`ctx.remote.commands.execute(sessionId, line, images, signal)` 是前端唯一能触达 host 的通路。所以按钮 = 发一条 `/enhance-prompt …`。

**为什么草稿要 base64url 传输**：命令行的 rawInput 是空白分隔的文本，草稿里可能有换行、非 ASCII、甚至本身就是一条 `/命令`。编码传输 + `recordInput: false` 让日志里连 token 都不留。

**并发与竞态**：同一会话同时只允许一次增强。结果落地前比对 `(text, draftRev)` 这一对——只比文本会漏掉「编辑后文本恰好没变」的情况。座席按 `sessionId` 重挂载，跨会话语义天然隔离。

**LLM 终态判定**：`ctx.llm.stream` 的终态块是 `{ type: 'finish', reason: { kind, failure? } }`（`kind` 挂在 `reason` 上，见 `src/host/llm.js` 注释与 `docs/enhance-transport-failure-diagnosis.md` 的取证）；`stop` 成功，`error/aborted/max-tokens/tool-calls` 归一化为带标签错误。

---

## 已知限制

- **每次增强会在会话里留一个命令节点**（`command/run` + `command/done`）。这是命令通道的固有形态，`recordInput: false` 只能隐藏 `args`；它进不了模型上下文。
- **座席 `order` 硬编码 40**。若其他插件也占到 40，`verify:install` 会报 `seat order tie` —— 改 `src/client/index.js` 的 `SEAT_ORDER`（顺手更新测试常量）。
- **平台假设必须在生效的那份 dsh 安装上核**。本机若有多份 dsh（例如 `%APPDATA%\io.github.hairyf.deepseek-harness-desktop\dependencies\dsh\` 与独立安装的 DSHDesktop），前端 bundle、图标导出表都可能不同 —— 校验脚本从 profile 解析路径，不写死。
- **F10 本地统计、F11 配置页未实现**。超时值目前靠 `cordis.patch.yml` 的 `config.timeoutMs` 调，默认 120s。
- **包名 `dsh-prompt-enhance` 与社区插件市场的同名条目（作者 rongxingda）重名**。本插件是本地 `link:` 挂载，不冲突；但从市场装那个之前需注意区分。
- **跨平台适配（Claude Code / 其他 agent 框架）目前是架构承诺而非现成适配器**：四个适配点的契约见上表，欢迎按它实现并提 PR。

---

## 贡献

见 [CONTRIBUTING.md](CONTRIBUTING.md)。提 issue 时请附 `npm run verify` 输出与 `npm run check:restart` 结论——大部分「插件坏了」其实是「没真重启」。跨平台适配是当前最欢迎的贡献方向。

## License

[MIT](LICENSE)

---

如果这个项目帮到了你，欢迎点一个 **Star** ⭐ —— 它是独立开发项目最真实的反馈。
