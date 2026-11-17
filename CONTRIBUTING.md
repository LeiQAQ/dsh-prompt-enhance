# 贡献指南

妙笔由平台无关增强逻辑、DSH 原生插件和桌面适配器组成。修改时保留平台边界：T3 的安装或模型配置不会自动改变 DSH/Codex 行为。

## 环境与测试浏览器

- Node.js 22+，T3 凭据适配与相关测试需内置 `node:sqlite`。
- Python 3，用于 macOS T3 安装器测试；实际安装还需要 macOS codesign。
- 没有运行时 npm 依赖；开发依赖通过锁文件安装：

```sh
npm ci
npx playwright install chromium
```

浏览器测试优先使用 `MIAOBI_TEST_CHROMIUM` 指定的可执行文件；macOS 已安装标准路径 Chrome 时可直接使用，否则使用 Playwright Chromium。Linux 缺少系统库时可按 Playwright 提示安装浏览器运行依赖。

## 常规检查

```sh
npm run verify:prompts
npm run build
npm test
python3 -m unittest discover -s tests -p 't3_install_test.py' -v
git diff --check
```

测试不调用付费模型 API，但 T3 输入框用例会启动本机无头浏览器。新增模型参数必须验证实际请求体；涉及取消、错误或竞争条件时，应测试原文保留和旧结果丢弃。

## DSH 宿主检查

DSH 安装验收还必须在已挂载的真实 profile 中运行：

```sh
node scripts/verify-install.mjs --profile "$HOME/.dsh/profiles/web"
node scripts/verify-profile-roster.mjs --profile "$HOME/.dsh/profiles/web"
node scripts/verify-install.mjs --profile "$HOME/.dsh/profiles/desktop"
node scripts/verify-profile-roster.mjs --profile "$HOME/.dsh/profiles/desktop"
npm run check:restart
```

`npm run verify` 保留原有完整 DSH 检查流程，默认使用 web profile；它不适用于一台没有挂载 DSH 插件、仅使用 T3 的机器。未具备宿主前提时应报告未验证或环境检查失败，不要修改无关 profile 来伪造通过。

修改 DSH 客户端导入、inject 声明、槽位或命令名时，必须验证真实前端导出表、roster 与槽位冲突；mock 测试不能替代装载验收。修改 dist 后通常需要完全退出并重启 DSH，而非再次点击已有应用图标。

## 设计约定

- 失败路径不写草稿；增强中再次点击可取消；编辑或会话变化后丢弃旧结果。
- 不从模型输出渲染未经处理的 HTML，T3 回填使用编辑器文档 API。
- 不把 API Key 放到源码、测试快照、日志、前端或提交内容中。测试使用明显的虚构凭据。
- DSH host 能力经 ctx 获取，不运行时导入 DSH 包。
- `src/host/prompts.js` 是带哈希锚点的资产。不要为了文案或模型建议改写它；任何资产变更需要独立论证与校验。
- 模型建议应区分已实现、单独测试和计划适配；测速必须注明调用路径、样本量、缓存、参数和输出差异。

## 提交与问题报告

提交前检查新增文件与生成的 dist，确保 README、平台指南、CHANGELOG 和 package 信息一致。GitHub 描述应反映已实现的能力，不把某台机器的配置写成所有安装的默认值。

报告问题时附：宿主与版本、适配器入口、非敏感的 provider/model/thinking 状态、复现步骤和相关检查结果。请勿直接上传完整 config、凭据数据库、用户草稿或未脱敏日志。

2026-11-16 的公开验证范围见 [更新记录](CHANGELOG.md)。
