# 妙笔 · Prompt Enhance (`dsh-prompt-enhance`)

给 [dsh](https://github.com/deepseek-ai) / DSH Desktop 的输入框加一个 ✦「增强提示词」按钮：把随手的草稿一键改写成更高质量的提示词。用**会话当前生效的模型**，一次调用，失败绝不动原文。

对标 WorkBuddy 的同名能力，但**零改动 dsh 内核** —— 只用公开扩展点：`ctx.commands` / `ctx.llm` / slot / 已挂载的 `remote.commands`。

- 形态：双半插件（host `dist/index.js` + client `dist/client.cjs`），`link:` 挂载进 profile
- 许可：MIT
- 兼容：DSH Desktop 2.0.5（`@deepseek-ai/*` `0.1.2-rc.1`）验证通过；dsh 生态后续版本以 `npm run verify:install` 实测为准

---

## 功能

| 场景 | 行为 |
|---|---|
| 草稿非空 | 按钮可用；点击 → 转圈 → 输入框内容被改写后的提示词替换 |
| 草稿为空/全空格 | 按钮 `disabled`，hover 提示「先写点内容再增强」 |
| 增强中再点一次 | **真中断**（`AbortSignal` 直达 provider），回到 `idle`，不报错 |
| 增强中用户手改草稿 | 结果到达后**静默丢弃**，不覆盖、不报错 |
| 任意失败 | 草稿**逐字符不变**；按钮转警告态并显示可读原因 + 机器诊断码；再点即重试 |
| 成功后 | 出现「恢复原文」小按钮；用户一编辑该按钮即消失 |
| 切换会话 | 进行中的增强不会写进另一个会话的输入框 |

失败文案统一带一句「原文没动」/「Your text is untouched」——这是整个失败契约里最要紧的信息。

**位置与外观**：`conversation.input.right` 槽、`order = 40`（紧贴模型选择器左侧）、`IconSparkle16` 四角星、28×28 幽灵按钮，全部读 `--dsw-alias-*` 语义令牌随主题适配。

**隐私**：草稿从不以明文形态上路 —— UTF-8 字节的 unpadded base64url token（`b64:` 前缀），`recordInput: false` 让命令日志连 token 都不留；host 日志只记长度、耗时与结果码。

**命令入口**：`/enhance-prompt <文字>` 同样可用（也可作手工测试入口）。

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
src/shared/    两半共用的唯一真相：协议常量、错误码、传输编解码
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

---

## 贡献

见 [CONTRIBUTING.md](CONTRIBUTING.md)。提 issue 时请附 `npm run verify` 输出与 `npm run check:restart` 结论——大部分「插件坏了」其实是「没真重启」。

## License

[MIT](LICENSE)
