**English** | [简体中文](README.zh-CN.md)

# ✦ Miaobi · Prompt Enhance

**Turn a rough draft into a clearer prompt, directly in your AI agent’s composer.**

Miaobi reads the current draft, asks the configured model to rewrite it, and places the result back in the composer for you to review and send. It clarifies wording, goals and existing constraints. It does not execute the task, automatically supply missing facts, or send the message for you.

Originally built for DeepSeek Harness, the project now includes a **native DSH plugin, a local T3 composer adapter, an experimental Codex Desktop adapter, and a Codex skill fallback**. Enhancement logic is separated from platform integration; the package name remains `dsh-prompt-enhance`.

## Latest changes · 2026-11-17

- **Color flow across the T3 composer:** a moving multicolor rim and subtle wash appear during real enhancement requests. The effect fades after insertion and clears immediately on cancellation, failure, editing or thread changes. Respects reduced-motion preferences.
- **T3 composer support:** a `✦` button beside the model picker, click-again cancellation, `↶` restore, and protection against late results after edits or thread changes.
- **DeepSeek Flash with thinking disabled:** the T3 backend calls the official API and explicitly sends `thinking: { "type": "disabled" }`. Short-draft tests completed in about one second on the test machine; this is an observation, not a latency guarantee.
- **Separate enhancement model:** T3 can use DeepSeek or Codex CLI independently of the chat model.
- **Local service and installation protection:** loopback-only listening, authenticated requests, cancellation, failure protection, application backups and uninstall. See the [changelog](CHANGELOG.md).

## Integrations and capabilities

| Entry point | Status | Model selection | Guide |
|---|---|---|---|
| DeepSeek Harness / DSH | Native plugin; historically verified on DSH Desktop 2.0.5 | Session route → deployment default | [DSH installation](docs/dsh-installation.md) |
| T3 Code | Experimental local adapter; verified on macOS, ad-hoc-signed `0.1.9-zh.1` | Separately configured official DeepSeek API or Codex CLI | [T3 setup, models and uninstall](docs/t3-composer.md) |
| Codex Desktop | Experimental CDP adapter; historically verified on Windows | Configured OpenAI-compatible API | [Codex integration notes](docs/codex-enhance-button-实现总结.md) |
| Codex skill | Conversation fallback when no UI adapter is available | Model running the skill | [prompt-enhance skill](plugins/codex-prompt-enhance/skills/prompt-enhance/SKILL.md) |

**Integration methods and capabilities differ.** DSH uses public extension points without changing the host kernel. T3 patches the application’s HTML entry, updates integrity metadata and re-signs the local ad-hoc build. Codex Desktop uses an explicitly enabled CDP endpoint without editing installed files. These desktop adapters are not official platform plugin APIs and do not imply compatibility with every version.

## What it does

```text
Write a draft → click ✦ → review the rewrite → send it yourself
```

DSH and T3 support empty-input rejection, click-again cancellation, unchanged drafts on model or transport failure, stale-result protection after edits or thread changes, and restoring the original after success. A later edit clears that restore option.

Codex Desktop supports rewriting, cancellation and stale-result protection, but does not yet expose the same dedicated restore button as DSH/T3. The skill fallback returns rewritten text and does not automatically read or modify the native composer.

Use Miaobi to organize development requests, editing instructions, product-copy briefs and existing constraints. It is not a fact checker and does not automatically inspect the full conversation, repository or attachments to fill missing context. Review the result before sending.

## Recommended models

| Model / setting | Suggested use | Integration status |
|---|---|---|
| **DeepSeek Flash, thinking disabled** (`deepseek-flash`) | **First choice for responsive rewriting:** everyday prompt polishing, informal tasks and short drafts | Implemented and tested through the official API in T3; backend reads an existing CC Switch credential |
| DeepSeek Flash, low thinking | Evaluation candidate when wording or constraints need extra consideration | Benchmarked separately; the current T3 DeepSeek route requires thinking disabled and does not expose low mode |
| GPT-6 Luna, low | Everyday rewriting while retaining an existing Codex login workflow | Tested through the T3 Codex CLI route |
| GPT-6.1 Sol, low | An existing configuration, or a candidate to evaluate on more involved drafts | Initial T3 installer default; tested |
| GPT-6.1 Terra, low | Optional evaluation for an existing Terra workflow | Tested through Codex CLI; no consistent speed advantage observed |

**Recommendation is not the installer default.** A fresh T3 installation starts with Sol. Follow the [DeepSeek setup guide](docs/t3-composer.md#deepseek-flash) to choose Flash with thinking disabled. DSH follows its host route. The current Codex Desktop launcher does not expose a thinking toggle; advanced model parameters require separate adaptation.

The [model-selection notes](docs/model-selection.md) include individual timings, request paths, cache information and limitations. Direct DeepSeek API and Codex CLI results compare complete integration paths, not raw model inference speed.

## Get started

```sh
git clone https://github.com/LeiQAQ/dsh-prompt-enhance.git
cd dsh-prompt-enhance
npm ci
npm run build
```

Then follow the guide for your host. Cloning the repository or installing the skill alone does not add buttons to every application.

- **DSH:** [mount into the web / desktop profiles and verify loading](docs/dsh-installation.md).
- **T3 on macOS:** read the signing and version requirements, run `python3 adapters/t3/install.py`, then configure the enhancement model.
- **Codex Desktop:** follow the [CDP instructions](docs/codex-enhance-button-实现总结.md), then run `npm run adapter:codex`.

## Drafts and credentials

Drafts are sent to the configured model provider and consume its API balance or account quota. T3’s DeepSeek route uses HTTPS to the official API. Its API key stays in the backend and is not copied into the renderer, repository or Miaobi configuration. The service does not retain draft or output text logs.

DSH’s `b64:` transport is encoding, **not encryption**. `recordInput: false` prevents command logs from recording draft arguments. Full conversation history is not automatically included in enhancement requests.

## Current boundaries

- DSH/T3 accept drafts up to 20,000 characters. T3 rejects rich text with file, skill or model reference tokens to preserve them; external attachments are not sent to the enhancement model.
- T3 depends on the current DOM/Tiptap interface and local service. Application updates may require revalidation and reinstallation; moving the source directory requires updating the LaunchAgent path.
- T3’s DeepSeek credential source currently supports CC Switch only. Some Node 22 versions report an experimental `node:sqlite` warning.
- Host-version verification is documented per adapter. A short-draft benchmark is not a quality evaluation or a long-term availability guarantee.

## Development and documentation

There are no runtime npm dependencies. Development tests use Playwright; after `npm ci`, prepare a test browser as described in [CONTRIBUTING.md](CONTRIBUTING.md).

```sh
npm run verify:prompts
npm run build
npm test
python3 -m unittest discover -s tests -p 't3_install_test.py' -v
```

Local validation on 2026-11-16 passed 235 JavaScript tests and two installer tests. DSH host-loading checks additionally require a mounted profile; passing the cross-platform suite alone does not prove a DSH installation is active.

[Changelog](CHANGELOG.md) · [Contributing](CONTRIBUTING.md) · [Model selection](docs/model-selection.md) · [T3 adapter](docs/t3-composer.md) · [DSH transport diagnostics](docs/enhance-transport-failure-diagnosis.md) · [Profile-loading diagnostics](docs/profile-not-loading-diagnosis.md)

[MIT License](LICENSE)
