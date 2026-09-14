<p align="center">
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/License-MIT-blue.svg"></a>
  <img alt="tests" src="https://img.shields.io/badge/tests-214%20passing-brightgreen">
  <img alt="kernel changes" src="https://img.shields.io/badge/host%20kernel%20changes-0-success">
  <img alt="platform" src="https://img.shields.io/badge/platform--agnostic%20core-8A2BE2">
</p>

**English** | [简体中文](README.zh-CN.md)

# ✦ Miaobi · Prompt Enhance (`dsh-prompt-enhance`)

> **One-click prompt enhancement, built into your agent's composer.** A ✦ button that turns a rough draft into a high-quality prompt — running on the model your session already uses. Built for DeepSeek Harness, designed to port to any agent framework.

> ✦ 一键把随手写的草稿变成高质量提示词 —— 用会话当前的模型，一次调用，失败绝不动原文。（中文版文档：[README.zh-CN.md](README.zh-CN.md)）

You know the moment: you type "write me a product intro" and even you can tell the prompt isn't good enough. Miaobi lives in the input box — one click, and the session's current model rewrites your draft into a prompt with clear goals, structure, and constraints. Didn't like the result? One more click restores your original text.

It replicates the same-named capability of WorkBuddy, with **zero changes to the dsh kernel** — it uses only public extension points: `ctx.commands` / `ctx.llm` / slots / the mounted `remote.commands` namespace.

- Form: a dual-half plugin (host `dist/index.js` + client `dist/client.cjs`), mounted into a dsh profile via `link:`
- License: MIT
- Compatibility: verified on DSH Desktop 2.0.5 (`@deepseek-ai/*` `0.1.2-rc.1`); later dsh versions — test with `npm run verify:install`

---

## Why this project

**1. Your text is never lost.** The failure contract is the most guarded part of this plugin: on *any* failure — timeout, model error, network drop, empty output — the draft stays **character-for-character identical**. The button shows a readable reason plus a machine diagnostic code; click again to retry. Clicking during enhancement is a **real cancellation** (`AbortSignal` propagates to the model provider — not a UI fake). Before a result lands, it is checked against `(text, draftRev)`, so a late result can never overwrite edits you made meanwhile.

**2. Privacy-first transport.** The draft never travels as plaintext — UTF-8 bytes encoded as an unpadded base64url token (`b64:` prefix), and `recordInput: false` keeps even that token out of the session log. The host log records lengths, durations and result codes only — never content.

**3. Engineering-grade trust.** 214 offline unit tests (no browser or model needed); `npm run verify` chains prompt-asset hash verification → build → full test suite → installation check; `verify:install` catches the pitfalls that only appear once installed (link resolution, icon export tables, seat collisions). `docs/` contains two incident post-mortems with full evidence chains — the pitfalls we hit became tools and guards, not "beware" comments.

**4. A platform-agnostic core.** See [Architecture & extensibility](#architecture--extensibility). This is not a slogan: the host half has **zero runtime value-imports of dsh packages** — every capability arrives through `ctx` and shapes are handled structurally; the shared protocol layer is pure functions. Porting to another agent framework means implementing four adapter functions.

---

## Features

| Scenario | Behavior |
|---|---|
| Non-empty draft | Button enabled; click → spinner → the composer content is replaced with the rewritten prompt |
| Empty / whitespace-only draft | Button `disabled`, hover hint: "write something first" |
| Click again while enhancing | **Real cancellation** (`AbortSignal` reaches the provider), back to `idle`, no error |
| You edit the draft while enhancing | The late result is **silently dropped** — never overwrites, never errors |
| Any failure | Draft **character-for-character unchanged**; warning state with a readable reason + machine diagnostic code; click to retry |
| After success | A "restore original" button appears; it disappears as soon as you edit |
| Session switch | An in-flight enhancement can never land in another session's composer |

Every failure message carries "原文没动" / "Your text is untouched" — the single most important line of the failure contract.

**Placement & look**: the `conversation.input.right` slot, `order = 40` (just left of the model picker), a four-point-star icon, a 28×28 ghost button — all styled from `--dsw-alias-*` semantic tokens, so it follows the theme.

**Command entry**: `/enhance-prompt <text>` works too (and doubles as a manual test entry).

---

## Architecture & extensibility

### Layers: the core and the platform each stay where they belong

```
┌────────────────────────────────────────────────────────────┐
│              Platform adapter layer (thin, replaceable)    │
│  host: apply() command registration (~10 lines)            │
│        resolveSelection() session model resolution          │
│  client: apply() slot registration                         │
│          startRewrite → remote channel                     │
├────────────────────────────────────────────────────────────┤
│         Capability contract layer (structural, no imports) │
│  llm.js stream-finish classification · deadline.js timeout │
│  errors.js error normalization                             │
├────────────────────────────────────────────────────────────┤
│         Domain core layer (pure functions, 100% agnostic)  │
│  shared/codec.js base64url codec · shared/codes.js codes   │
│  host/prompts.js prompt assets (sha256 anchors)            │
│  client/state.js state machine · transport.js interpreter  │
└────────────────────────────────────────────────────────────┘
```

This layering is a hard constraint from day one, verifiable in the source:

- **Zero runtime value-imports on the host half** (`src/host/index.js`): "every host capability arrives through `ctx`, and the `Message`/`StreamChunk` shapes are handled structurally" — there is not a single import of a dsh package; model messages and stream chunks are handled by shape.
- **Everything decidable is a pure function**: the state machine, transport interpreter, error normalization and codec depend on no platform object — which is also why 214 tests run offline in CI.
- **Prompt assets live in their own file** (`src/host/prompts.js`) with sha256 anchors against silent degradation; they carry over to another platform unchanged.

### Porting to another agent framework = four adapter functions

| # | Adapter point | Current implementation | What you provide |
|---|---|---|---|
| 1 | Command registration | `ctx.commands.register({ name, recordInput: false, handler })` | Your framework's custom slash-command / tool registration API |
| 2 | Session model resolution | `resolveSelection(agent)` reads the current route | "Which model is this session using" lookup |
| 3 | Streaming model call | `llm.stream({ system, messages, signal })` + finish classification | Any OpenAI-compatible API or built-in LLM facade |
| 4 | Composer UI seat | `ctx.slots` slot + `remote.commands` channel | Your framework's input-area extension point; a pure-frontend build can call the LLM API directly and skip #1/#2 |

Everything else carries over as-is: the domain core needs no changes, and the failure contract (untouched text + diagnostic codes), CAS race protection, cancellation semantics and privacy encoding are all platform-agnostic designs — they don't degrade on another framework.

> **Roadmap**: adapter packages are welcome as `adapters/<your-platform>/` PRs — the core stays untouched. First on the wish list: a pure-frontend build for Claude Code / any OpenAI-compatible endpoint.

### How this differs from "another prompt-optimizer web app"

Standalone optimizers make you copy your idea *out* and paste the result *back*, losing the context of what you're doing in this session. Miaobi lives *in* the composer: it uses **the model your session already routes to**, rewrites **the current draft**, lands the result **in place**, and on failure **never touches your text**. Those four together are "prompt enhancement" — not one more chat window.

---

## Installation & quick start

Prerequisite: DSH Desktop installed, with `web` and `desktop` profiles under `~/.dsh/profiles/`.

```bash
# 0. Clone and build
git clone https://github.com/LeiQAQ/dsh-prompt-enhance.git
cd dsh-prompt-enhance
npm run build          # → dist/index.js + dist/client.cjs

# 1. Mount into BOTH profiles (web and desktop)
#    (which profile the desktop app boots is decided by the "active" field in
#      %APPDATA%\DSH Desktop\profile-selection\state.json — default: desktop;
#      installing into web only means a silent no-button, no error)
#
#    In each ~/.dsh/profiles/<p>/package.json:
#      add to dependencies:
#        "dsh-prompt-enhance": "link:<path to this clone>"
#      add to dsh.profile.bundles:
#        "dsh-prompt-enhance"

# 2. Make the profile's node_modules actually see it (link: needs a real link)
#    Linux/macOS:  ln -s <path to this clone> ~/.dsh/profiles/<p>/node_modules/dsh-prompt-enhance
#    Windows:      New-Item -ItemType Junction `
#                    -Path "$env:USERPROFILE\.dsh\profiles\<p>\node_modules\dsh-prompt-enhance" `
#                    -Target "<path to this clone>"

# 3. Verify mounting (once per profile)
node scripts/verify-install.mjs
node scripts/verify-profile-roster.mjs --profile "$USERPROFILE/.dsh/profiles/web"
node scripts/verify-profile-roster.mjs --profile "$USERPROFILE/.dsh/profiles/desktop"
```

Restart DSH Desktop — the four-point-star button appears on the composer toolbar.

### ⚠️ "Restart" must be a real restart — clicking the icon again doesn't count

DSH Desktop is Electron with a **single-instance lock**: launching again while the process is alive only raises the existing window. The client roster and host modules are **read once at boot**, so after such a fake restart the plugin doesn't appear / changes don't take effect, **with no error at all**.

Self-check (tells you exactly whether a restart is needed):

```bash
npm run check:restart
#   ok   no DSH Desktop instance is running — just launch it …
# or
#   FAIL FULL RESTART REQUIRED — the running instance booted at … , but desktop last changed at …
```

To truly exit, don't click the window's × (it may just hide to the tray):

```powershell
Stop-Process -Name "DSH Desktop" -Force
# or tray icon → Quit
```

**Uninstall**: remove the entry from `dsh.profile.bundles` → restart. To clean up fully, also delete the `node_modules` link and the `dependencies` entry.

---

## Usage

**The button is the main entry.** Type (or paste) a rough draft, click ✦, wait a moment, and the composer now holds the enhanced prompt. Click ✦ again while it spins to cancel for real; after success, use the small restore button to take back the rewrite.

**The slash command is the equivalent path** (and a handy manual test entry):

```
/enhance-prompt write me a product intro, keep it short
```

The toolbar button actually sends the draft in encoded transport form — same command, opaque payload:

```
/enhance-prompt b64:5Y2X55S15a2m55Sf...
```

**Health checks you can run anytime:**

```bash
npm run check:restart    # do I need a real restart?
npm run verify           # prompt hashes → build → all tests → mount check
npm test                 # 214 offline unit tests only
```

**What to expect** (illustrative):

```
Draft:     help me write a product intro
Enhanced:  a prompt with explicit goal, audience, structure, tone
           and length constraints — ready to send as-is
```

---

## Configuration

| Setting | How | Default |
|---|---|---|
| Call timeout | `config.timeoutMs` in `cordis.patch.yml` | `120000` (120 s) |
| Draft length cap | `MAX_DRAFT_LENGTH` in `src/shared/protocol.js` | `20000` chars (rejected client-side, no round-trip spent) |
| Model | none needed — follows the session's active model; falls back to the deployment default; reports `no_model` with guidance if neither exists | session model → deployment default |
| Prompt assets | `src/host/prompts.js` (sha256-anchored; `npm run verify:prompts` guards against "copied with a line missing") | WorkBuddy's assets, reused character-for-character |

---

## FAQ

**The button doesn't appear.**
Three usual causes, in order: (1) fake restart — run `npm run check:restart` and do a real quit; (2) mounted into only one profile — the desktop app boots `desktop` by default, install into both; (3) roster mismatch — run `verify-install` / `verify-profile-roster`, they pinpoint it.

**It says "no model / this session has no routed model yet".**
The plugin intentionally uses your session's own model instead of a hard-coded one. Send one message first (so the session gets a route), or set a default model — then retry.

**Where does my draft go?**
To the model provider your session already talks to — nowhere else. In transit it's a base64url token; `recordInput: false` keeps it out of the session log; the host log records only lengths, durations and result codes.

**Why does each enhancement leave a command node in the session?**
Inherent to the command channel — `recordInput: false` can hide the arguments but not the node. It never enters the model's context.

**`verify:install` reports `seat order tie`.**
Another plugin claims order 40. Change `SEAT_ORDER` in `src/client/index.js` (and the matching test constant).

**Is this the same as the `dsh-prompt-enhance` in the community plugin market?**
No — that entry is by a different author (rongxingda). This project is mounted locally via `link:`; the name clash is unfortunate but harmless.

**Can I port it to another agent framework (Claude Code, etc.)?**
The architecture is built for it — see the four adapter points above. Cross-platform adapters are an architecture commitment, not yet shipped adapters; PRs welcome.

**Does enhancement cost anything?**
It's one ordinary model call on your session's route — it consumes your existing quota, nothing more.

---

## Known limitations

- Each enhancement leaves one command node in the session (`command/run` + `command/done`). Inherent to the command channel; it never enters the model context.
- The seat `order` is hard-coded to 40; a collision is caught by `verify:install` as `seat order tie` — change `SEAT_ORDER` in `src/client/index.js` (and the test constant).
- Platform assumptions must be checked against the dsh installation actually in effect. If your machine has several dsh copies, frontend bundles and icon export tables may differ — the verify scripts resolve paths from the profile, never hard-coded.
- F10 (local stats) and F11 (settings page) are not implemented; adjust the timeout via `config.timeoutMs` in `cordis.patch.yml` (default 120 s).
- The package name `dsh-prompt-enhance` clashes with a same-named community market entry (by rongxingda). This plugin mounts locally via `link:`, so no conflict — just don't confuse the two.

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). When filing an issue, please attach the output of `npm run verify` and the verdict of `npm run check:restart` — most "the plugin is broken" reports are really "didn't restart for real". Cross-platform adapters are the most welcome contribution direction.

## License

[MIT](LICENSE)

---

If this project helps you, a **Star** ⭐ is the most honest feedback an indie project can get.
