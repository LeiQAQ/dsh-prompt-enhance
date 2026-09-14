# 点击 ✦ 报「和后台通信失败」—— 诊断记录（已结案）

日期：2026-09-14（当晚定位并修复，端到端验证通过）
根因：**插件客户端 `inject` 漏声明了 `remote` 这个父属性**。cordis 严格注入下，点击时
访问 `ctx.remote.commands` 会先解析父属性 `remote`，它不在 inject 里 → 当场抛
`Error: cannot get property "remote" without inject` → 被 component 的 catch 归为
TRANSPORT → 显示「和后台通信失败。原文没动」。

上一份记录 `profile-not-loading-diagnosis.md` 解决的是「图标不显示」；本篇是图标出现之后
的运行期失败。两者独立。

---

## 1. 定案过程（真实实例取证，不是推断）

静态分析曾把全部嫌疑推向 host 侧（§3 的收窄是对的，但结论错了——失败根本不在 host）。
最终靠**隔离 web 实例 + 真实浏览器点击**拿到现场：

1. `dsh web --port 0 --no-open` 起隔离实例（web profile 对本插件是 `link:` 直连源码，
   新构建即时生效），playwright 驱动 Chromium 打开页面、点 `.dpe-button`。
2. 捕获的抛出原文即根因：`Error: cannot get property "remote" without inject`。
3. cordis 规则核实（`@deepseek-ai/cordis/lib/index.js` 的 `ReflectService.handler.get`）：
   属性不在 ctx 上且未声明 inject 就抛这句。官方 `dsh-client-ui-commands` 的 `commandUi`
   同时声明了 `'remote'` 和 `'remote.commands'`，所以它那条路能通——这正是用户手打
   `/enhance-prompt`（B 路径）成功、而 ✦ 点击失败的原因。

## 2. 证据链中的关键中间结论（仍然成立，勿丢）

- **23:00 会话日志（`session-87d81f4f`）里有 `command/run` + `command/done`**：用户手打
  的 `/enhance-prompt` 走官方路径成功穿透到 host（那次 `command/done` 是
  `[prompt-enhance:empty_input] the draft is empty`，命令本身执行了）。
  —— 这条早在修复前就证明 host 半边、命令注册、agent 查找、生命周期追加全部正常。
- `node scripts/probe-remote-contract.mjs`：客户端 4 参与官方 3 参在 wire 上逐字节相同。
- 组合树 dump、roster、junction 副本等排除项见上一版 §2/§3（本版从简，结论不变：
  这些都不是问题）。

## 3. 修复

**修复 1（本 bug 的根因）— `src/client/index.js`**

```diff
-export const inject = ['slots', 'remote.commands', 'locale']
+export const inject = ['slots', 'remote', 'remote.commands', 'locale']
```

配套把 `tests/client-seat.test.mjs` 的 mock ctx 升级为**强制注入检查**（对未声明的属性
访问抛出与 cordis 一致的报错）——之前 mock 太宽松，这个「只在点击时暴露」的漏项才溜过了
213 个测试。验证过守卫有效性：临时回退 inject 后，测试报出的正是生产环境那句原话。

**修复 2（修 1 之后端到端验证时暴露的第二层 bug）— `src/host/llm.js`**

修 1 后点击穿透到了 LLM 层，随即报 `llm_error: unsupported finish kind "undefined"`。
对照 `dsh-llm/lib/index.js` 的 `adapterFailureChunk`（:1744）与 `dsh-llm-deepseek`
适配器（:1224）：真实协议是 **`{ type: 'finish', reason: { kind, failure? } }`**，
`kind` 挂在 `chunk.reason` 上（dsh-llm 自己的 `BlockAssembler` 就是
`this._finish = chunk.reason`）；插件 `finishFailure` 却直接读 `finish.kind` →
`undefined`。已改为解包 `chunk.reason`（保留对平面形状的兼容），模块注释同步改写，
并在 `tests/host-llm.test.mjs` 增加真实嵌套形状的主用例。

**诊断改进（上一版 §4，全部保留）**：可见诊断 chip（`.dpe-diagnostic`）、
`console.error('[prompt-enhance] enhancement failed:', code, detail)`、
`failureDiagnostic` 纯函数。这些正是让修复 2 能被当场看见的原因——chip 直接显示了
`unsupported finish kind "undefined"`。

## 4. 端到端验证（真实浏览器，全部通过）

隔离 web 实例 + playwright 点击 `.dpe-button`：

- 修复 1 后：错误从 TRANSPORT 变为带标签的 `llm_error`，chip 显示
  `unsupported finish kind "undefined"`（证明调用已到 LLM 层）。
- 修复 2 后：点击 → `data-phase="idle"`、无任何错误、座位出现「恢复增强前的原文」按钮
  —— 增强**成功执行**，改写文本写回草稿。
- 测试：**214 项全部通过**（新增：failureDiagnostic 6 例、finishFailure 嵌套形状 1 例、
  mock ctx 注入守卫）；`verify-install` / `verify-profile-roster` / 探针脚本均 OK。

## 5. 经验

- 「TRANSPORT = 信封不是 ok」的排除法在方向上是对的，但漏了第四种来源：**客户端在发起
  RPC 之前自己抛错**（catch 兜底同样归为 TRANSPORT）。遇到「失败且无任何 host 痕迹」时，
  客户端发起前抛错应列进第一梯队嫌疑。
- cordis 严格注入要求 **inject 同时声明父属性与子路径**（`remote` + `remote.commands`）。
  写 dsh 插件时照抄官方插件的声明集合，别凭用到的叶子路径自行精简。
- 测试 mock 应复刻宿主的严格性（这里：注入检查）。宽松 mock 只能验证「逻辑对」，验不了
  「接线对」。
- 排查器（诊断 chip + console.error）要赶在定位之前落地：本次第二层 bug 就是靠 chip
  的可见输出一步锁定的。
