[English](README.md) | **简体中文**

# ✦ 妙笔 · Prompt Enhance

**在 AI Agent 输入框中，一键将草稿整理成更清晰的提示词。**

妙笔读取你正在编辑的文字，调用配置的模型改写，再将结果返回供你检查和发送。它用于整理目标、表达和已有约束；不会执行草稿中的任务、自动补充未知事实或发送消息。

项目始于 DeepSeek Harness，现提供 DSH 原生插件、T3 输入框本地适配、Codex Desktop 实验性适配和 Codex 技能入口。增强逻辑与平台接口分离；项目名为“妙笔”，仓库与 npm 包名仍为 `dsh-prompt-enhance`。

## 适合谁使用

- **AI 编程工具用户**：在提交开发、排错或修改请求前，整理任务目标与已有要求。
- **经常编写提示词的用户**：润色产品描述、编辑要求和文案草稿，减少表达含糊或遗漏已有约束的情况。
- **集成与维护者**：了解各平台的接入方式、模型配置、兼容范围和验证步骤。

妙笔处理当前草稿，不会自动读取完整聊天记录、仓库或附件来补充背景，也不负责事实核验。请检查改写结果后再发送。

## 当前状态 · 2026-11-17

T3 适配器已更新至 **0.2.0**：真实增强请求期间，整个输入框显示彩色流动边缘和淡彩光晕；结果回填后淡出，取消、失败、编辑或切换会话时立即清除。支持系统“减少动态效果”偏好，不为展示动画而延迟结果。

T3 已接入 **DeepSeek Flash · 关闭思考**，增强模型独立于聊天模型配置。新安装的默认值仍是 GPT-6.1 Sol · low，需要手动切换到 Flash。详细变化见 [更新记录](CHANGELOG.md)。

## 平台支持

| 入口 | 实现与验证范围 | 增强模型来源 | 使用指南 |
|---|---|---|---|
| DeepSeek Harness / DSH | 原生插件；历史验证 DSH Desktop 2.0.5 | 当前会话路由 → 部署默认 | [DSH 安装](docs/dsh-installation.zh-CN.md) |
| T3 Code | 实验性本地适配；验证于 macOS、ad-hoc 签名的 `0.1.9-zh.1` | 独立配置的 DeepSeek 官方 API 或 Codex CLI | [T3 安装、模型与卸载](docs/t3-composer.md) |
| Codex Desktop | 实验性 CDP 适配；历史验证 Windows | 配置的 OpenAI-compatible API | [Codex 适配说明](docs/codex-enhance-button-实现总结.md) |
| Codex 技能 | 对话调用入口，不提供输入框按钮 | 运行技能的 Codex 模型 | [技能说明](plugins/codex-prompt-enhance/skills/prompt-enhance/SKILL.md) |

DSH 使用公开扩展点，不修改宿主内核。T3 安装器修改应用 HTML 入口、更新完整性校验并进行本地 ad-hoc 签名，保留备份及卸载路径。Codex Desktop 依赖用户开启 CDP，不修改应用安装文件。桌面适配不是平台官方插件 API，以上验证范围不代表其他版本也兼容。

## 功能与操作

```text
编辑草稿 → 点击 ✦ 增强 → 检查结果 → 自行发送
```

| 功能 | DSH | T3 | Codex Desktop | Codex 技能 |
|---|---|---|---|---|
| 读取草稿并原地回填 | 支持 | 支持 | 支持 | 由用户提供文字，返回改写结果 |
| 再次点击取消、失败保留原文 | 支持 | 支持 | 支持 | 不操作原生草稿 |
| 编辑或切换会话后阻止旧结果覆盖 | 支持 | 支持 | 支持 | 不自动回填 |
| 成功后用 `↶` 恢复原文 | 支持 | 支持 | 无专用按钮 | 不操作原生草稿 |
| 请求期间的整框彩色流光 | 未提供此效果 | 支持 | 未提供此效果 | 无输入框效果 |

DSH/T3 空草稿时禁用增强，草稿上限为 20,000 字符。继续编辑增强结果会清除本次恢复入口。T3 会拒绝改写含文件、技能或模型引用标记的富文本，以免破坏引用；普通外部附件不进入增强请求。

## 模型选择

以下建议主要针对 **T3 独立增强后台**，不改变主对话所用模型。

| 模型 / 设置 | 适用场景 | 当前接入情况 |
|---|---|---|
| **DeepSeek Flash · 关闭思考**（`deepseek-flash`） | 优先考虑响应速度的日常润色、口语化请求整理和短草稿改写 | 推荐配置；T3 官方 API 路线已实现并验证，后台只读引用 CC Switch 已有凭据 |
| GPT-6 Luna · low | 希望沿用已有 Codex 登录进行日常改写 | T3 Codex CLI 路线已测试 |
| GPT-6.1 Sol · low | 沿用安装器初始配置，或自行评估复杂草稿 | T3 安装器默认值；已测试 |
| GPT-6.1 Terra · low | 已有 Terra 工作流，希望评估同一路线 | T3 Codex CLI 路线已测试，未观察到稳定速度优势 |
| DeepSeek Flash · low 思考 | 对思考模式进行单独评估 | 已单独测速；当前 T3 DeepSeek 路线固定关闭思考，未提供 low 配置 |

使用 Flash 时，后台显式发送 `thinking: { "type": "disabled" }`。按 [T3 配置指南](docs/t3-composer.md#deepseek-flash) 切换，安装器不会自动选择 Flash 或查找其凭据。

DSH 跟随宿主模型路由；Codex Desktop 启动入口目前没有思考开关，高级参数需另行适配。短草稿测试中 Flash 曾约 1 秒完成，但这是本机小样本观测，不是延迟承诺或质量排名。逐次耗时、缓存情况与调用路径见 [模型选择与测速](docs/model-selection.md)；API 直连和 Codex CLI 的耗时不能视为纯模型推理速度比较。

## 安装入口

先获取项目并构建：

```sh
git clone https://github.com/LeiQAQ/dsh-prompt-enhance.git
cd dsh-prompt-enhance
npm ci
npm run build
```

再按对应平台完成接入；克隆仓库或安装技能不会自动给所有宿主添加按钮。

- **DSH**：按 [安装指南](docs/dsh-installation.zh-CN.md) 挂载 web / desktop profile，并验证加载。
- **T3（macOS）**：先阅读 [版本、签名与依赖要求](docs/t3-composer.md)，再运行 `python3 adapters/t3/install.py`。当前安装器要求 Node.js 22+、Python 3、codesign 和可用的 Codex CLI；DeepSeek 路线还需要 CC Switch 中已有有效配置。安装后重新加载 T3，再配置所需模型。
- **Codex Desktop**：按 [CDP 指南](docs/codex-enhance-button-实现总结.md) 启动应用与 `npm run adapter:codex`。
- **Codex 技能**：按 [技能说明](plugins/codex-prompt-enhance/skills/prompt-enhance/SKILL.md) 安装和调用。

已安装 T3 适配器的用户，更新本次前端效果只需更新源码、重启妙笔服务并重新加载 T3，无需重新签名应用。具体命令见 [T3 指南](docs/t3-composer.md)。

## 数据处理与使用限制

- 草稿会发送给配置的模型服务，消耗其 API 余额或账号配额。完整会话不会自动加入请求。
- T3 DeepSeek 路线通过 HTTPS 请求官方 API；Key 只在后台使用，不复制到前端、仓库或妙笔配置。后台不保存草稿与输出正文日志；凭据来源目前仅支持 CC Switch。
- DSH 的 `b64:` 是编码，**不是加密**；`recordInput: false` 用于避免命令日志记录草稿参数。
- T3 依赖当前 DOM/Tiptap 接口和本机服务。应用更新后可能需要重新核验或安装；移动源码目录后须调整 LaunchAgent 路径。部分 Node 22 版本会显示非致命的 `node:sqlite` 实验性功能警告。
- 各平台的历史验证不代表当前任意环境均可用；短草稿测速不代表复杂任务质量或长期可用性。

## 开发与验证

项目没有运行时 npm 依赖，开发测试使用 Playwright。执行 `npm ci` 后，按 [贡献指南](CONTRIBUTING.md) 准备测试浏览器。

```sh
npm run verify:prompts
npm run build
npm test
python3 -m unittest discover -s tests -p 't3_install_test.py' -v
```

2026-11-17 本机验证通过 240 项 JavaScript 测试、2 项安装器测试、构建和提示词校验；T3 真实增强、回填与恢复原文已复验。DSH 宿主装载检查另需已挂载的 profile，跨平台测试通过不等于 DSH 安装成功。

[更新记录](CHANGELOG.md) · [贡献指南](CONTRIBUTING.md) · [模型选择](docs/model-selection.md) · [T3 适配](docs/t3-composer.md) · [DSH 传输排查](docs/enhance-transport-failure-diagnosis.md) · [Profile 加载排查](docs/profile-not-loading-diagnosis.md)

[MIT License](LICENSE)
