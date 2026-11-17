# Native DSH installation

[简体中文](dsh-installation.zh-CN.md) · [Project overview](../README.md)

This guide is specific to DeepSeek Harness / DSH. Historically verified on DSH Desktop 2.0.5 with `@deepseek-ai/*` 0.1.2-rc.1; validate other versions against the actual profiles you use.

## Build and mount

```sh
git clone https://github.com/LeiQAQ/dsh-prompt-enhance.git
cd dsh-prompt-enhance
npm run build
```

The build uses Node built-ins. Development tests additionally need `npm ci`; see [CONTRIBUTING.md](../CONTRIBUTING.md).

In both `~/.dsh/profiles/web/package.json` and `~/.dsh/profiles/desktop/package.json`, merge the dependency `"dsh-prompt-enhance": "link:/absolute/path/to/dsh-prompt-enhance"` and append `"dsh-prompt-enhance"` to `dsh.profile.bundles`. Preserve other dependencies and bundles.

Make the package resolvable from each profile. On Linux/macOS, when the links do not already exist:

```sh
ln -s /absolute/path/to/dsh-prompt-enhance ~/.dsh/profiles/web/node_modules/dsh-prompt-enhance
ln -s /absolute/path/to/dsh-prompt-enhance ~/.dsh/profiles/desktop/node_modules/dsh-prompt-enhance
```

Replace the example paths. On Windows, use `New-Item -ItemType Junction -Path <profile-link-path> -Target <repository-path>`. Inspect existing targets first; do not overwrite other copies or links.

## Verify and restart

```sh
node scripts/verify-install.mjs --profile "$HOME/.dsh/profiles/web"
node scripts/verify-install.mjs --profile "$HOME/.dsh/profiles/desktop"
node scripts/verify-profile-roster.mjs --profile "$HOME/.dsh/profiles/desktop"
node scripts/verify-profile-roster.mjs --profile "$HOME/.dsh/profiles/web"
npm run check:restart
```

These are POSIX shell examples; on Windows, supply actual absolute profile paths. Roster checks need a working DSH CLI; set `DSH_BIN` if necessary.

Fully quit and restart DSH Desktop. Its single-instance lock means opening an already-running app again is not a restart. Installing only into web does not activate the plugin when the app boots its desktop profile.

## Use and configure

- Click ✦ to rewrite, click again while busy to cancel, and restore the original after success.
- `/enhance-prompt <text>` invokes the same capability.
- Model selection follows the session route, then deployment default; a missing selection produces `no_model`. T3 configuration is separate.
- `cordis.patch.yml` sets the default 120-second timeout. The draft limit is 20,000 characters.
- Each enhancement leaves a command node. `recordInput: false` suppresses draft arguments, not the node. `b64:` is encoding, not encryption.

## Uninstall and troubleshoot

Remove this bundle entry from both profiles and fully restart. Then remove its dependency declarations and links if desired, preserving other plugins.

[Profile-loading diagnosis](profile-not-loading-diagnosis.md) · [Transport-failure diagnosis](enhance-transport-failure-diagnosis.md)

The 2026-11-16 T3 update did not revalidate an active DSH host: the local web profile was not mounted with this plugin, so its loading checks did not pass their environment prerequisites. T3 validation does not establish that DSH is installed on your machine.
