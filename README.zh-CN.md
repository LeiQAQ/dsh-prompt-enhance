[English](README.md) | **简体中文**

# ✦ 妙笔 · Prompt Enhance

**在 AI Agent 输入框中，一键把随手写下的草稿改成更清楚的提示词。**

妙笔读取当前草稿，调用配置的模型改写，再把结果写回输入框，供你检查和发送。它帮助整理表达、目标与已有约束；不会执行草稿中的任务、自动补齐未知事实或自动发送消息。

项目始于 DeepSeek Harness，如今提供 **DSH 原生插件、T3 输入框本地适配、Codex Desktop 实验性适配与 Codex 技能入口**。增强逻辑与平台接口分离，包名继续使用 `dsh-prompt-enhance`。

## 最新变化 · 2026-11-16

- **新增 T3 输入框适配**：模型选择器旁的 `✦` 支持原地改写、再次点击取消、`↶` 恢复原文；编辑草稿或切换会话后，旧结果不会覆盖新输入。
- **推荐 DeepSeek Flash · 关闭思考**：T3 可直接调用官方 API，明确发送 `thinking: { "type": "disabled" }`。本机短草稿测试约 1 秒完成；这是小样本观测，不是性能承诺。
- **增强模型独立配置**：T3 可使用 DeepSeek 或 Codex CLI，不随聊天模型切换。
- **加入后台与安装保护**：回环地址监听、请求授权、取消和错误保护；安装前备份，提供卸载路径。详见 [更新记录](CHANGELOG.md)。

## 平台与能力

| 入口 | 当前状态 | 模型来源 | 指南 |
|---|---|---|---|
| DeepSeek Harness / DSH | 原生插件；历史验证 DSH Desktop 2.0.5 | 当前会话路由 → 部署默认 | [DSH 安装](docs/dsh-installation.zh-CN.md) |
| T3 Code | 实验性本地适配；验证于 macOS、ad-hoc 签名的 `0.1.9-zh.1` | 独立配置的 DeepSeek 官方 API 或 Codex CLI | [T3 安装、模型与卸载](docs/t3-composer.md) |
| Codex Desktop | 实验性 CDP 适配；历史验证 Windows | 配置的 OpenAI-compatible API | [Codex 适配说明](docs/codex-enhance-button-实现总结.md) |
| Codex 技能 | 无输入框按钮时的对话入口 | 运行技能的 Codex 模型 | [prompt-enhance 技能](plugins/codex-prompt-enhance/skills/prompt-enhance/SKILL.md) |

**不同平台的实现与能力有所区别。** DSH 使用公开扩展点，不修改宿主内核；T3 安装器会修改应用 HTML 启动入口、更新完整性校验并重新进行本地 ad-hoc 签名；Codex Desktop 使用用户主动开启的 CDP，不修改应用安装文件。这些桌面适配不等同于平台官方插件 API，也不代表任意版本均兼容。

## 使用体验

```text
写下草稿 → 点击 ✦ → 检查改写结果 → 自行发送
```

DSH 和 T3 支持空输入拦截、再次点击取消、失败保留原文、编辑或切换会话后丢弃旧结果，以及成功后恢复原文。继续编辑会清除这次恢复入口。

Codex Desktop 已有改写、取消与防覆盖保护，尚未提供与 DSH/T3 相同的专用恢复按钮；技能入口只返回文字，不自动读取或回填原生输入框。

适合整理开发任务、编辑要求、产品描述、文案草稿和已有约束。它不是事实核验工具，不会自动读取完整聊天记录、仓库或附件来补充背景；发送前仍需检查结果。

## 推荐适配模型

| 模型 / 设置 | 建议用途 | 接入现状 |
|---|---|---|
| **DeepSeek Flash · 关闭思考**（`deepseek-flash`） | **首选速度方案**：日常提示词润色、口语化任务整理、短草稿改写 | T3 已实现并验证官方 API 直连；后台读取已有 CC Switch 凭据 |
| DeepSeek Flash · low 思考 | 需要额外推敲表达或约束时的评估候选 | 已单独测速；当前 T3 DeepSeek 路线固定关闭思考，未提供 low 配置 |
| GPT-6 Luna · low | 已使用 Codex 登录，希望延续现有路线的日常改写 | T3 Codex CLI 路线已测试 |
| GPT-6.1 Sol · low | 延用既有配置，或在复杂草稿上自行评估改写质量 | T3 安装器初始默认；已测试 |
| GPT-6.1 Terra · low | 已有 Terra 工作流时的可选评估对象 | T3 Codex CLI 路线已测试，未显示稳定速度优势 |

**推荐配置不等于安装器默认值。** 新装 T3 适配仍默认 Sol；要使用 Flash 关闭思考，请按 [T3 配置指南](docs/t3-composer.md#deepseek-flash) 切换。DSH 跟随宿主路由；Codex Desktop 的启动入口目前未暴露思考开关，高级模型参数需另行适配。

[模型选择与测速](docs/model-selection.md) 列出了逐次耗时、调用路径、缓存情况与限制。DeepSeek 直连 API 和 Codex CLI 的结果比较完整调用体验，不能当作纯模型推理速度排名。

## 开始使用

```sh
git clone https://github.com/LeiQAQ/dsh-prompt-enhance.git
cd dsh-prompt-enhance
npm ci
npm run build
```

再选择对应平台的指南；克隆仓库或安装技能本身不会自动给所有宿主添加按钮。

- **DSH**：[挂载 web / desktop profile 并验证加载](docs/dsh-installation.zh-CN.md)。
- **T3（macOS）**：阅读签名和版本要求后运行 `python3 adapters/t3/install.py`，随后配置推荐模型。
- **Codex Desktop**：按 [CDP 适配说明](docs/codex-enhance-button-实现总结.md) 启动应用与 `npm run adapter:codex`。

## 草稿与凭据

草稿会发送给配置的模型服务，消耗对应 API 余额或账号配额。T3 DeepSeek 路线通过 HTTPS 请求官方 API；API Key 只在后台使用，不放入前端、仓库或妙笔配置文件。后台不保存草稿与输出正文日志。

DSH 的 `b64:` 是传输编码，**不是加密**；`recordInput: false` 避免命令日志记录草稿参数。完整会话不会自动加入增强请求。

## 当前边界

- DSH/T3 草稿上限为 20,000 字符。T3 会保护性拒绝包含文件、技能或模型引用标记的富文本，外部附件不会发送给增强模型。
- T3 依赖当前 DOM/Tiptap 接口与本机服务，更新应用后可能需要重新核验、安装；移动源码目录后须调整 LaunchAgent 路径。
- T3 的 DeepSeek 凭据来源目前仅实现 CC Switch；部分 Node 22 版本会显示 `node:sqlite` 实验性功能警告。
- 各适配器的版本验证范围见文档；短草稿测速不代表复杂任务质量或长期可用性。

## 开发与文档

没有运行时 npm 依赖；开发测试使用 Playwright。执行 `npm ci` 后，按 [贡献指南](CONTRIBUTING.md) 准备测试浏览器。

```sh
npm run verify:prompts
npm run build
npm test
python3 -m unittest discover -s tests -p 't3_install_test.py' -v
```

2026-11-16 本机验证通过 235 项 JavaScript 测试和 2 项安装器测试。DSH 宿主装载检查还需要已挂载的 profile；不能仅凭跨平台测试通过就认定 DSH 安装成功。

[更新记录](CHANGELOG.md) · [贡献指南](CONTRIBUTING.md) · [模型选择](docs/model-selection.md) · [T3 适配](docs/t3-composer.md) · [DSH 传输排查](docs/enhance-transport-failure-diagnosis.md) · [Profile 加载排查](docs/profile-not-loading-diagnosis.md)

[MIT License](LICENSE)
