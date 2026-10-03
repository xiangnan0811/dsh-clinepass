# Changelog

## Unreleased

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
