# 更新记录 / Changelog

## 2026-11-16 · T3 输入框与 DeepSeek Flash

### 新增

- `adapters/t3/`：macOS T3 本地适配、后台服务和可卸载安装器；验证于 ad-hoc 签名的 T3 Code `0.1.9-zh.1`。
- 输入框 `✦` 增强、再次点击取消、`↶` 恢复原文；通过 Tiptap API 同步草稿，编辑或切换会话后丢弃旧结果。
- 独立增强模型：DeepSeek 官方 API 与 Codex CLI。推荐 `deepseek-flash` 显式关闭思考；T3 后台只读引用 CC Switch 已有凭据，API Key 不进入前端或仓库。
- 回环地址服务、Origin/令牌授权、请求大小检查、断开取消、通用失败提示与不含凭据的健康状态。
- T3 后台、输入框与安装器测试；浏览器测试支持本机 Chrome、Playwright Chromium 或指定可执行文件。

### 修复与说明

- 防止重复挂载后，已销毁实例的待执行渲染重新生成旧按钮。
- 请求体按完整 UTF-8 字节解码，避免中文跨数据块损坏。
- OpenAI-compatible provider 新增可选 `thinking` 字段；未指定时保持原有请求格式。T3 DeepSeek 路线要求 `disabled`。
- 重写中英文 README，明确各平台能力、安装方式、模型来源与适用场景。
- 增加模型选择和逐次测速记录，区分推荐配置、安装器默认值、已测试候选与尚未开放的配置。
- 保留 DSH/Codex 既有入口和排查文档。“零内核改动”只适用于 DSH；T3 会修改应用入口并进行本地签名。

### 验证边界

235 项 JavaScript 测试、2 项 Python 安装器测试在本机通过。T3 真实增强、回填、恢复、取消、DeepSeek 请求、应用签名与 ASAR 完整性已验证。

DSH Desktop 2.0.5 与 Codex Desktop Windows 属于既有验证记录。本轮本机 DSH web profile 未挂载插件，装载检查未通过环境前提，未将它报告为新的 DSH 验收成功。

## 既有能力 · Codex Desktop 适配

增加平台无关增强服务、OpenAI-compatible provider、实验性 Codex Desktop CDP 按钮和 Codex 技能入口。对应提交：[`1cf92dd`](https://github.com/LeiQAQ/dsh-prompt-enhance/commit/1cf92dd0bf2ffe0c68a1d64a7bb3d7dff74823dd)。历史验证边界见 [Codex 适配说明](docs/codex-enhance-button-实现总结.md)。
