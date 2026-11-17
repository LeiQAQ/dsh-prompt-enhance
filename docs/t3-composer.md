# 妙笔 · T3 输入框适配

[项目介绍](../README.zh-CN.md) · [模型选择](model-selection.md)

在 T3 输入框底部模型选择器左侧增加 `✦`：点击增强，再次点击取消；成功后用 `↶` 恢复原文。后台模型与聊天模型独立，不会因为更换主对话模型而改变。

## 支持范围与安装方式

当前只验证 **macOS、ad-hoc 签名的 T3 Code (Beta) 0.1.9-zh.1**。这不是 T3 官方插件 API；安装器会修改应用 HTML 入口、更新 ASAR 完整性信息并重新进行本地 ad-hoc 签名。它保留原文件备份和文件偏移，不更改 Electron fuses、entitlements 或安全策略。

安装器只支持 `/Applications/T3 Code (Beta).app`，会拒绝非 ad-hoc 签名的应用。不要据此假设官方其他发行版或后续版本也兼容。

前提：Node.js 22+（包含 `node:sqlite`）、Python 3、macOS codesign、可在 PATH 找到的 Codex CLI。即使计划用 DeepSeek，当前安装器仍会检查 Codex CLI；只有使用 Codex 路线时需要其已登录状态。使用 DeepSeek 还需 CC Switch 中已有有效的官方 DeepSeek provider。

```sh
git clone https://github.com/LeiQAQ/dsh-prompt-enhance.git
cd dsh-prompt-enhance
python3 adapters/t3/install.py
```

安装器在 `~/.t3/miaobi/` 保存本机配置与备份，通过用户 LaunchAgent `com.leiyu.miaobi-t3` 启动只监听 `127.0.0.1:18766` 的服务。源码目录需长期保留；移动目录后须调整 LaunchAgent 中的路径。

安装器初始使用 **GPT-6.1 Sol · low**，不会自动查找或切换 DeepSeek 凭据。首次安装后，用 T3“视图 → 重新加载”激活按钮，再按下面的步骤配置 Flash。

<a id="deepseek-flash"></a>
## 配置 DeepSeek Flash：关闭思考

推荐模型：`deepseek-flash`。T3 后台直连官方 `https://api.deepseek.com/chat/completions`，明确发送 `thinking: { "type": "disabled" }`；当前实现不接受 low 思考配置，也不会在失败时静默切回 Codex。

1. 在 CC Switch 中确认已有 DeepSeek provider，API 地址为 `https://api.deepseek.com/anthropic`，且配置了有效凭据。
2. 查到该 provider 的 ID。以下命令只显示 ID 和名称，不输出 Key：

```sh
node --input-type=module - <<'JS'
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import { homedir } from 'node:os'
const db = new DatabaseSync(join(homedir(), '.cc-switch', 'cc-switch.db'), { readOnly: true })
console.log(db.prepare('SELECT id, name FROM providers WHERE app_type = ?').all('claude'))
db.close()
JS
```

3. 在 `~/.t3/miaobi/config.json` 中合并以下字段。**保留原来的 token、port 和 codexPath**；示例不是整个文件的替换内容。把 dbPath 改为本机真实绝对路径，providerId 改为上一步找到的 DeepSeek ID：

```json
{
  "provider": "deepseek",
  "model": "deepseek-flash",
  "thinking": "disabled",
  "credentialSource": {
    "type": "cc-switch",
    "dbPath": "/Users/YOUR_NAME/.cc-switch/cc-switch.db",
    "providerId": "YOUR_DEEPSEEK_PROVIDER_ID"
  }
}
```

4. 重启妙笔服务并确认生效：

```sh
launchctl kickstart -k gui/$(id -u)/com.leiyu.miaobi-t3
curl http://127.0.0.1:18766/health
```

健康状态应包含 `provider: "deepseek"`、`model: "deepseek-flash"`、`thinking: "disabled"`。此时原有按钮直接使用新后台，无需重启 T3。

Key 只由后台从 CC Switch 数据库只读取得，不复制到仓库、妙笔配置或前端。更新 CC Switch 凭据后应重启妙笔服务。不要分享包含本机请求 token 的完整 config 文件。

## 使用 Codex 登录路线

设置 config 中 `provider` 为 `codex`，`model` 为账号可用的 `gpt-6-luna` 或 `gpt-6.1-sol`，保留有效的 codexPath，然后重启服务。没有 provider 字段的旧配置继续走 Codex，以保持兼容。

当前 CLI 路线固定 low 推理强度，每次启动临时只读调用；不向 T3 主会话发送消息。它不是任意 CLI 参数的通用配置界面。

## 草稿保护与限制

- 空草稿禁用按钮，最多 20,000 字符；模型失败、请求取消或超时不改原文。
- 编辑期间旧请求取消；回填前还核对草稿版本、文档与会话身份。
- 恢复原文只对当前未继续编辑的增强结果可用；没有跨会话改写历史。
- 含文件、技能或模型引用标记的富文本主动拒绝改写，避免破坏引用；普通外部附件不进入增强请求。
- 增强内容发送给配置的模型服务，会消耗对应余额或配额。后台不保存草稿与输出正文日志。

## 诊断、更新与卸载

```sh
curl http://127.0.0.1:18766/health
launchctl list com.leiyu.miaobi-t3
```

日志位置：`~/.t3/miaobi/service.log` 和 `service-error.log`。健康检查表示本机服务状态，不代替真实模型请求验证，也不证明历史请求从未失败。部分 Node 22 版本会显示非致命的 SQLite 实验性 API 警告。

T3 更新可能覆盖入口；更新后应重新核验。检测到应用已变化时，卸载器拒绝覆盖新版文件。恢复原版后的重新安装仍会创建默认 Codex 配置，需要按需重新合并 DeepSeek 设置。

```sh
python3 adapters/t3/install.py --uninstall
```

卸载停止 LaunchAgent，恢复原 ASAR、Info.plist、可执行文件签名与资源封印，再重新加载 T3。备份保留在 `~/.t3/miaobi/backups/`。无需为切换模型重新安装整个适配器。

## 验证记录

2026-11-16 已在上述版本中验证真实增强、原地回填、恢复与取消，测试草稿已清空；DeepSeek 非思考路线实际请求成功。235 项 JavaScript 测试、2 项 Python 安装器测试通过，应用签名和 ASAR 两层完整性校验通过。测速条件见 [模型选择](model-selection.md)。
