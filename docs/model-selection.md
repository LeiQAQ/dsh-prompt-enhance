# 模型选择与延迟测试

本页说明适合妙笔的模型、当前接入能力和 2026-11-16 的本机测试。推荐基于具体使用场景与有限实测，不是通用模型排行榜或正式质量评估。

## 按场景选择

| 场景 | 推荐起点 | 说明 |
|---|---|---|
| 日常提示词润色、短草稿整理，希望尽快得到结果 | **DeepSeek Flash · 关闭思考** | T3 已实现官方 API 直连 |
| 已有 Codex 登录，希望延续现有账户 | GPT-6 Luna · low | T3 CLI 路线已测，需账号实际拥有模型权限 |
| 草稿复杂，希望自行评估约束保留和表达质量 | GPT-6.1 Sol · low | T3 安装器初始默认；本轮未做复杂草稿质量评估 |
| 已有 Terra 工作流 | GPT-6.1 Terra · low | 可选评估，未显示稳定速度优势 |
| 想比较 Flash 多一点思考的收益 | Flash · low 思考 | 仅作候选；已测速，当前 T3 路线未开放此配置 |

DSH 跟随宿主路由；T3 的增强模型与聊天模型独立。Codex Desktop 使用配置的 API，其现有启动入口未暴露思考开关。一个适配器的设置不能直接当作所有平台的配置。

## 显式关闭 DeepSeek 思考

官方当前建议使用模型名 `deepseek-flash`，核对文档时由 DeepSeek-V4.1-Flash-1017 提供服务。别名可能更新，以 [官方 API 文档](https://api-docs.deepseek.com/quick_start) 为准。

[思考模式文档](https://api-docs.deepseek.com/guides/thinking_mode/) 说明默认开启思考、强度 high。因此只替换模型名称并不能保证采用本页的快速配置。OpenAI-compatible 请求需明确包含：

```json
{
  "model": "deepseek-flash",
  "thinking": { "type": "disabled" },
  "stream": false
}
```

这只是关键字段示例，真实请求还需 `messages` 和后台授权。T3 已固定发送并测试这个开关；[配置步骤](t3-composer.md#deepseek-flash) 使用已有 CC Switch 凭据。

其他平台的集成开发者可以使用已有 provider 工厂，在后台设置 `createDeepSeekProvider({ endpoint, model: 'deepseek-flash', thinking: 'disabled', apiKey })`。凭据由后台安全来源提供；工厂配置不会自动修改 DSH 路由或 Codex Desktop 启动器。

## 本机短草稿实测

测试草稿：

> 帮我写一个咖啡店介绍，用中文，100字以内，语气亲切，不要编造店名和地址。

每种配置测试 3 次，计时至完整响应返回，不是首 token 延迟。使用妙笔提示词资产和同一改写任务；Codex CLI 另有自身运行时指令。结果均完成改写，未系统评估复杂输入质量。

| 配置与调用路径 | 第 1 次 | 第 2 次 | 第 3 次 | 平均 |
|---|---:|---:|---:|---:|
| **DeepSeek Flash · 关闭思考 · 官方 API** | 1.04 s | 0.72 s | 1.08 s | **0.95 s** |
| DeepSeek Flash · low 思考 · 官方 API | 2.16 s | 1.70 s | 2.00 s | 1.95 s |
| GPT-6 Luna · low · Codex CLI | 14.65 s | 13.16 s | 12.36 s | 13.39 s |
| GPT-6.1 Sol · low · Codex CLI | 11.08 s | 17.47 s | 13.70 s | 14.08 s |
| GPT-6.1 Terra · low · Codex CLI | 13.20 s | 20.78 s | 12.51 s | 15.50 s |

测试限制：

- DeepSeek 直连官方 API；Codex 包含每次临时 CLI 启动和完整输出。比较的是**完整集成路径的等待时间**，不能推导纯模型速度倍数。
- DeepSeek 两种模式每轮并行，后两轮均命中 512 个输入缓存 token；Codex 前两轮各模型并行，第三轮顺序执行。
- 输出长度不同，未固定输出 token 数；网络、账号、缓存、并发和服务负载都会影响结果。
- 每种配置只有 3 次、只有一条短草稿，不证明长期可用性、复杂任务质量或价格优势。Luna 与 Sol 的均值差小于本轮波动，不宜过度解读。
- T3 完整 `/enhance` 链路随后也完成真实请求验证，观测约 1.1 秒；客户端渲染还会有少量开销。

因此当前优先推荐 **Flash 关闭思考**缩短实际等待，而不是声称它在任何任务上都更快或质量更高。

## 其他候选

[GPT-6 Luna](https://developers.openai.com/api/docs/models/gpt-6-luna) 与 [GPT-6.1 Sol](https://developers.openai.com/api/docs/models/gpt-6.1-sol) 的权限和参数以官方文档、实际账户为准。T3 CLI 路线固定 low 推理强度，没有把全部官方参数都做成配置项。

本轮未测 DeepSeek Pro、Astra 或其他厂商模型。新增候选时，应使用真实草稿集评估目标保留、事实添加、长度、失败率和耗时；需要新参数或凭据来源时，应实现适配并测试，而非仅修改介绍便声称支持。
