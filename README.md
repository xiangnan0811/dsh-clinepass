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

Version `0.8.0` requires DeepSeek Harness `^0.2.1-rc.2`.

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
  uncached input, output, cache-read and cache-write rates per million tokens. USD is the default unit; changing currency
  performs no conversion. Missing rates or incomplete usage prevent calculation.
  The four categories are priced separately; reasoning is already within output.
  Cache writes create prompt cache. Old two-rate settings need explicit cache
  prices. Missing counters remain unknown, including in native session replay.
  Estimates use current saved rates and are not historical bills.
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

As checked on 2026-10-26, Cline exposes public model lists at
[`/ai/cline/recommended-models`](https://api.cline.bot/api/v1/ai/cline/recommended-models)
and [`/ai/cline/models`](https://api.cline.bot/api/v1/ai/cline/models).
The first lists ClinePass IDs; the second supplies API names and reference
capabilities. `/models` now works and serves as the ID-only fallback.
Authenticated **Sync plan models** still reads `/users/me/plan` separately.
The default smoke model remains `cline-pass/deepseek-v4.1-flash`.

The current default selection includes GLM 5.3 / 5.3 Flash, Kimi K3.1 Pro,
MiniMax M3.1 Flash, MiMo V2.6 Flash / Pro, Qwen 3.8 Max, DeepSeek V4.1 Flash
(stable and 1017), DeepSeek V4 Pro, and Muse Spark 1.3 Contributor. Older
generations remain editable but are no longer implicitly enabled. Explicit
selections and a saved legacy default remain usable; IDs, budgets and upstream
pins are not rewritten. In `all-except-disabled` mode, `explicitModels` also
retains legacy opt-ins. **Enable all** includes old generations; **Use current
defaults** clears opt-ins and disabled IDs, retaining a saved default model.

Under **Custom models → Get models from API**, search and select a model to
fill its exact ID, display name and published context/output/image parameters.
Only the configured API receives the active credential. Ordinary API IDs are
shown separately because they do not use the ClinePass subscription lane.
For an already listed Pass ID, a unique exact vendor-model suffix can supply
reference parameters; ambiguous matches stay unknown and never create a Pass ID.
Built-in models can be enabled directly. Saving a custom model also selects it,
including from an explicit empty selection, and preserves it across account changes.
The verified-plan filter still applies and is explained beside the selection.
Manual entry needs only an ID; name and advanced parameters are optional. Blank
parameters inherit batch/default settings; unknown limits remain unknown. The
prefilled request budget is at most 65536 and is capped by any published lower
context/output ceiling. Reasoning levels are never inferred from a generic
reasoning flag. Discovery makes no inference calls and does not verify plan access.

Version `0.8.0` targets DeepSeek Harness `0.2.1-rc.2` (`next` on 2026-10-19). Earlier `0.1.7-rc.2` validation applies to previous versions. The settings sidebar entry is `settings.section` `dsh-clinebot`. The same page is `plugins.row.config` at `dsh-clinepass#dsh-clinebot`.

On hosts providing `connection.requestRejection`, all `/dsh-clinebot/*` routes
require DSH authentication, including reads and update checks. Open the URL
printed by `dsh web` to sign in. Unauthenticated requests return 401; host or
origin rejection returns 403. Settings writes also retain their origin checks.
Writes require Origin or Referer. Fetch Metadata alone is not authorization;
forwarded hosts are trusted only from a loopback proxy, and DSH authentication
is still required.

Version `0.8.0` has also passed isolated DSH `0.2.1-rc.3` Web and direct
headless fixture checks. Headless disables the managed credentials service by
default; this plugin requires that service. In the headless profile patch, enable
`{id: credentials, disabled: false}` and set `agent-default-model` to provider
`clinebot` and an enabled model. Launch-environment keys still work. The optional
upstream TUI settings integration is deferred because the official host has no
verified `tuiSettingsSections` consumer.

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
| `selectionKind` | `all-except-disabled` | Enables current models plus explicit legacy opt-ins, excluding `disabledModels`; explicit mode registers only `explicitModels` |
| `planFilterEnabled` | `false` | Intersects the saved manual selection with a successfully read plan; missing plan data does not clear the selection |
| `batchModelDefaults` | inherit | Context, output capability and request budget defaults, below individual model overrides |
| `proxyEnabled` | `false` | Authenticated loopback proxy with account retries before the first model output |
| `accountMode` | `least-used` | Lowest measured quota first, or `round-robin`; unknown quota stays unknown |
| `modelRoutes` | `[]` | Explicit model/account routes, ahead of manual pin, session binding and strategy |
| `upstreamPins` | `[]` | Strict per-model ClinePass backend provider pins; separate from account selection |
| `historyImageOffload` | `false` | Ask the native host to log and replay historical image offload decisions |
| `historyImagesToKeep` | `2` | Historical retained images; the latest user/tool input is retained |
| `timeoutMs` | `15000` | Usage and plan requests |
| `smokeTimeoutMs` | `25000` | Smoke test |
| `webSearchEnabled` | `false` | Register native search provider `clinebot` without changing global selection |
| `searchTimeoutMs` | `15000` | Search deadline, including the response body |
| `statsRetentionDays` | `95` | Minute aggregates retained for 0–3650 days; 0 is unlimited; daily totals remain |
| `quotaForecastEnabled` | `false` | Estimate quota pace from comparable samples at least a minute apart |
| `priceAutoSync` | `false` | Refresh public reference prices on model synchronization, at most once per six hours |
| `priceBindings` | `[]` | Explicit `{model, provider, sourceModel}` reference-price choices; manual `costRates` take priority |
| `dailyBudget`, `monthlyBudget` | `0` | Optional UTC day/month estimated-cost limits in `costCurrency`; 0 disables each limit |

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

Contradictory token counts are excluded from measurements and cost estimates;
the model reply and request outcome remain intact. Session projection caches are
rebuilt from the existing log under these rules; missing historical wire data is
not reconstructed.

To keep a model on one backend, use the dedicated **Pin upstream provider** section
in settings (also available in the model editor). Select a model and set the provider
to an ID such as `deepseek`, then save the upstream pin. Leave it blank or choose
**Use automatic routing** to clear it. If the selected model is removed, choose a
model again before saving; the form does not silently select another model.
For configuration files, use:

```yaml
upstreamPins:
  - model: cline-pass/deepseek-v4.1-flash-1017
    provider: deepseek
```

Version 0.7.2 adds **DeepSeek V4.1 Flash 1017** as a separate model. Existing model
IDs, defaults, session selections and pins are not migrated. The dated ID appears
in [Cline's recommended catalog](https://api.cline.bot/api/v1/ai/cline/recommended-models)
(2026-10-25). Vision, reasoning, 1M context and 384K output capabilities follow
[DeepSeek's vendor documentation](https://api-docs.deepseek.com/quick_start/pricing/),
not measured ClinePass limits. The default request budget remains 65536.

Stable and dated IDs can use different gateway routes. Enable the dated model,
save a separate `deepseek` pin for its full ID, then explicitly select it in the
streaming probe. Changing the smoke-test default does not switch existing sessions;
select the snapshot in each session when ready. Verified-plan filtering can hide
it if the account's discovered plan list omits it. Gateway enforcement still needs
account-specific verification; no automatic model rewrite or probe is performed.

Probes and request history expose response routing details when reported: response
ID, returned model, canonical gateway model, resolved provider and the DeepSeek
metadata fingerprint. These bounded identifiers aid diagnosis but never replace
the final-provider check or make an anonymous private provider match `deepseek`.
Full planning text, headers and content are excluded; old records are not inferred.
Smoke statistics retain the requested model; the returned model is a separate field.

Pins apply while this plugin is enabled to native direct/proxy chat, auxiliary
model calls, streaming probes and smoke tests. Direct calls freeze the pin when
prepared; proxy calls use the configuration captured at proxy ingress. Account
retries retain the same provider restriction. No provider fallback is requested.
The request carries both `provider.only` (OpenRouter) and
`providerOptions.gateway.only` (gateway planner); `zai`/`z-ai` use each router's
spelling. Unknown models/providers are not automatically tested or discovered.

For `cline-pass/deepseek-v4.1-flash-1017` pinned to `deepseek`, the plugin also
adds `vision` and `implicit-caching` to `providerOptions.gateway.has`, retaining
additional caller capability filters without duplicates. Missing, null or empty
filters receive both tags. This keeps the ClinePass model ID and credential;
no model selection or saved configuration is rewritten. On 2026-10-26, `only`
alone reached an anonymous private candidate, while this combination reached
DeepSeek. The stable ID still reached the private route with both tags, so the
workaround applies only to the dated ID and this pin. Other pins and automatic
routing are unchanged. Extra capability conditions can leave no matching candidate.

Use **Run streaming probe** to compare the requested and reported provider; it
makes a real request. Only structured `finalProvider` or direct `provider` metadata
counts as confirmation. A different provider fails with `UPSTREAM_PIN_MISMATCH`;
missing metadata fails with `UPSTREAM_PIN_UNVERIFIED`. Some accounts ignore routing
restrictions (including private routes); HTTP 200 alone does not prove a pin.
Metadata can arrive after output has begun: a late failure ends the call without
replay and cannot undo output or charges already incurred. Pinning cannot ensure
cache hits or override the service's routing policy. Small text requests on one
live ClinePass account verified the dated-model combination on 2026-10-26;
this does not verify images, long context, quota accounting or future routing.
Local fixtures exercise the installed DSH adapter and failure paths.
The wire protocol follows the public findings in
[cline-pass-switcher](https://github.com/munmunjaklin458-afk/cline-pass-switcher/tree/02538a3137a08948a94f26f17dd4aeff8c029ed1)
and [dsh-cline-pass](https://github.com/yhshzh/dsh-cline-pass/tree/008fa828c8c2c862d909e940372b72285e3c8ba4).

Ordinary chat shows the last response's reported upstream in the composer.
Expand it for this session's retained requests; profile statistics show the last
100 requests, including failures, automatic routing and individual account attempts.
Each record persists the requested provider, whether a restriction was attached,
the reported provider and its observation: matched this time, mismatch, unverified,
not attached, automatic, or unrecorded. Attaching a restriction does not prove
delivery; a matching response does not prove future enforcement. The model badge
only describes the requested provider. Keys and chat content are not recorded.
Session records refresh on settlement, opening details or manual refresh, and are
filtered strictly to this session within those 100 profile requests. Missing
evidence never falls back to another session or current settings. CSV remains an
aggregate export; per-request routing is available in the stats API's `recent`.

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

Usage patterns add P50/P95 histogram bounds, a weekday/hour heatmap using the
browser's current UTC offset, minute ranges (end exclusive), failure filters and
JSON export. Old daily aggregates remain intact; they acquire neither invented
minute detail nor percentile samples. Minute/failure filters include retained
detail only. Account history keeps the last 200 routing, cooldown, recovery and
selection events independently of statistics reset. Additional accounts can be
renamed or have their saved key cleared while retaining their entry and pins;
environment keys must be removed at their source.

Under **Usage & rates**, public USD prices from `models.dev` can be synchronized
manually and bound to an explicit provider/model. The profile-local cache is
`clinepass/prices.json`; failed refreshes retain the last successful catalog and
show an error. The timestamp stays visible. No binding is selected automatically,
missing cache prices remain unknown, and other currencies use manual rates.
Manual rows override public references, including incomplete manual rows.

Daily/monthly budgets check recorded profile usage at current rates before a new
native, proxy, smoke or probe call. Missing measurements, rates or usable storage
block calls only when a limit is enabled. In-flight calls can exceed a limit;
these estimates are not bills or subscription quotas. Resetting statistics also
resets budget usage. Changing currency reinterprets manual rates and limits
without conversion. `/cline cost` and `/cline budget` show the same estimates.
Optional quota pace estimates require actual comparable samples from the same
account/window and clear on errors, resets or account changes; they do not route
requests.

The [official Cline code](https://github.com/cline/cline/blob/40c5d99031fe1128189c5b52e40638d2b7787754/sdk/packages/llms/src/providers/builtins.ts)
declares provider-executed search for ClinePass models. This does not establish
a standalone `/alpha/web-search` endpoint for DSH. That adapter remains off by
default under **ClinePass standalone search · experimental**, with live channel
access unverified. It uses the active account and `baseUrl`; enable it only for
a gateway confirmed to support that endpoint, then select `clinebot` in the host's web
search settings. Existing search/fetch providers are preserved. Each API request
asks for at most 10 results (5 if no bound was supplied). Genuine empty results
are distinct from HTTP, credential, malformed-response, timeout and cancellation
errors. It never falls back to another website or changes the account pin.
Disabling or unloading unregisters the provider and cancels pending searches.
Isolated next and local mock acceptance have passed; live channel availability
remains unverified.

DeepSeek provides independent Search and Fetch APIs. Configure the official
provider and a DeepSeek key in the host web settings. Each costs CNY 5 per
1,000 successful requests with results; failed, empty or timed-out requests
are not charged. Server-side tool calls start billing at 00:00 Beijing time on
2026-11-01. These costs are separate from ClinePass token estimates. See the
[official guide](https://api-docs.deepseek.com/zh-cn/guides/search/).

On DSH next `0.2.1-rc.2`, actual plugin disable cancels pending calls, closes the
proxy, removes its temporary credential and restores the built-in model adapter.
Saved model/account configuration remains available. Re-enabling and hot updates
automatically synchronize the active adapter and credential; settings and
persisted statistics are retained. These paths have passed isolated CLI Web
acceptance; Desktop remains unverified.

Settings shows only the running plugin version and repository link. Updates
run from **Plugins → ClinePass updates**. GitHub
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
