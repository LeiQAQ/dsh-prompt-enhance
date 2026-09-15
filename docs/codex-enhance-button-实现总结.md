# Codex Desktop 提示词增强按钮技术实现总结

> 文档状态：已实现（实验性运行时适配）
> 适用范围：Windows Codex Desktop；Codex 升级后必须重新执行兼容性验证。

## 1. 项目背景

本项目原先是面向 DeepSeek Harness/DSH/Cordis 的提示词增强插件，依赖 DSH 的插件生命周期、Composer slot、命令注册和宿主通信接口。

Codex Desktop 的输入框属于桌面应用内置 Renderer，当前没有可直接复用的公开 Composer 挂载 API。因此项目增加了独立的 Codex Desktop 运行时适配器：用户明确以调试端口启动 Codex 后，适配器通过 Chromium DevTools Protocol（CDP）向实际 Renderer 注入按钮和交互逻辑。

适用场景：

- 在个人 Windows Codex Desktop 输入框中增强当前提示词。
- 使用 DeepSeek 或其他 OpenAI-compatible 服务作为增强模型。
- 在不修改 Codex 安装文件的前提下进行受控的本机集成。

本方案不等同于 Codex 官方原生插件能力。

目标流程：

~~~text
点击 ✦
  → 读取当前输入框内容
  → 通过 CDP Binding 发送给 Node 适配器
  → 调用 DeepSeek 或本地兼容服务
  → 通过 CDP 回传结果
  → 回填 Codex ProseMirror 输入框
~~~

## 2. Codex 适配原理

### 2.1 为什么需要适配

原 DSH 方案依赖以下宿主能力：

- DSH/Cordis 的插件加载和 Composer slot。
- DSH 的命令或 RPC 注册机制。
- DSH 的会话、模型和远程服务对象。
- 宿主提供的输入框状态与回填接口。

这些接口不能直接假设存在于 Codex Desktop 中。复制 DSH 插件目录不会使 Codex 自动识别其 manifest、Cordis patch 或内部命令，也不会自动生成输入框按钮。

### 2.2 整体架构

~~~text
Codex Desktop Renderer
  .ProseMirror Composer
  #dsh-prompt-enhance-button
          │ CDP Runtime.addBinding / Runtime.evaluate
          ▼
scripts/codex-desktop-adapter.mjs
  页面发现、按钮注入、请求管理、取消管理
          │ provider contract
          ▼
src/core/enhance.js
  输入校验、超时、取消、输出校验、错误分类
          │
          ▼
src/providers/openai-compatible.js
  DeepSeek / 本地 OpenAI-compatible 服务
~~~

适配器同时提供 localhost helper HTTP 服务作为兼容路径，但 Codex Renderer 的主请求路径使用 CDP Binding，避免页面 CSP 阻断 Renderer 直接请求 localhost。

### 2.3 使用 CDP 的原因

- 连接用户明确开启调试端口的 Codex Renderer。
- 读取和修改实际 Composer DOM。
- 使用 Runtime.addBinding 将 Renderer 请求交给 Node 进程处理。
- 使 API Key 保留在 Node 进程环境变量中，不进入页面 DOM 或前端源码。
- 不修改 Codex 安装目录、WindowsApps 文件或 app.asar。
- 绕过 Codex 页面 connect-src CSP 对 Renderer 直连 localhost 的限制。

## 3. 关键适配点

### 3.1 页面和输入框发现

适配器通过 CDP 查询 page 类型目标，并优先选择包含有效 Composer 的页面：

- 目标必须具有 webSocketDebuggerUrl。
- 页面必须包含可见、可编辑的 .ProseMirror 节点。
- 输入框必须满足 isContentEditable。
- 输入框高度必须大于 0。
- 带有 initialRoute 或 detached-window 特征的覆盖页降级处理。
- 找不到有效 Composer 时退出，不执行不确定的 DOM 写入。

### 3.2 按钮挂载位置

按钮稳定 ID：

~~~text
dsh-prompt-enhance-button
~~~

主挂载锚点：

~~~css
[data-composer-navigation-target="reasoning"]
~~~

备用挂载锚点：

~~~css
[data-composer-navigation-target="permissions"]
~~~

适配器沿 display: contents、单子元素和固定宽度包装层向上寻找真实 flex 工具栏，将按钮插入模型/推理选择器之前。

最终位置：

~~~text
Codex 输入框底部工具栏
→ GPT-5.6 Luna / 模型选择器左侧
~~~

按钮固定为约 30×28 像素的 ghost button，图标为 ✦。每次渲染都会检查并恢复图标，避免 Codex 重绘后出现空白按钮。

### 3.3 事件绑定和重绘自愈

Codex 可能在 Composer 重绘时整体替换按钮节点，因此采用：

- document 级事件委托。
- 通过 closest 判断目标按钮。
- 使用当前事件目标执行增强。
- MutationObserver 监听 Composer DOM 变化。
- 使用微任务合并连续重绘，避免观察器无限循环。
- 使用 dshPromptEnhanceGeneration 代际标识防止重复注入。
- 新一代注入发现旧按钮时克隆替换，清理历史节点监听器。
- 所有文本、状态和位置写操作均使用 guard。
- 重注入时取消旧请求并断开旧观察器。

### 3.4 CDP Binding 接口

页面侧 Binding：

~~~text
__dshPromptEnhanceSend
~~~

适配器启用：

~~~text
Runtime.enable
Runtime.addBinding({ name: "__dshPromptEnhanceSend" })
~~~

普通请求：

~~~json
{
  "reqId": "timestamp-random",
  "text": "用户当前输入内容"
}
~~~

取消请求：

~~~json
{
  "reqId": "timestamp-random",
  "cancel": true
}
~~~

适配器监听 Runtime.bindingCalled，并按 reqId 管理请求。结果通过页面回调返回：

~~~text
window.__dshPromptEnhanceReceive(reqId, resultJson)
~~~

成功结果：

~~~json
{
  "ok": true,
  "text": "增强后的提示词"
}
~~~

失败结果：

~~~json
{
  "ok": false,
  "error": "增强失败原因"
}
~~~

### 3.5 输入读取和回填

输入读取优先使用编辑器的 innerText，必要时回退到 textContent。

回填流程：

1. 聚焦当前 ProseMirror 节点。
2. 选中原有内容。
3. 优先使用 document.execCommand('insertText')。
4. 宿主不接受时，使用文本节点和 br 进行 fallback 回填。
5. 派发 InputEvent，使 Codex 感知输入变化。

回填前重新检查：

- 输入框节点未改变。
- 原文未改变。
- 输入版本号未改变。
- 会话身份未改变。
- 请求未被取消。

任一条件不满足，结果都会被丢弃，不覆盖用户新输入。

### 3.6 状态机

~~~text
ready ──点击──> busy
busy ──成功──> ready
busy ──再次点击──> ready
busy ──超时/API失败──> error
error ──下一次点击──> busy
~~~

| 状态 | 表现 | 行为 |
|---|---|---|
| ready | 显示 ✦ | 可开始增强 |
| busy | 显示 … | 保持可点击，第二次点击取消 |
| error | 显示 ✦，通过 title 提示错误 | 原文不变，可重试 |

空输入在本地拦截，不发送模型请求。

### 3.7 Provider 接口

src/providers/openai-compatible.js 对 DeepSeek 和本地兼容服务统一使用：

~~~http
POST {PROMPT_ENHANCE_ENDPOINT}
Authorization: Bearer {PROMPT_ENHANCE_API_KEY}
Content-Type: application/json
~~~

请求体：

~~~json
{
  "model": "deepseek-chat",
  "messages": [
    { "role": "system", "content": "提示词增强系统提示词" },
    { "role": "user", "content": "原始提示词" }
  ],
  "stream": false
}
~~~

响应读取字段：

~~~text
choices[0].message.content
~~~

Provider 将网络错误、HTTP 错误、JSON 错误和响应结构错误转换为稳定错误类型，由 src/core/enhance.js 统一处理。

### 3.8 配置项

| 环境变量 | 必填 | 默认值 | 说明 |
|---|---:|---|---|
| PROMPT_ENHANCE_ENDPOINT | 是 | 无 | DeepSeek 或本地 chat/completions 地址 |
| PROMPT_ENHANCE_MODEL | 是 | 无 | 服务接受的模型名称 |
| PROMPT_ENHANCE_API_KEY | 使用 DeepSeek 时是 | 无 | Bearer API Key，不得写入仓库 |
| PROMPT_ENHANCE_CDP_URL | 否 | http://127.0.0.1:9222 | Codex CDP 地址 |
| PROMPT_ENHANCE_PORT | 否 | 18765 | 本地 helper 端口 |
| PROMPT_ENHANCE_TIMEOUT_MS | 否 | 120000 | Provider 调用超时时间 |

scripts/start-codex-adapter.ps1 会从当前用户环境变量重新读取配置。仓库只提供 .env.example，不保存真实 Key。

### 3.9 Codex 启动前提

当前已验证版本需要在完全退出旧实例后，使用调试端口启动 Codex；同时需要设置 BUILD_FLAVOR=dev，以避免生产构建关闭 CDP 响应能力：

~~~powershell
$env:BUILD_FLAVOR = 'dev'
$codex = (Get-AppxPackage -Name OpenAI.Codex).InstallLocation + '\app\ChatGPT.exe'
Start-Process -FilePath $codex -ArgumentList '--remote-debugging-port=9222','--remote-allow-origins=*'
~~~

然后启动适配器：

~~~powershell
cd "D:\AI\Codex\AI Tool\火柴人\新建文件夹\独立项目归档\dsh-prompt-enhance"
npm run adapter:codex:win
~~~

## 4. 与原有方案的差异对比

| 对比项 | 原 DSH/Cordis 方案 | Codex Desktop 适配方案 |
|---|---|---|
| 宿主 | DSH/Harness/Cordis | Codex Desktop Renderer |
| 插件加载 | DSH profile/bundle | 外部 Node 适配器通过 CDP 注入 |
| UI 挂载 | 宿主 Composer slot | .ProseMirror 和 Codex DOM 锚点 |
| 点击事件 | 宿主组件事件 | document 级事件委托 |
| 宿主通信 | DSH command/RPC | CDP Binding 与 Runtime.bindingCalled |
| 模型调用 | DSH 内部 LLM 服务 | OpenAI-compatible HTTP Provider |
| API Key | DSH/Harness 配置 | Node 进程环境变量 |
| 输入状态 | DSH 组件状态机 | 页面 revision、编辑器身份和 request ID |
| 结果回填 | DSH Composer API | ProseMirror DOM 编辑与 InputEvent |
| CSP | 由 DSH 宿主负责 | 优先使用 CDP Binding |
| 安装方式 | DSH 插件目录/profile | 启动 Codex CDP 后运行适配器 |
| 官方支持性 | 使用原宿主扩展机制 | 非官方运行时适配 |
| 重启行为 | 随宿主加载 | 需重新启动适配器 |

两种方案共用提示词资源、Provider 合约、核心增强逻辑和错误分类，但不共用 UI 层和宿主通信层。

## 5. 已知限制与注意事项

### 5.1 兼容性

- 依赖 Codex 当前 DOM 结构、.ProseMirror 类名和 data-composer-navigation-target 属性。
- Codex 更新后可能改变输入框、工具栏或 Renderer 行为。
- 当前仅验证 Windows Codex Desktop；macOS、Linux 和 Web 版未验证。
- BUILD_FLAVOR=dev 是当前版本的运行时前提，不是稳定公开 API。
- Codex 单实例机制可能导致新调试参数不生效，启动前必须完全退出旧实例。
- Codex 重启后按钮不会持久化，需重新启动适配器。

### 5.2 安全

- CDP 端口应只绑定本机，不应暴露到局域网或公网。
- --remote-allow-origins=* 只应在受控本机环境使用。
- API Key 只能放在 Windows 用户环境变量或本地安全存储中。
- 不得提交 .env、真实配置文件、终端日志或包含 Key 的截图。
- 页面侧 Binding 只传输提示词和请求 ID，Provider 凭据不注入页面。
- 提示词会发送给配置的 DeepSeek/本地模型服务，敏感内容使用前需人工判断。

### 5.3 功能边界

- 适配器停止后按钮不能完成增强请求。
- 当前只处理当前编辑器文本，不提供历史记录、批量增强或多版本管理。
- 真实 DeepSeek 调用可能产生费用；诊断阶段应优先使用空输入、mock provider 或本地服务。
- Windows 启动脚本要求 DeepSeek API Key 存在；无 Key 的本地服务可直接运行 Node 适配器。

### 5.4 明确不做

- 不修改 Codex 安装目录、app.asar 或 WindowsApps 内容。
- 不通过复制 DSH 插件目录来假设 Codex 会加载该功能。
- 不把 API Key 硬编码到源码、前端注入脚本或 Git 历史。
- 不在未确认目标页面的情况下对任意 ProseMirror 节点写入。

## 6. 后续优化方向

1. Codex 提供公开 Composer/Plugin UI API 后，迁移到官方接口。
2. 为不同 Codex 版本维护 DOM 探测器和兼容性矩阵。
3. 增加适配器自动重连、退出清理和一键启动流程。
4. 将 API Key 迁移到 Windows Credential Manager 等安全存储。
5. 增加本地设置界面，支持 Provider、模型和超时配置。
6. 增加不记录原文的结构化诊断日志。
7. 增加真实 Codex CDP 回归、截图比对和 CSP 测试。
8. 在不改变主流程的前提下增加预览、撤销、快捷键和多语言提示。

## 7. 验证与交付结论

| 验证项 | 结果 |
|---|---|
| JavaScript 语法检查 | 通过 |
| 项目构建 | 通过 |
| 自动化测试 | 224/224 通过 |
| 提示词资源校验 | 通过 |
| Plugin manifest 校验 | 通过 |
| Git 空白字符检查 | 通过 |
| 仓库密钥扫描 | 未发现 sk- 格式密钥 |
| Codex UI 注入 | ok: true、button: true、editor: true |
| 按钮位置 | 已验证位于模型选择器左侧 |
| 交互流程 | 空输入、增强、取消、输入变化保护和失败提示已覆盖 |

主要交付物：

~~~text
scripts/codex-desktop-adapter.mjs
scripts/start-codex-adapter.ps1
src/core/enhance.js
src/providers/openai-compatible.js
plugins/codex-prompt-enhance/
.env.example
~~~

结论：本项目已将原有提示词增强能力拆分为平台无关核心、OpenAI-compatible Provider 和 Codex Desktop 外部运行时适配器，能够按照“读取输入 → 调用 DeepSeek/本地服务 → 回填结果”的流程工作。UI 适配依赖 Codex 当前版本的 CDP 能力和 DOM 结构，不应表述为官方 Codex 原生插件能力。
