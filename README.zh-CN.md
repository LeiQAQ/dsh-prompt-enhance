<p align="center">
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/License-MIT-blue.svg"></a>
  <img alt="tests" src="https://img.shields.io/badge/tests-214%20passing-brightgreen">
  <img alt="kernel changes" src="https://img.shields.io/badge/host%20kernel%20changes-0-success">
  <img alt="platform" src="https://img.shields.io/badge/platform--agnostic%20core-8A2BE2">
</p>

[English](README.md) | **简体中文**

# ✦ 妙笔 · Prompt Enhance (`dsh-prompt-enhance`)

> **一键把随手写的草稿变成高质量提示词** —— 生在 agent 输入框里的 ✦ 按钮，用会话当前的模型，一次调用，失败绝不动原文。生而用于 DeepSeek Harness，生而不止于它：平台无关内核 + 薄适配层，可接入任何 agent 框架。

> One-click prompt enhancement, built into your agent's composer — a ✦ button that turns a rough draft into a high-quality prompt, running on the model your session already uses. Built for DeepSeek Harness, designed to port to any agent framework. (English docs: [README.md](README.md))

你有没有过这样的时刻：对着输入框敲了半句「帮我写个产品介绍」，自己都觉得这提示词拿不出手？妙笔就生在输入框里 —— 点一下 ✦，会话当前的模型立刻把你的草稿改写成目标、结构、约束都交代清楚的提示词；不满意，再点一下小按钮随时还原。

对标 WorkBuddy 的同名能力，且**零改动 dsh 内核** —— 只用公开扩展点：`ctx.commands` / `ctx.llm` / slot / 已挂载的 `remote.commands` 命名空间。

- 形态：双半插件（host `dist/index.js` + client `dist/client.cjs`），`link:` 挂载进 profile
- 许可：MIT
- 兼容：DSH Desktop 2.0.5（`@deepseek-ai/*` `0.1.2-rc.1`）验证通过；dsh 生态后续版本以 `npm run verify:install` 实测为准

---

## 为什么做这个项目

**1. 你的原文永远不会丢。** 失败契约是这个插件最较真的地方：任何失败 —— 超时、模型报错、网络中断、输出为空 —— 草稿**逐字符不变**；按钮转警告态并给出人话原因 + 机器诊断码；再点即重试。增强中再点一次是**真中断**（`AbortSignal` 直达模型 provider，不是前端摆设）。结果落地前比对 `(text, draftRev)`，你中途手改过的草稿永远不会被迟到的结果覆盖。

**2. 隐私优先的传输设计。** 草稿从不以明文形态上路 —— UTF-8 字节编码为 unpadded base64url token（`b64:` 前缀），`recordInput: false` 让命令日志连 token 都不留；host 日志只记长度、耗时与结果码，不记正文。

**3. 工程级可信。** 214 个离线单测（不需要浏览器和模型）；`npm run verify` 一键串联提示词资产哈希校验 → 构建 → 全部单测 → 装载检查；`verify:install` 专查只有装机时才暴露的坑（link 落地、图标导出表、座席撞车）。`docs/` 里有两份带完整取证链的事故复盘 —— 我们把踩过的坑变成了工具和守卫，而不是注释里的「注意」。

**4. 平台无关的内核。** 见[架构与扩展性](#架构与扩展性)。这不是口号：host 半边对 dsh 包**零运行时值导入** —— 全部能力经 `ctx` 结构化到达；共享协议层是纯函数。移植到别的 agent 框架 = 实现四个适配函数。

---

## 功能

| 场景 | 行为 |
|---|---|
| 草稿非空 | 按钮可用；点击 → 转圈 → 输入框内容被改写后的提示词替换 |
| 草稿为空/全空格 | 按钮 `disabled`，hover 提示「先写点内容再增强」 |
| 增强中再点一次 | **真中断**（`AbortSignal` 直达 provider），回到 `idle`，不报错 |
| 增强中用户手改草稿 | 迟到的结果**静默丢弃**，不覆盖、不报错 |
| 任意失败 | 草稿**逐字符不变**；警告态 + 可读原因 + 机器诊断码；再点即重试 |
| 成功后 | 出现「恢复原文」小按钮；用户一编辑该按钮即消失 |
| 切换会话 | 进行中的增强绝不会落进另一个会话的输入框 |

失败文案统一带一句「原文没动」/「Your text is untouched」—— 这是整个失败契约里最要紧的一句。

**位置与外观**：`conversation.input.right` 槽、`order = 40`（紧贴模型选择器左侧）、四角星图标、28×28 幽灵按钮 —— 全部读 `--dsw-alias-*` 语义令牌，随主题自适应。

**命令入口**：`/enhance-prompt <文字>` 同样可用（也可作手工测试入口）。

---

## 架构与扩展性

### 分层：内核与平台各归其位

```
┌────────────────────────────────────────────────────────────┐
│                    平台适配层（薄，可替换）                    │
│   host: apply() 注册命令 (~10 行) · resolveSelection() 会话模型  │
│   client: apply() 注册槽位 · startRewrite → remote 通道        │
├────────────────────────────────────────────────────────────┤
│                  能力契约层（结构化，不 import 平台包）          │
│   llm.js 流式终态分类 · deadline.js 超时预算 · errors.js 错误归一  │
├────────────────────────────────────────────────────────────┤
│                领域内核层（纯函数，100% 平台无关）              │
│   shared/codec.js base64url 编解码 · shared/codes.js 错误码    │
│   host/prompts.js 提示词资产（sha256 锚点）                    │
│   client/state.js 状态机 · transport.js 传输解释               │
└────────────────────────────────────────────────────────────┘
```

这个分层不是事后包装，而是写代码时的硬约束，源码头注可查：

- **host 半边零运行时值导入**（`src/host/index.js`）：「every host capability arrives through `ctx`, and the `Message`/`StreamChunk` shapes are handled structurally」—— 对 dsh 包没有一行 import，模型消息与流式分块全按结构处理。
- **可判定逻辑全部是纯函数**：状态机、传输解释、错误归一化、编解码，无一依赖平台对象 —— 这也是 214 个测试能在 CI 里离线跑完的原因。
- **提示词资产独立成文件**（`src/host/prompts.js`）：带 sha256 锚点防「抄漏一行」式劣化，换平台时资产原样带走。

### 移植到另一个 agent 框架 = 四个适配函数

| # | 适配点 | 现有实现 | 你需要提供的等价物 |
|---|---|---|---|
| 1 | 命令注册 | `ctx.commands.register({ name, recordInput: false, handler })` | 框架的自定义斜杠命令/工具注册 API |
| 2 | 会话模型解析 | `resolveSelection(agent)` 读当前路由 | 「这个会话用的是哪个模型」的查询 |
| 3 | 流式模型调用 | `llm.stream({ system, messages, signal })` + 终态分类 | 任意 OpenAI 兼容 API / 框架内置 LLM 门面 |
| 4 | 输入框 UI 座席 | `ctx.slots` 槽位 + `remote.commands` 通道 | 框架的输入区扩展点；纯前端构建可直连 LLM API，省去 #1/#2 |

其余全部照搬：领域内核零改动，失败契约（原文不动 + 诊断码）、CAS 竞态保护、取消语义、隐私编码，都是平台无关的设计 —— 换框架不会打折。

> **Roadmap**：欢迎把适配层做成独立包提回来（`adapters/<your-platform>/`），核心层保持不动。愿望单第一个：Claude Code / 任意 OpenAI 兼容端点的纯前端版。

### 与「另一个提示词优化网页」的区别

独立优化工具让你把想法**复制出去**、拿到结果再**粘贴回来**，你在会话里正在干什么的上下文全部丢失。妙笔生在输入框里：用**会话当前路由到的模型**、改写**当前草稿**、结果**原地落地**、失败**绝不动原文** —— 这四件事合在一起，才叫「增强提示词」，而不是「又开了一个聊天窗口」。

---

## 安装与快速上手

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

DSH Desktop 是 Electron 且带**单实例锁**：进程还在跑时再去双击启动器，不会产生新进程，只是把已有窗口拉到前台。客户端 roster 与 host 模块都是**启动时读一次**的，所以这种「假重启」之后插件不出现/改动不生效，**且没有任何报错**。

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

## Codex Desktop 输入框按钮（实验性）

仓库现在包含一个独立的 Codex Desktop UI Adapter。它不修改 Codex 安装目录或 `app.asar`，而是连接到用户明确开启的 Chromium DevTools Protocol 端口，在输入框底部工具栏的权限控件与推理/模型控件之间挂载 `✦` 按钮。

按钮严格执行以下流程：

```text
点击“提示词增强”
  → 读取当前输入框内容
  → 调用 DeepSeek/本地 OpenAI-compatible 增强服务
  → 增强结果回填到输入框
```

### 启动方式（Windows）

1. 保存当前 Codex 草稿并退出 Codex。必须退出旧实例，否则单实例机制可能不会开启调试端口。
2. 使用调试端口启动 Codex：

```powershell
$codex = (Get-AppxPackage -Name OpenAI.Codex).InstallLocation + '\app\ChatGPT.exe'
Start-Process -FilePath $codex -ArgumentList '--remote-debugging-port=9222','--remote-allow-origins=*'
```

3. 在仓库根目录配置增强服务。DeepSeek 和本地服务都使用 OpenAI-compatible `chat/completions` 端点；本地服务可以不设置 API Key：

```powershell
$env:PROMPT_ENHANCE_ENDPOINT = 'https://your-provider.example/v1/chat/completions'
$env:PROMPT_ENHANCE_MODEL = 'your-model'
$env:PROMPT_ENHANCE_API_KEY = 'your-key'
npm run adapter:codex:win
```

Windows 启动脚本会从当前用户环境重新读取 provider 配置；仓库不保存 API Key。也可以直接运行 `npm run adapter:codex`，但当前终端必须已经有这三个环境变量。

适配器成功连接后会输出 `button: true`。输入框内容发生变化、任务切换、请求取消、超时或服务失败时，旧结果不会回填。当前适配器依赖 Codex Desktop 的 `.ProseMirror` 输入框和 `data-composer-navigation-target` 挂载标记；Codex 更新后如果探测失败会退出，不执行不确定的 DOM 操作。

该能力是非官方运行时适配，不等同于官方插件原生 composer API；官方 Codex Skill 位于 `plugins/codex-prompt-enhance`，可作为没有 UI 适配时的降级入口。

## 使用示例

**按钮是主入口。** 输入（或粘贴）一段粗糙的草稿，点 ✦，稍等片刻，输入框里就是增强后的提示词。转圈期间再点 ✦ 是真取消；成功后用小按钮一键还原。

**斜杠命令是等价路径**（也是顺手的手工测试入口）：

```
/enhance-prompt 帮我写个产品介绍，要简洁
```

工具栏按钮实际发送的是编码传输形态 —— 同一条命令、不透明载荷：

```
/enhance-prompt b64:5Y2X55S15a2m55Sf...
```

**随时可跑的健康检查：**

```bash
npm run check:restart    # 我需要真重启吗？
npm run verify           # 提示词哈希 → 构建 → 全部单测 → 装载检查
npm test                 # 只跑 214 个离线单测
```

**效果示意**（示意，非承诺输出）：

```
草稿：    帮我写个产品介绍
增强后：  一条交代了目标、受众、结构、语气与长度约束的
         完整 prompt —— 直接发送即可
```

---

## 配置

| 项 | 方式 | 默认 |
|---|---|---|
| 调用超时 | `cordis.patch.yml` 的 `config.timeoutMs` | `120000`（120 秒） |
| 草稿长度上限 | `src/shared/protocol.js` 的 `MAX_DRAFT_LENGTH` | `20000` 字符（超限在客户端本地拦截，不花往返） |
| 模型 | 无需配置 —— 自动跟随会话当前生效模型；回落部署默认；两者都没有时报 `no_model` 并给出指引 | 会话模型 → 部署默认 |
| 提示词资产 | `src/host/prompts.js`（带 sha256 锚点，`npm run verify:prompts` 校验，防止「抄漏一行」式劣化） | WorkBuddy 同款资产逐字符复用 |

---

## 常见问题（FAQ）

**按钮不出现。**
三个常见原因，按概率排序：(1) 假重启 —— 跑 `npm run check:restart` 然后真退出再启；(2) 只装了一个 profile —— 桌面端默认启动 `desktop`，两个都要装；(3) roster 不匹配 —— 跑 `verify-install` / `verify-profile-roster`，它们能精确指出来。

**提示「no model / this session has no routed model yet」。**
插件刻意使用会话自己的模型而不是写死一个。先发一条消息（让会话建立路由），或设置默认模型，然后重试。

**我的草稿被发到哪里去了？**
只发给你会话本来就在用的模型 provider，别无去处。传输中是 base64url token；`recordInput: false` 让它进不了会话日志；host 日志只记长度、耗时与结果码。

**为什么每次增强会在会话里留一个命令节点？**
命令通道的固有形态 —— `recordInput: false` 能藏住参数，藏不住节点本身。它永远不会进入模型上下文。

**`verify:install` 报 `seat order tie`。**
有别的插件占了 order 40。改 `src/client/index.js` 里的 `SEAT_ORDER`（顺手更新测试常量）。

**和插件市场里的 `dsh-prompt-enhance` 是同一个吗？**
不是 —— 那个条目是另一位作者的（rongxingda）。本项目通过本地 `link:` 挂载，重名纯属巧合、不构成冲突。

**能移植到其他 agent 框架（Claude Code 等）吗？**
架构就是为此设计的 —— 见上文四个适配点。跨平台适配目前是架构承诺而非现成适配器，欢迎提 PR。

**增强要花钱吗？**
就是一次普通的模型调用，走你会话现有的路由 —— 消耗你已有的配额，没有别的开销。

---

## 已知限制

- 每次增强会在会话里留一个命令节点（`command/run` + `command/done`）。命令通道的固有形态，`recordInput: false` 只能隐藏 `args`；它进不了模型上下文。
- 座席 `order` 硬编码 40；撞车会被 `verify:install` 以 `seat order tie` 抓住 —— 改 `src/client/index.js` 的 `SEAT_ORDER`（并更新测试常量）。
- 平台假设必须在生效的那份 dsh 安装上核。本机若有多份 dsh，前端 bundle、图标导出表都可能不同 —— 校验脚本从 profile 解析路径，从不写死。
- F10（本地统计）、F11（配置页）未实现；超时值靠 `cordis.patch.yml` 的 `config.timeoutMs` 调（默认 120 秒）。
- 包名 `dsh-prompt-enhance` 与社区插件市场的同名条目（作者 rongxingda）重名。本插件是本地 `link:` 挂载，不冲突 —— 但别把两者搞混。

---

## 贡献

见 [CONTRIBUTING.md](CONTRIBUTING.md)。提 issue 时请附 `npm run verify` 输出与 `npm run check:restart` 结论 —— 大部分「插件坏了」其实是「没真重启」。跨平台适配是当前最欢迎的贡献方向。

## License

[MIT](LICENSE)

---

如果这个项目帮到了你，欢迎点一个 **Star** ⭐ —— 它是独立开发项目最真实的反馈。
