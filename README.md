**English** | [简体中文](README.zh-CN.md)

# ✦ Miaobi · Prompt Enhance

**Turn a draft into a clearer prompt, directly in your AI agent’s composer.**

Miaobi reads the text you are editing, asks the configured model to rewrite it, and returns the result for you to review and send. It helps clarify goals, wording and existing constraints. It does not execute the task, automatically supply missing facts, or send messages.

Originally built for DeepSeek Harness, the project now provides a native DSH plugin, a local T3 composer adapter, an experimental Codex Desktop adapter and a Codex skill. Enhancement logic is separate from platform integration. The project name is Miaobi; the repository and npm package remain `dsh-prompt-enhance`.

## Who it is for

- **AI coding tool users:** organize goals and existing requirements before submitting development, debugging or editing requests.
- **People who write prompts regularly:** refine product descriptions, editing instructions and copy briefs while reviewing the result for accuracy.
- **Integration maintainers:** understand platform support, model configuration, compatibility limits and verification steps.

Miaobi processes the current draft. It does not automatically read the full conversation, repository or attachments for context, and it does not verify facts. Review each rewrite before sending it.

## Current status · 2026-11-17

T3 adapter **0.2.0** adds a moving multicolor rim and subtle wash across the composer during real enhancement requests. The effect fades after insertion and clears immediately on cancellation, failure, editing or thread changes. It respects reduced-motion preferences and does not delay results to display the animation.

T3 supports **DeepSeek Flash with thinking disabled**, configured independently of the chat model. New installations still default to GPT-6.1 Sol with low reasoning; selecting Flash requires configuration. See the [changelog](CHANGELOG.md) for details.

## Platform support

| Entry point | Implementation and verification scope | Enhancement model source | Guide |
|---|---|---|---|
| DeepSeek Harness / DSH | Native plugin; historically verified on DSH Desktop 2.0.5 | Session route → deployment default | [DSH installation](docs/dsh-installation.md) |
| T3 Code | Experimental local adapter; verified on macOS, ad-hoc-signed `0.1.9-zh.1` | Separately configured official DeepSeek API or Codex CLI | [T3 setup, models and uninstall](docs/t3-composer.md) |
| Codex Desktop | Experimental CDP adapter; historically verified on Windows | Configured OpenAI-compatible API | [Codex integration](docs/codex-enhance-button-实现总结.md) |
| Codex skill | Conversation entry point without a composer button | Model running the skill | [Skill guide](plugins/codex-prompt-enhance/skills/prompt-enhance/SKILL.md) |

DSH uses public extension points without changing the host kernel. T3 patches the application’s HTML entry, updates integrity metadata and applies a local ad-hoc signature, with backups and an uninstall path. Codex Desktop requires user-enabled CDP and does not modify installed application files. The desktop adapters are not official platform plugin APIs; verification on the versions above does not imply compatibility with other releases.

## Features and workflow

```text
Edit a draft → click ✦ → review the rewrite → send it yourself
```

| Feature | DSH | T3 | Codex Desktop | Codex skill |
|---|---|---|---|---|
| Read and replace the composer draft | Yes | Yes | Yes | User supplies text; skill returns a rewrite |
| Click again to cancel; keep draft on failure | Yes | Yes | Yes | Does not modify the native draft |
| Prevent late results overwriting edits or another thread | Yes | Yes | Yes | No automatic insertion |
| Restore the original with `↶` after success | Yes | Yes | No dedicated button | Does not modify the native draft |
| Multicolor flow across the composer during a request | Not provided | Yes | Not provided | No composer effect |

DSH/T3 disable enhancement for empty drafts and accept up to 20,000 characters. Editing a rewritten result clears its restore option. T3 rejects rich text containing file, skill or model reference tokens to preserve those references; ordinary external attachments are not sent for enhancement.

## Model selection

These recommendations primarily concern **T3’s separate enhancement backend** and do not change the main chat model.

| Model / setting | Suggested use | Current integration |
|---|---|---|
| **DeepSeek Flash, thinking disabled** (`deepseek-flash`) | Everyday polishing, informal requests and short drafts where responsiveness matters | Recommended configuration; official API route implemented and tested in T3, with read-only access to an existing CC Switch credential |
| GPT-6 Luna, low | Everyday rewriting through an existing Codex login | Tested through the T3 Codex CLI route |
| GPT-6.1 Sol, low | Retain the initial configuration or evaluate more involved drafts | T3 installer default; tested |
| GPT-6.1 Terra, low | Evaluate within an existing Terra workflow | Tested through T3 Codex CLI; no consistent speed advantage observed |
| DeepSeek Flash, low thinking | Separate evaluation of thinking mode | Benchmarked separately; the current T3 DeepSeek route requires thinking disabled and does not expose low mode |

The Flash backend explicitly sends `thinking: { "type": "disabled" }`. Follow the [T3 configuration guide](docs/t3-composer.md#deepseek-flash); the installer does not automatically select Flash or discover its credential.

DSH follows its host model route. The Codex Desktop launcher currently has no thinking toggle; advanced parameters require separate adaptation. Short Flash drafts completed in about one second in a small local sample, which is neither a latency guarantee nor a quality ranking. See [model selection and benchmarks](docs/model-selection.md) for individual timings, caching and request paths. Direct API and Codex CLI timings compare complete integration paths rather than raw model inference speed.

## Installation entry points

Fetch and build the project:

```sh
git clone https://github.com/LeiQAQ/dsh-prompt-enhance.git
cd dsh-prompt-enhance
npm ci
npm run build
```

Then complete the integration for your host. Cloning the repository or installing the skill does not add buttons to every application.

- **DSH:** follow the [installation guide](docs/dsh-installation.md) to mount the web / desktop profiles and verify loading.
- **T3 on macOS:** read the [version, signing and dependency requirements](docs/t3-composer.md), then run `python3 adapters/t3/install.py`. The current installer requires Node.js 22+, Python 3, codesign and an available Codex CLI; DeepSeek also requires a valid existing CC Switch configuration. Reload T3 after installation, then configure the desired model.
- **Codex Desktop:** follow the [CDP guide](docs/codex-enhance-button-实现总结.md) to start the application and `npm run adapter:codex`.
- **Codex skill:** follow the [skill guide](plugins/codex-prompt-enhance/skills/prompt-enhance/SKILL.md) to install and invoke it.

For existing T3 installations, this frontend-effect update only requires updated source, a Miaobi service restart and a T3 reload. It does not require re-signing the application. Commands are in the [T3 guide](docs/t3-composer.md).

## Data handling and limitations

- Drafts are sent to the configured model provider and consume its API balance or account quota. Full conversation history is not automatically included.
- T3’s DeepSeek route uses HTTPS to the official API. The key stays in the backend and is not copied into the renderer, repository or Miaobi configuration. The backend does not retain draft or output text logs; CC Switch is currently the only implemented DeepSeek credential source.
- DSH’s `b64:` transport is encoding, **not encryption**. `recordInput: false` prevents command logs from recording draft arguments.
- T3 depends on the current DOM/Tiptap interface and local service. Application updates may require revalidation or reinstallation; moving the source directory requires updating the LaunchAgent path. Some Node 22 versions report a nonfatal experimental `node:sqlite` warning.
- Historical host verification does not establish compatibility with every current environment. Short-draft timings do not establish complex-task quality or long-term availability.

## Development and verification

There are no runtime npm dependencies. Development tests use Playwright; after `npm ci`, prepare a test browser as described in [CONTRIBUTING.md](CONTRIBUTING.md).

```sh
npm run verify:prompts
npm run build
npm test
python3 -m unittest discover -s tests -p 't3_install_test.py' -v
```

Local validation on 2026-11-17 passed 240 JavaScript tests, two installer tests, the build and prompt checks. Real T3 enhancement, insertion and restore were rechecked. DSH host-loading checks separately require a mounted profile; passing the cross-platform suite alone does not prove that DSH is installed successfully.

[Changelog](CHANGELOG.md) · [Contributing](CONTRIBUTING.md) · [Model selection](docs/model-selection.md) · [T3 adapter](docs/t3-composer.md) · [DSH transport diagnostics](docs/enhance-transport-failure-diagnosis.md) · [Profile-loading diagnostics](docs/profile-not-loading-diagnosis.md)

[MIT License](LICENSE)
