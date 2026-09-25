# Changelog

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
