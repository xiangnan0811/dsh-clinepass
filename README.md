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

DeepSeek Harness installs plugins with pnpm. A GitHub spec is enough:

```sh
dsh plugin --profile web add github:xiangnan0811/dsh-clinepass
```

Restart `dsh`. **ClineBot** is in the settings sidebar. The sidebar **Plugins** page also opens it from the `dsh-clinebot` row inside `dsh-clinepass`. Settings → Built-in plugins is a read-only inventory and no longer hosts this card.

`npm publish` is not required for the DSH plugin market in the sidebar
(`dsh-market`). That market installs with `dsh plugin --profile web add github:owner/repo`.
Publishing to npm is only needed for `dsh plugin --profile web add <npm-name>`.

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
  date. Account, plan, and last fetch time are separate rows. The account
  email is masked until you choose Show email. A cancellation timestamp from the plan is an extra row.
  When more than one key is saved, the other accounts are listed with their
  three percents. That list does not change which account is chosen after a
  rate limit.
- Registers the selected models into DSH. The output cap is not sent as
  `max_tokens`. The request budget is. The default budget is 65536.
- Adds selection shortcuts, search, optional verified-plan filtering, batch
  defaults and custom model forms. An explicit empty selection registers none.
  Individual overrides take precedence over batch defaults. Restoring model
  capabilities leaves the request budget unchanged; it has its own reset.
- Validates an entered key without saving, or scans known Cline CLI, VS Code,
  Cursor files and Cline environment variables when requested. Discovery shows
  masked values; five-minute server handles import selected keys into the account
  pool. Encrypted editor secrets may not be discoverable.
- Lets you pick the smoke-test model. Muse Spark uses
  `reasoning_effort: low` and a 1024-token cap so the short reply is not
  swallowed by reasoning.
- Saves request statistics per DSH profile: results, attempts, latency and
  reported token counters. Filter by UTC date, model or account, export CSV, or
  reset statistics from the settings card. `/cline stats` and `/cline telemetry`
  show the same profile totals. Prompts and credential values are never stored.
- A sidebar quota button opens the host's detail modal with quotas, statistics
  and full configuration, including a narrow-screen entry. Reset countdowns keep
  missing times and usage unknown. Sidebar and composer displays default on and
  have separate switches.
- Composer usage comes from the current session's ClinePass reply/attempt
  projection, excluding other providers. Cost estimates require explicit per-model
  input/output rates per million tokens. USD is the default unit; changing currency
  performs no conversion. Missing rates or incomplete usage prevent calculation.
  Cached prompt tokens use the input rate; reasoning is already within output.
- Streaming probes allow cancellation, request at most 1024 output tokens and
  expire after 30 seconds. They measure first text/reasoning/tool output and total
  duration, and count in profile statistics rather than session reply usage.
  `/cline ping <model>` or `/cline ping default` runs a probe; bare `/cline ping`
  retains API health checks. `/cline account` lists accounts, `/cline use <name>`
  pins one, and `/cline use auto` restores automatic routing.
- Saves extra `CLINEBOT_API_KEY_*` accounts on the same card. The pool name is
  saved before the secret. If the secret is not stored, that new name is
  removed. A later DSH turn that gets HTTP 429 or 402 switches to the next
  saved account. Switching, that rotation, a new API address, a new primary
  credential name, or replacing the active key drops the previous plan model
  list until the next successful plan read. Replacing the active key also
  removes the saved plan cache, so the old list is not restored from disk.
  A plan read that has already started cannot put that list back.
  `/cline` prints plain text.

`GET /api/v1/models` on api.cline.bot returns 404. With a key, discovery reads
`GET /users/me/plan`. `cline-pass/deepseek-v4.1-flash` is a normal ClinePass
id. The default smoke model is that id.

This candidate targets DeepSeek Harness `0.2.1-rc.2` (`next` on 2026-10-19). Earlier `0.1.7-rc.2` validation applies to previous versions. The settings sidebar entry is `settings.section` `dsh-clinebot`. The same page is `plugins.row.config` at `dsh-clinepass#dsh-clinebot`.

On hosts providing `connection.requestRejection`, all `/dsh-clinebot/*` routes
require DSH authentication, including reads and update checks. Open the URL
printed by `dsh web` to sign in. Unauthenticated requests return 401; host or
origin rejection returns 403. Settings writes also retain their origin checks.

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
| `planFilterEnabled` | `false` | Intersects the saved manual selection with a successfully read plan; missing plan data does not clear the selection |
| `batchModelDefaults` | inherit | Context, output capability and request budget defaults, below individual model overrides |
| `proxyEnabled` | `false` | Authenticated loopback proxy with account retries before the first model output |
| `accountMode` | `least-used` | Lowest measured quota first, or `round-robin`; unknown quota stays unknown |
| `modelRoutes` | `[]` | Explicit model/account routes, ahead of manual pin, session binding and strategy |
| `historyImageOffload` | `false` | Ask the native host to log and replay historical image offload decisions |
| `historyImagesToKeep` | `2` | Historical retained images; the latest user/tool input is retained |
| `timeoutMs` | `15000` | Usage and plan requests |
| `smokeTimeoutMs` | `25000` | Smoke test |
| `webSearchEnabled` | `false` | Register native search provider `clinebot` without changing global selection |
| `searchTimeoutMs` | `15000` | Search deadline, including the response body |

Checked models are what Settings → Models lists. Per-model overrides for
context, output cap, request budget, input, and reasoning are edited on the
card. Empty override fields inherit batch defaults, then the catalog. Native
Models edits are captured in `hostModelOverrides` and survive hiding models and
restarts. An explicit edit or restore on this card clears the corresponding
captured field. Per-model default effort is applied before the native request
freezes; explicit caller choices, including Off, take precedence. On the next
LLM service, only `clinebot` transfers to the ClinePass native adapter so statistics
can observe actual provider usage. Its model parameters remain editable in Settings
→ Models. The adapter stays registered when proxy mode returns to direct mode.

Proxy credentials are ephemeral references in DSH credentials. Disabling proxy
mode restores the upstream address, account reference and original retry/timeout
controls. Proxy requests use their own retry policy; direct requests retain the
existing next-turn rotation. Connect, first-output and JSON-body deadlines default
to 15 seconds, stream idle to 30 seconds, total to 300 seconds, and the complete
request body to 32 MiB. Edit these under Proxy and account routing. Native image
size limits are separate; historical offload requires the host image-offload
plugin and keeps original session attachments. See the
[sync plan](docs/maintenance/UPSTREAM_SYNC_PLAN.md) for remaining work.

Statistics use `<current profile directory>/clinepass/stats.json`, with atomic
replacement and the host's file lock for concurrent writers. Daily/model/account
aggregates persist; only the latest 100 individual records are retained. A request
retried by the proxy counts once, with each upstream attempt recorded separately.
Request/token aggregates belong to the final account; failed attempts retain their
own account aggregates. CSV `scope=request|attempt` distinguishes those rows: do
not add both scopes together as logical requests.
Missing usage is unknown, cache input is disjoint from uncached input, and reasoning
is already included in output. Counts show measured/all request samples. Latencies
are mean completion and first-output times; non-streaming smoke tests have no TTFT.
These are new measurements, not reconstructed history or billing estimates.
Storage errors remain visible while model calls continue; unsaved measurements
remain in memory. Reset clears the entire profile's statistics, including filtered
dates, and archives a corrupt file before replacing it. Accounts and models remain.

Native web search uses the active account and `POST /alpha/web-search` under
`baseUrl`. Enable it in the plugin card, then select `clinebot` in the host's web
search settings. Existing search/fetch providers are preserved. Each API request
asks for at most 10 results (5 if no bound was supplied). Genuine empty results
are distinct from HTTP, credential, malformed-response, timeout and cancellation
errors. It never falls back to another website or changes the account pin.
Disabling or unloading unregisters the provider and cancels pending searches.
Isolated next and local mock acceptance have passed; live channel availability
remains unverified.

On DSH next `0.2.1-rc.2`, actual plugin disable cancels pending calls, closes the
proxy and removes its temporary credential. Automatic hand-back to the built-in
model adapter currently fails because the host rejects a settings write during
teardown. Saved model/account configuration remains available, and re-enabling
restores calls. A hot update can also leave the old proxy credential reference:
if calls report `MISSING_CREDENTIAL`, choose Diagnostics → Sync again or restart
DSH. Both automatic lifecycle paths remain open in the synchronization plan.

Updates run from **Plugins → ClinePass updates**. The settings shortcut opens
this bundle's detail page; return to the Plugins list to select that tab. GitHub
targets always use this repository and a checked commit. Local directories,
archives and registry installs require an explicit target; local updates accept
an absolute `.tgz`/`.tar.gz` produced by `npm pack`. The host inspects and installs
the target, owns the profile lock and cancellation, and reports failure or a
required restart. Accounts, model settings and statistics are retained.

Running and installed versions are tracked separately, including same-version
updates. A matching archive path/version cannot prove matching contents; an
unrecorded Git commit remains unverified. Follow the host's restart/refresh prompt
and check again. There is no background installation. Archive checks read metadata
without extracting files (16 MiB compressed, 64 MiB total entries, 256 KiB manifest).
`GET /dsh-clinebot/update` checks status; installation uses the native dialog,
and the former HTTP installation action returns 405.

## Develop

```sh
npm run build:client
npm test
```

`npm test` checks that `lib/client.js` matches its source without rewriting it,
runs the undefined-name check, then the suite. `npm pack` builds a
local tarball. Install that tarball with `dsh plugin --profile web add ./<file>.tgz` when
you are not installing from GitHub.

## License

MIT. The copyright notice is in [LICENSE](LICENSE).
