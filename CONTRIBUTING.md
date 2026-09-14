# 贡献指南

感谢关注妙笔（`dsh-prompt-enhance`）。这是个小的双半插件，但它的坑几乎都藏在「接线」而不是「逻辑」——所以贡献流程里对校验的要求多于对风格的要求。

## 开发环境

- Node 22+（本项目零运行时 npm 依赖，装完克隆即可构建）
- 本机已装 DSH Desktop，`~/.dsh/profiles/` 下有 `web` / `desktop` 两个 profile（跑 `verify:install` / `verify:roster` 需要）

```bash
npm run build     # 构建 dist/
npm test          # 214 个离线单测（不需要浏览器和模型）
npm run verify    # prompts 哈希 → 构建 → 全部单测 → 装载检查（提交前必须全绿）
```

## 提交前检查单

1. `npm run verify` 全绿。
2. 改了 `src/client` 且依赖了 `@deepseek-ai/dsh-client-ui-primitives` 的导出？—— `verify:install` 会对着真实前端导出表核名，过了才叫过。
3. 改了可判定逻辑？—— 落成纯函数 + 离线用例（本项目惯例：状态机、编解码、分类器全是纯函数）。
4. 改了客户端 `inject` 声明？—— 记住 cordis 严格注入要求**父属性与子路径同时声明**（`remote` + `remote.commands`）；测试的 mock ctx 带强制注入检查，漏声明会在 `client-seat` 直接报 cordis 原话。
5. 改了 `SEAT_ORDER` / 命令名？—— 同步更新对应测试常量。
6. 需要真重启才能验证的改动（`dist/client.cjs`、profile 装配）？—— 用 `npm run check:restart` 判断，Electron 单实例锁下「再点一次图标」不算重启。

## Bug 报告

Issue 请附：

- `npm run verify` 的完整输出
- `npm run check:restart` 的结论（90% 的「插件坏了」是没真重启）
- 现象截图；若输入框旁出现红色错误，**把错误句旁的诊断码 chip 内容一起发**（那是给你看的机器码）
- dsh 版本（DSH Desktop 关于页 / `@deepseek-ai/*` 版本）

## 设计约定

- host 半不 value-import 任何 `@deepseek-ai/*` 运行时包（只 `import type`），服务一律从 `ctx` 取——这是为了在宿主版本差异下不炸构建。
- 失败契约的第一要务是「原文没动」：任何新失败路径都必须保证草稿零写入，并给用户一句可读原因 + 一个机器诊断码。
- prompt 资产（`src/host/prompts.js`）是**照抄资产，不创作**；改动必须先过 `verify:prompts` 的哈希锚点论证，否则视为劣化。
