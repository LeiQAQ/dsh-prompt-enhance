# DSH 原生插件安装

[English](dsh-installation.md) · [返回项目介绍](../README.zh-CN.md)

本指南只适用于 DeepSeek Harness / DSH。历史验证为 DSH Desktop 2.0.5、`@deepseek-ai/*` 0.1.2-rc.1；其他版本需按实际 profile 验证。

## 构建与挂载

```sh
git clone https://github.com/LeiQAQ/dsh-prompt-enhance.git
cd dsh-prompt-enhance
npm run build
```

构建只用 Node 内置模块。开发测试还需 `npm ci`，详见 [贡献指南](../CONTRIBUTING.md)。

分别编辑 `~/.dsh/profiles/web/package.json`、`~/.dsh/profiles/desktop/package.json`：在 dependencies 合并 `"dsh-prompt-enhance": "link:/absolute/path/to/dsh-prompt-enhance"`，在 `dsh.profile.bundles` 追加 `"dsh-prompt-enhance"`。保留其他依赖与插件。

确保每个 profile 的 node_modules 能解析该包。Linux/macOS 在链接尚不存在时执行：

```sh
ln -s /absolute/path/to/dsh-prompt-enhance ~/.dsh/profiles/web/node_modules/dsh-prompt-enhance
ln -s /absolute/path/to/dsh-prompt-enhance ~/.dsh/profiles/desktop/node_modules/dsh-prompt-enhance
```

替换示例路径。Windows 可使用 PowerShell `New-Item -ItemType Junction -Path <profile链接路径> -Target <仓库路径>`。先检查目标，不覆盖已有插件副本或链接。

## 验证与启动

```sh
node scripts/verify-install.mjs --profile "$HOME/.dsh/profiles/web"
node scripts/verify-install.mjs --profile "$HOME/.dsh/profiles/desktop"
node scripts/verify-profile-roster.mjs --profile "$HOME/.dsh/profiles/web"
node scripts/verify-profile-roster.mjs --profile "$HOME/.dsh/profiles/desktop"
npm run check:restart
```

以上为 POSIX shell 示例；Windows 请传入实际绝对路径。roster 检查需要可用的 DSH CLI，可用 `DSH_BIN` 指定。

退出并重新启动 DSH Desktop，输入框会出现 ✦。DSH 有单实例锁，再次打开正在运行的应用不是真重启；只挂 web、应用却启动 desktop profile，也不会显示按钮。

## 使用与配置

- ✦ 改写草稿，增强中再点一次取消，成功后可恢复原文。
- `/enhance-prompt <文字>` 是同一能力的命令入口。
- 模型跟随当前会话路由，再回落部署默认；缺少模型时报 `no_model`。这里不读取 T3 配置。
- 仓库 `cordis.patch.yml` 设置默认超时 120 秒；草稿上限 20,000 字符。
- 每次增强会留下命令节点。`recordInput: false` 隐藏草稿参数，不隐藏节点。`b64:` 是编码，不是加密。

## 卸载与排查

从两个 profile 的 `dsh.profile.bundles` 移除条目并真重启，再按需移除本包的依赖声明和链接，保留其他插件。

[Profile 未加载排查](profile-not-loading-diagnosis.md) · [命令传输失败排查](enhance-transport-failure-diagnosis.md)

2026-11-16 的 T3 更新未重新验收 DSH：当时本机 web profile 未挂载插件，装载检查未通过环境前提。不要把 T3 验证记录当作当前机器 DSH 已安装成功。
