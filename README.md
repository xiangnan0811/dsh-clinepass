# DSH ClinePass

ClinePass plugin for DeepSeek Harness, maintained in this repository:
[xiangnan0811/dsh-clinepass](https://github.com/xiangnan0811/dsh-clinepass).

[中文说明](README.zh.md) · [Русский](README.ru.md)

The settings namespace is `dsh-clinebot`, the provider id is `clinebot`, and
the HTTP prefix is `/dsh-clinebot`. Do not install another plugin that also
registers provider id `clinebot` in the same profile. Both would write
`llm-pi-ai.providers.clinebot`.

The package name is `dsh-clinepass`. `private: true` blocks `npm publish`.

## Install from this repository

DeepSeek Harness `0.1.7-rc.2` installs plugins with pnpm. A GitHub spec is enough:

```sh
dsh plugin --profile web add github:xiangnan0811/dsh-clinepass
```

Restart `dsh`. **ClineBot** is in the settings sidebar. The sidebar **Plugins** page also opens it from the `dsh-clinebot` row inside `dsh-clinepass`. Settings → Built-in plugins is a read-only inventory and no longer hosts this card.

`npm publish` is not required for the DSH plugin market in the sidebar
(`dsh-market`). That market installs with `dsh plugin add github:owner/repo`.
Publishing to npm is only needed for `dsh plugin add <npm-name>`.

This repository is not a GitHub fork. The market lists it after the topic
`dsh-plugin` is on the About page and `cordis.patch.yml` is in the root.
The index runs around 06:00 and still checks that the repo is a DSH plugin.
A submission issue on [2BingLing/dsh-market](https://github.com/2BingLing/dsh-market)
is the other way in.

Do not export `CLINEBOT_API_KEY` in the shell that starts `dsh`. DSH treats
that variable as read-only and rejects a key saved from the settings page.
Save the key in the plugin card. The browser calls
`http://127.0.0.1:<port>/dsh-clinebot/...` on the local DSH server. The plugin
then calls `baseUrl`, which should be `https://api.cline.bot/api/v1`.

## What the settings card does

- Saves the API address and the ClinePass key.
- Shows 5-hour, weekly, and monthly usage from
  `GET /users/me/plan/usage-limits`, with the percent, a meter, and a reset
  date. Account, plan, and last fetch time are separate rows.
- Registers the selected models into DSH. The output cap is not sent as
  `max_tokens`. The request budget is. The default budget is 65536.
- Lets you pick the smoke-test model. Muse Spark uses
  `reasoning_effort: low` and a 1024-token cap so the short reply is not
  swallowed by reasoning.
- Counts only plugin smoke tests and `/cline test` in the session table.

`GET /api/v1/models` on api.cline.bot returns 404. With a key, discovery reads
`GET /users/me/plan`. `cline-pass/deepseek-v4.1-flash` is a normal ClinePass
id. The default smoke model is that id.

Tested host: DeepSeek Harness `0.1.7-rc.2`. The settings sidebar entry is `settings.section` `dsh-clinebot`. The same page is `plugins.row.config` at `dsh-clinepass#dsh-clinebot`.

## Configuration

```yaml
dsh-clinebot:
  enabled: true
  baseUrl: https://api.cline.bot/api/v1
  apiKeyEnv: CLINEBOT_API_KEY
  defaultModel: cline-pass/deepseek-v4.1-flash
  selectionKind: all-except-disabled
  timeoutMs: 15000
  smokeTimeoutMs: 25000
```

| Field | Default | Role |
| --- | --- | --- |
| `baseUrl` | `https://api.cline.bot/api/v1` | API the plugin calls |
| `apiKeyEnv` | `CLINEBOT_API_KEY` | Credential name |
| `defaultModel` | `cline-pass/deepseek-v4.1-flash` | Smoke test and provider default |
| `selectionKind` | `all-except-disabled` | Empty `disabledModels` registers the catalog |
| `timeoutMs` | `15000` | Usage and plan requests |
| `smokeTimeoutMs` | `25000` | Smoke test |

Checked models are what Settings → Models lists. Per-model overrides for
context, output cap, request budget, input, and reasoning are edited on the
card. Empty override fields inherit the catalog.

## Develop

```sh
npm test
```

`npm test` rebuilds `lib/client.js` and runs the suite. `npm pack` builds a
local tarball. Install that tarball with `dsh plugin add ./<file>.tgz` when
you are not installing from GitHub.

## License

MIT. The copyright notice is in [LICENSE](LICENSE).
