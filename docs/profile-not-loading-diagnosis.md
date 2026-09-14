# 提示词增强器图标不显示 —— 诊断与修复记录

日期：2026-09-14
结论：**插件本身没有缺陷；DSH Desktop 启动的 profile 与插件安装的 profile 不是同一个。**

---

## 1. 根因

DSH Desktop 每次启动只组装 **active profile** 的 `dsh.profile.bundles`。本次启动（20:27:06）
的 active profile 是 **`desktop`**，而它是空的：

| `~/.dsh/profiles/desktop` | 内容 |
|---|---|
| `dependencies` | `{}` |
| `dsh.profile.bundles` | `["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app"]` |
| `node_modules` | 空 |
| `pnpm-lock.yaml` | 115 字节（只有 `.: {}`） |

插件装在**另一个 profile `web`**（23 个插件的家）。因此 `dsh-prompt-enhance` 从未被组装进
boot manifest，浏览器 roster 里没有它 → 界面上没有 ✦ 图标，且**不产生任何报错**。

### 证据链（5 条相互独立）

| # | 证据 | 读到的内容 |
|---|---|---|
| 1 | `%APPDATA%\DSH Desktop\profile-selection\state.json` | `{"version":2,"active":"desktop"}`，mtime `20:27:06.209` |
| 2 | `~/.dsh/profiles/desktop/cordis.yml` | mtime `20:27:06.570` —— `prepareProfile` 每次启动重写；`web` 的停在 `19:12:54`（那次没启动） |
| 3 | `%APPDATA%\DSH Desktop\health-snapshots\<hash>\slot-*\manifest.json` | `"profileName":"desktop"`, `"provider":"desktop-profile"`；slot-1 的 `capturedAt` 就是 2.0.5 首次安装当天 → **从首次安装起就在 desktop** |
| 4 | `%APPDATA%\DSH Desktop\host-commands\desktop\bin\dsh.cmd` | 20:27 生成，内含 `set "DSH_DESKTOP_DEFAULT_PROFILE=desktop"` |
| 5 | `%APPDATA%\DSH Desktop\lifecycle-events\startup.jsonl` | `profile-selection` → `profile-composition` 耗时 360ms，与 #2 的 mtime 吻合 |

补充指纹：`Local Storage\leveldb\` 仅 87 字节、创建于 Sep 10 → 渲染层从未加载过任何插件；
而 `~/.dsh/settings.yaml` 里 `pet` / `skin-custom-theme` / `dsh-session-archive` 配置齐全
—— **「设置还在、插件全没」正是 profile 不对的特征**（profile 目录互相隔离，
但 `~/.dsh` 下的 settings / sessions / storages 是全 profile 共享的）。

---

## 2. 顺带推翻的两个错误判断

排查中出现过两个看起来很有道理、实际错误的结论，记录在此避免复发：

1. **`dsh.client.inject` 不是激活门。**
   浏览器端 `dsh-client-modules/lib/client.js` 的 `arriveGraphRow` 对每个名字只做
   `this.graphRows.get(name)`，**查不到就 `continue`**（静默跳过，不会 pending、不报错）。
   它只影响模块到达顺序。
   真正的激活门是插件模块自己导出的那个数组：

   ```js
   // src/client/index.js
   export const inject = ['slots', 'remote.commands', 'locale']   // ← 服务名，这才是门
   ```

   它进 `ctx.fiber.inject`，前端 kernel 的 `assertEntriesActive` 用
   `ctx.get(name) === undefined` 判定，不满足才 pending 并抛 "Failed to load plugins"。
   两处语义不同，**都要写**。

2. **`@deepseek-ai/dsh-client-runtime` 缺位不是 bug。**
   它是 **0.1.1-rc.2 时代的客户端核心包**（描述：Client core services: SlotRegistry, SessionRuntime），
   在 0.1.2-rc.1 里已被拆分掉 —— `dsh --dump-config` 显示两个 profile 都**没有这一行**，
   前端 seed word 表里也没有它。`dshmarket` / `dsh-better-sidebar` / `dsh-effort-slider` /
   `dsh-tauri*` 的 `package.json` 里仍 inject 它，那是写在旧版本上的残留。
   `verify-install.mjs` 会把它判为 "a real web client entry"（它确实是个声明了
   `dsh.client.platform:"web"` 的真包），**所以这个检查无法用来判断"名字是否还是活的 boot row"**
   —— 那要问 `--dump-config`。

---

## 3. 所做的配置改动

改动前全部备份，备份戳 **`20260914-210856`**（`.bak-20260914-210856` 后缀）。

### 3.1 `~/.dsh/profiles/desktop/package.json`

```diff
   "private": true,
-  "dependencies": {},
+  "dependencies": {
+    "dsh-prompt-enhance": "link:D:/Ruanjian/dsh-plugins/dsh-prompt-enhance"
+  },
   "dsh": {
     "profile": {
       "bundles": [
         "@deepseek-ai/dsh-base",
-        "@deepseek-ai/dsh-web-app"
+        "@deepseek-ai/dsh-web-app",
+        "dsh-prompt-enhance"
       ],
```

### 3.2 `~/.dsh/profiles/desktop/node_modules/dsh-prompt-enhance`

junction → `D:\Ruanjian\dsh-plugins\dsh-prompt-enhance`

```powershell
New-Item -ItemType Junction `
  -Path "$env:USERPROFILE\.dsh\profiles\desktop\node_modules\dsh-prompt-enhance" `
  -Target "D:\Ruanjian\dsh-plugins\dsh-prompt-enhance"
```

> 只用 junction：Windows 原生符号链接需要管理员或开发者模式，junction 不需要，
> 且 pnpm 在 Windows 上也是这么做的。`cmd /c mklink` 在本机会被安全策略拦截。

### 3.3 两个 `pnpm-lock.yaml` 补条目

`desktop` 原为 `.: {}`，`web` 则是**手改 package.json 留下的漂移**（`package.json` 声明了
`link:` 依赖但 lock 里没有）。两处都补上：

```yaml
  .:
    dependencies:
      dsh-prompt-enhance:
        specifier: link:D:/Ruanjian/dsh-plugins/dsh-prompt-enhance
        version: link:D:/Ruanjian/dsh-plugins/dsh-prompt-enhance
```

### 3.4 没有改的东西（重要）

- **active profile 仍是 `desktop`**。按你的选择（两个 profile 都装上），没有动
  `state.json`。想让桌面端回到 `web` 那套完整环境，改
  `%APPDATA%\DSH Desktop\profile-selection\state.json` 为 `{"version":2,"active":"web"}`
  后重启即可（备份已有）。
- **插件的 `dsh.client.inject` 没改**。`@deepseek-ai/dsh-client-runtime` 保留 ——
  它无害（那条排序边会被丢掉），且与生态里其它插件的写法一致。

---

## 4. 验证方式

### 4.1 静态验证（已执行，全部通过）

```bash
cd D:/Ruanjian/dsh-plugins/dsh-prompt-enhance

# ① 组合树里有没有这个包（地面真相）
%APPDATA%\DSH Desktop\host-commands\desktop\bin\dsh.cmd --profile desktop --dump-config
%APPDATA%\DSH Desktop\host-commands\desktop\bin\dsh.cmd --profile web     --dump-config

# ② link / patch / 座席 id+order / 命令重名 / primitives 导出名
node scripts/verify-install.mjs         --profile C:/Users/leiyu17866/.dsh/profiles/desktop
node scripts/verify-install.mjs         --profile C:/Users/leiyu17866/.dsh/profiles/web

# ③ 客户端 roster 复算（本次新增，②查不出"装对 profile 了吗"）
node scripts/verify-profile-roster.mjs  --profile C:/Users/leiyu17866/.dsh/profiles/desktop
node scripts/verify-profile-roster.mjs  --profile C:/Users/leiyu17866/.dsh/profiles/web

# ④ 离线测试
node --test "tests/**/*.test.mjs"
```

实际结果：

| 检查 | `desktop` | `web` |
|---|---|---|
| 组合树行数 | 145 | 184 |
| 客户端 roster 条目 | 47（bundle 缺失 0） | 66（bundle 缺失 0） |
| `dsh-prompt-enhance` 在 roster | **✓** `dist/client.cjs` 46019B | **✓** |
| `verify-install` | OK（21 项全绿） | OK |
| `verify-profile-roster` | OK | OK |
| 测试 | 206 例 / 42 套全过 | 同 |

### 4.2 端到端确认（需要你重启 DSH Desktop）

**必须重启**：客户端 bundle 是启动时按 `exports["./client"]` 读进 module table 的，
不重启界面跑的还是旧的那份。

1. 完全退出 DSH Desktop 再打开（不只是关窗口）。
2. 打开任意会话，看输入框右侧：发送键左边应出现一枚 **四角星 ✦** 图标
   （紧贴模型选择器左侧，`order=40`；`dsh-codex-connect` 占了 order 10/20，不冲突）。
3. 打字后点它 → 草稿被改写；也可用 `/enhance-prompt` 命令。
4. 若图标仍不出现，回看这几处（按顺序）：
   - `%APPDATA%\DSH Desktop\profile-selection\state.json` 的 `active`；
   - `~/.dsh/profiles/desktop/cordis.yml` 的 mtime 是否等于本次启动时刻；
   - 界面上是否出现 "Failed to load plugins" 卡片（有的话把卡片内容给我）。

### 4.3 回滚

```bash
# 配置回滚（备份戳 20260914-210856）
cd ~/.dsh/profiles
cp desktop/package.json.bak-20260914-210856   desktop/package.json
cp desktop/pnpm-lock.yaml.bak-20260914-210856 desktop/pnpm-lock.yaml
cp web/pnpm-lock.yaml.bak-20260914-210856     web/pnpm-lock.yaml
# 再移除 desktop/node_modules/dsh-prompt-enhance 这个 junction
```

---

## 5. 附带修正

- 新增 `scripts/verify-profile-roster.mjs` + `npm run verify:roster`：
  跑 `dsh --profile <name> --dump-config`，按 host 的真实规则复算客户端 roster
  （`组合树的行 name → 能解析到包 → 包 dsh.client.platform === "web" → 且有 exports["./client"]`），
  并断言目标包在 roster 里。自动依次找 `$DSH_BIN` → 本 profile 的 shim → 任意兄弟 shim → PATH 的 `dsh`。
- 修正 `scripts/verify-install.mjs` 中关于 `dsh.client.inject` 的注释：
  原文写"boot graph 把它当依赖、条目永不 settle"，与实测不符（见第 2 节）。
