# Changelog

## Unreleased

Add opt-in native ClinePass web search through `ctx.web`, with the active account,
bounded sources, response-body deadlines, cancellation and lifecycle cleanup.
Preserve the host's search/fetch choices. HTTP failures, missing credentials,
malformed responses and cancellation stay distinguishable from real zero results.
Fix provider registration after a settings save whose volatile event arrives
before the plugin's local snapshot is updated.

Add sidebar quota and a native detail modal containing quota, statistics and full
configuration, plus reset countdowns and separate display switches. Project
current-session ClinePass reply/attempt usage through the host's replayable session
API, excluding other providers and diagnostics. Estimate costs only from explicit
per-model rates; unknown measurements remain unknown.

Add cancellable native streaming probes, first-output and total latency, and
`/cline account`, `/cline use <name|auto>` and `/cline ping <model|default>`.
Keep bare ping as an API health check. Mark probes separately in profile metrics.
Prevent the native SDK's synthesized zero usage from entering session settlements.
Display-only quota reads no longer populate routing measurements. Merge preference
patches inside the write queue so concurrent saves preserve other fields.

Persist profile statistics with daily/model/account aggregates, measured-sample
counts, source and retry-attempt attribution, UTC filters, CSV export and reset.
Use the host's profile directory, atomic replacement and cross-process file lock.
Corrupt files stay untouched until reset archives them; storage failures retain
new measurements in memory while model calls continue. Add `/cline stats` and
`/cline telemetry`.

Observe raw usage through the native protocol's public event callback so a
missing provider usage report stays unknown. Keep cache and uncached input
disjoint and reasoning within output. Preserve captured transport metadata when
settings change, preventing proxy double counting and unwanted account rotation.
Remove invented smoke token counts and reject empty or embedded-error responses.

Add an authenticated loopback proxy with session binding, model/account routes,
measured-quota and round-robin strategies, cooldown recovery, bounded requests
and retries only before model output. Disabling it restores direct transport
and original native retry/timeout controls. Proxy mode is off by default.

Apply per-model effort defaults through a ClinePass-only native adapter before
request configuration freezes. Keep explicit caller choices and native model
parameter edits. Optional historical image offload uses the host's logged
decisions and replay, retaining original attachments. Image limits and the full
JSON request budget remain separate. This candidate requires next DSH peers
(`^0.2.1-rc.2`); old-host validation remains historical.

Add verified-plan filtering, visible/plan/empty selection shortcuts, batch model
defaults, capability-only restoration, custom model management and preservation
of native Models edits across hidden selections and restarts. A plan response
without model membership cannot verify an empty plan. Manual sync discards stale
results after account or configuration changes.
Missing quota percentages and subscription prices remain unknown; malformed
quota responses fail instead of appearing as valid zero usage.

Add independent key validation and on-demand local key discovery. Discovery
returns masked values and expiring handles; account imports keep secrets on the
server and retain the settings-before-secret ordering.

Client requests now have cancellation and deadlines covering the response body.
Update-check errors and disabled checks are distinct from being up to date.
Use current next theme tokens, handle volatile schema values at internal policy
boundaries, and check static names and generated-bundle drift during tests.

Target DeepSeek Harness `0.2.1-rc.2` (`next` on 2026-10-19) in the host
dependency ranges. Stop requesting the removed standalone client slots bundle;
the client continues to inject the host's `slots` service.

All plugin HTTP routes now delegate authentication to the host's
`connection.requestRejection` when available, including reads and update
checks. Unauthenticated requests receive 401 and host/origin rejections receive
403. Settings writes keep their existing origin checks. Older hosts without
that authentication method keep their previous access behavior.

## 0.5.7

The add-account label, credential name, and key stay hidden until Add
account is chosen. Cancel clears those fields and closes the form without
saving. A failed save stays open and keeps its message.

## 0.5.6

The settings card masks the account email until Show email is chosen. The
choice is not saved, so the next visit starts masked. `/cline` stays masked.
A plan payload with `canceledAt` or `cancelAt` adds that timestamp, and
`cancelAtPeriodEnd` adds a separate line. A plan name containing `[Internal]`
is not used as the label. When more than one key is saved, the card lists the
other accounts' 5-hour, weekly, and monthly percents. That list does not fill
the cache used to choose the next account after HTTP 429 or 402. The session
table counts finished ClinePass streams as well as smoke tests and `/cline
test`. It keeps the model name and, when a stream chunk already includes one,
the upstream name. It does not keep prompt text.

## 0.5.5

Adding an account stores the pool name before the secret. If the secret is not
stored, that new name is removed. If removing it also fails, the response says
the name stayed in the pool and the key was not saved. Replacing the active
key, switching accounts, rotating after HTTP 429 or 402, or changing the API
address or primary credential name drops the previous plan model list until
the next successful plan read. Replacing the active key also removes the saved
plan cache, so that list is not restored from disk. A plan read that was
already running cannot put that list back. A custom model the last plan read
did not name stays. Usage lookups are cached separately for each API address
and credential. A model cache written for another account or address is not
loaded as the current plan.

## 0.5.4

`/cline` returns a DeepSeek Harness command result, `{ kind, text }`, as plain
text. The accounts card can save another `CLINEBOT_API_KEY_*` credential and
remove it from the pool. The primary key stays in the key section, and adding
an account does not call the model API. A later DSH turn switches to the next
saved account when ClinePass rate-limits or exhausts the account: the harness
finish codes `RATE_LIMIT` and `QUOTA`, HTTP status 429 or 402, or those status
numbers in the error text. A sentence that only mentions quota or credit does
not switch. Switching happens at most once every 30 seconds, and only to a
saved account. The session table still counts only smoke tests and
`/cline test`.

## 0.5.3

Muse Spark 1.3 Contributor registers its supported reasoning efforts
(`minimal`, `low`, `medium`, `high`, `xhigh`) on the DSH model, so the model
picker can select one. `max` stays off that list. Other catalog models that
already name an effort list are registered the same way. Choosing "no
reasoning control" for one model still removes its picker.

## 0.5.2

Model rows for Muse Spark 1.3 Contributor, Kimi K2.6, Kimi K2.7 Code, and the
Qwen 3.7/3.8 Max and Plus rows now show the context, output cap, and input
type published by OpenRouter on 2026-09-25. Muse Spark also lists Meta's
Contributor reasoning efforts, without `max`. Override fields accept `128k`
and `1M`. A value that cannot be read is reported beside Save override, and
that save no longer posts its result at the top of the settings page.

## 0.5.1

DeepSeek Harness 0.1.7-rc.2 no longer provides `settingsScope`. The web client
waits for every injected service, so that name left the page on
`dsh-clinepass: pending (waiting for service: settingsScope)`. The client now
injects `configForms`. The settings sidebar entry is `settings.section`
`dsh-clinebot`. The same page is also `plugins.row.config` at
`dsh-clinepass#dsh-clinebot`. Built-in plugins in Settings stays a read-only
inventory.

## 0.5.0

First release of `dsh-clinepass` in this repository.

Connects DeepSeek Harness to ClinePass: model list, API key, smoke test, and
5-hour, weekly, and monthly usage. The settings namespace is `dsh-clinebot`.
The provider id is `clinebot`. Automatic npm updates are off.
