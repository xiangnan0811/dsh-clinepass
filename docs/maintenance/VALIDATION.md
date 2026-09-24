# Validation record

Latest package: `dsh-clinepass@0.5.0`. Earlier notes below used the working name `dsh-clinebot-local` through `0.4.0-candidate.17`. The request budget described below as 8192 was raised to 65536 in candidate.8. The record through "Side effect to know about" is candidate.3 (`0fdb585`). Candidate.4 is `7cd2244`. Candidate.5 is the trial repair. Candidate.6 corrects the V4.1 Flash channel claim.

| Item | Value |
| --- | --- |
| Start SHA | `14314f83dff958449f9277d0747ec2136eaac112` (tag `v0.3.21`, `upstream/main`, `origin/main`) |
| Host | DeepSeek Harness `0.1.5-rc.2`, binary `/home/murray/.nvm/versions/node/v24.18.0/bin/dsh` |
| Node | `v24.18.0`, npm `11.16.0` |
| Package identity | `dsh-clinepass` from 0.5.0. Earlier trials used `dsh-clinebot-local`. npm publish was not run. |
| Real ClinePass calls | Not made. The isolated profile used `CLINEBOT_API_KEY=fake-accept-key` and `http://127.0.0.1:38889`. |

## Findings

| Clue | Result | Evidence |
| --- | --- | --- |
| Settings page reads `settingsScope` without inject | Confirmed, fixed | `src/client/entry.js` injects `settingsScope`, `slots`, `locale`. `package.json` depends on `@deepseek-ai/dsh-client-ui-settings`, locale, and slots. Cordis test throws `cannot get property "settingsScope" without inject` without that inject and binds the namespace with it. |
| `configForms` wait breaks web boot | Confirmed for 0.1.5-rc.2: the string is absent from the installed host. Not reintroduced. | `rg configForms` under the installed `@deepseek-ai` tree. The built client does not contain `configForms`. |
| Plan parser deletes decimal points | Confirmed on `14314f83`, fixed | `test/registry.test.js` runs the old function from that blob and the current `parsePlanIncludedModels`. |
| Uniform 200000/8192 gateway cap | Not supported by Cline's model table or the DeepSeek API docs fetched 2026-09-23. Removed as a hard claim. | `lib/catalog.js` |
| `getAllModels` ignores same-id updates | Confirmed in the old append-only loop. Current assembly always applies the maintained catalog, then user overrides. | `lib/model-registry.js` |
| Discovery only notices new ids | Confirmed. Discovery now stores ids and unknown names, and a newer user write skips the stale apply. | `test/provider-sync.test.js` |
| Empty selection registers every model | Confirmed (`models.length ? models : all`). Explicit `[]` now removes provider `clinebot` through the real settings service. | `test/provider-sync.test.js` |
| Full provider replace drops user fields | Confirmed. Preserved keys such as `headers` and `retryPolicy` are copied back. Other providers are untouched. | same test |
| `reasoningEfforts` / request wire disagree | Confirmed for the old route-level `supportsReasoningEffort: true`. DeepSeek entries now set `thinkingFormat: deepseek` and only `off/low/high/max`. | `test/request-shape.test.js` and the headless capture below |
| Public tree could not rebuild the client | Confirmed at `14314f83` (`src/client` and `scripts/build-client.js` removed). Restored from `1b8764c` and edited. `npm test` rebuilds `lib/client.js`. | `scripts/build-client.js` |

## Capability sources checked on 2026-09-23

Token unit is the model tokenizer token, as stated by the DeepSeek API docs.

DeepSeek-V4.1-Flash, from `https://api-docs.deepseek.com/quick_start/pricing`, `create-chat-completion`, `guides/thinking_mode`, and `guides/vision` (pages dated 2026-09-19):

- Vendor API id is `deepseek-flash`. Legacy ids `deepseek-v4-flash` and `deepseek-v4-flash-vision-exp` are still accepted and served by V4.1-Flash.
- Context 1M, recorded as 1000000. Maximum output 384K, recorded as 393216.
- Image input is supported on the vendor API. V4 Pro is text only.
- `reasoning_effort` values are `none`, `low`, `high`, `max`. `none` disables thinking. Default effort is `high`. `minimal` maps to `low`; `medium` and `xhigh` map to `high`.
- When `max_tokens` is omitted, the vendor default is 8K non-thinking, 64K thinking, and 128K at `max`. This stack cannot omit `max_tokens`: pi-ai uses `options.maxTokens ?? model.maxTokens`. The plugin's request budget defaults to 8192 and is the value written to `max_tokens`. The 393216 cap is not that budget.

Cline's own table `docs/getting-started/clinepass.mdx` on GitHub main lists `cline-pass/deepseek-v4-flash` and does not list `cline-pass/deepseek-v4.1-flash`. It does not publish context, vision, or reasoning parameters. Those channel limits are unverified. The v4.1 slug is in the catalog with `channelListed: false`.

Other listed ClinePass ids use first-party pi-ai catalog rows shipped with DSH 0.1.5-rc.2 where a single vendor row was identified (GLM from `zai.json`, MiMo from `xiaomi.json`, MiniMax-M3 from `minimax.json`, Kimi K3 from `kimi-coding.json`). Kimi K2.6, Kimi K2.7 Code, and the Qwen 3.7/3.8 rows stay unknown rather than reuse 200000/8192. Their reasoning controls stay off until a user override selects `vendor`.

## Commands and results

`npm test` on 2026-09-23: 21 tests, 21 passed. The run rebuilds the client and executes:

- `test/registry.test.js`
- `test/provider-sync.test.js` (real `@deepseek-ai/dsh-settings` `SettingsProvider` and Cordis context)
- `test/settings-guard.test.js` (real Cordis inject guard)
- `test/request-shape.test.js` (installed `@earendil-works/pi-ai` `streamSimple`)
- `test/client-bundle.test.js`

Isolated home: `DSH_HOME=/tmp/dsh-clinebot-accept/home`. Profiles `cbweb` (from the `web` template) and `cbhead` (from the `headless` template). Package installed with `dsh plugin --profile <name> add` of `dsh-clinebot-local-0.4.0-candidate.3.tgz`. Mock server `127.0.0.1:38889`. No request host other than that mock was recorded.

Headless task `Reply with the single word pong and do not use tools.` exited 0 and printed `pong`. The session `POST /api/v1/chat/completions` body contained:

- `model`: `cline-pass/deepseek-v4-flash`
- `max_tokens`: `8192`
- `reasoning_effort`: `high`
- `thinking`: `{ "type": "enabled" }`

A later title call from the harness used `max_tokens: 64` and, because it named no effort, `thinking: { "type": "disabled" }`. That is the current Off/unset pi-ai path, not a second request budget.

Browser: headless Chromium 153 via CDP. Settings → 插件 showed the ClineBot card for `v0.4.0-candidate.3` without the `settingsScope` error. Editing DeepSeek V4 Flash's request budget to 4096 saved, left the output cap at 393216, and the same 4k budget was still on the card after the isolated `dsh` process was killed and started again. Desktop headless width was the browser default. A separate mobile layout pass was not done.

Main profile `~/.dsh/profiles/web` was not modified (`settings.yaml` mtime stayed 2026-09-23 20:55). The main package was not upgraded.

## Not done

- No live ClinePass request, so image input, 1M context, and 384K output on `api.cline.bot` are not measured.
- No image was attached to the headless DSH turn. The image part shape `image_url` / `data:image/png;base64,...` was captured from pi-ai `streamSimple`, which is the serializer DSH uses.
- npm publish identity for a public name is unconfirmed.
- Automatic update remains off.
- Replacing an already installed ClinePass plugin in the interactive profile was not run.

## Side effect to know about

The first isolated boot used the old default cache path `~/.dsh/clinebot-models-cache.json` and overwrote that file with a version-2 test snapshot. The previous contents were not recoverable here. The file was removed afterward so the interactive home does not keep the test snapshot. Later boots write `$DSH_HOME/clinebot-models-cache.json`. The main `settings.yaml` was not rewritten.

## Review follow-up (2026-09-24)

A later read of `0fdb585` found that the registered provider kept the primary `apiKeyEnv` after an account pin, that an omitted DeepSeek effort sent `thinking: disabled`, that `vendor` was offered for models with no effort list and used `max_completion_tokens` for GLM, that unknown context was stored as 262144, that a missing usage window rendered as 0%, and that the first migration replace could cover a concurrent write. `0.4.0-candidate.4` changes those paths. The headless capture in the section above used an explicit `reasoningEffort: high` and does not describe the composer default. The default is now covered by `test/request-shape.test.js`: no reasoning option, no `thinking` field.

## Release blockers

- Choose a public package name. `dsh-clinebot-local` is only the local candidate.
- Measure the ClinePass channel before describing image, context, or reasoning as channel-verified.
- Do not publish while `private` is true. The updater does not install another package from the npm registry.

## Trial repair (2026-09-24, candidate.5)

The isolated profile the trial command started was still on candidate.3. Its settings stored `baseUrl: http://127.0.0.1:38889/api/v1` and `selectionKind: explicit` with only `cline-pass/deepseek-v4-flash`. The shell also exported `CLINEBOT_API_KEY`, which makes DSH reject a settings-page save. `GET http://127.0.0.1:35229/dsh-clinebot/usage` is the local DSH route; the 502 was the plugin calling that stopped mock.

`npm test` after the repair: 26 passed. The same tree was packed as `dsh-clinebot-local-0.4.0-candidate.5.tgz` (44 files, no review prompts or credentials) and installed into `DSH_HOME=/tmp/dsh-clinebot-accept/home` profile `cbweb`. That process was restarted without `CLINEBOT_API_KEY` and without the mock overlay. It listens on `127.0.0.1:35229`.

Checked in headless Chromium 153:

- Plugin card shows `v0.4.0-candidate.5`, API address `https://api.cline.bot/api/v1`, and 已启用 14/14.
- DeepSeek V4.1 Flash badge reads `Cline 官方清单没有这个 ID`. Override menus read 继承目录 / 仅文本 / 文本和图像 / 不发送思考档 / 发送目录中的档位.
- Settings → Models contains all 14 `cline-pass/` ids in the page.
- With no key, `GET /dsh-clinebot/usage` returns 400 `API key not found` and does not call the upstream.
- Opening the card sends `HEAD https://api.cline.bot` with no API key. The card reported the host online. No chat completion and no usage body were sent.
- At 1280px the model row does not overflow. At 390px the host settings sidebar stays open and the plugin column shrinks to about 14px, so that width is not usable.

`~/.dsh/settings.yaml` mtime stayed 2026-09-23 20:55. No `~/.dsh/clinebot-models-cache.json`. An empty `~/.dsh/profiles/cbweb` created by one `dsh plugin --help` without `DSH_HOME` was removed. The main `dsh web` process was not restarted. Public release is still blocked.

## Channel id correction (2026-09-24, candidate.6)

The candidate.5 badge "Cline 官方清单没有这个 ID" treated GitHub `docs/getting-started/clinepass.mdx` as the live catalog. That page, read again on 2026-09-24, still lists `cline-pass/deepseek-v4-flash` and omits `cline-pass/deepseek-v4.1-flash`. A standard ClinePass usage page dated 2026-09-23 records `cline-pass/deepseek-v4.1-flash` with inputs of about 530k–545k tokens and credits 0.0000. That is the official subscription ledger, so the id is a normal ClinePass model. `GET /api/v1/models` is not a catalog source: the plugin documents it as 404, and discovery with a key parses `GET /users/me/plan` feature text. The warning badge is removed. Image input and the 384K output cap are still DeepSeek vendor documentation; the usage rows do not show them.

## Output budget (candidate.8)

Isolated session `64d21354-e2d7-40a2-bb62-6a795fd6303f` used `cline-pass/deepseek-v4.1-flash` with `reasoningEffort: max`. The request header set `maxTokens: 8192` from the model default (`adapterDefaults.maxTokens: true`). The second assistant message ended at `outputTokens: 8192`, `stopReason: length`, turn reason `max-tokens`. The UI total of 10555 output tokens is 2363 plus 8192. The default request budget is now 65536. The 393216 capability is still not sent as `max_tokens`.

## Quota, smoke, and newly seen models (candidate.7)

`GET /users/me/plan/usage-limits` on the isolated profile returned weekly 39% and monthly 19%, matching the Cline usage page. The card previously drew only the 5-hour and weekly windows. Monthly is now shown. The smoke button still posts to local DSH; the server calls `{baseUrl}/chat/completions` and names that URL. A loopback base URL is rejected. GLM 5.3 Flash uses the zai.json row (1M context, 131072 output, text; image stays off). Muse Spark 1.3 Contributor is catalogued with unknown context, vision, and reasoning. A later id that the API returns and the catalog lacks is labeled as present on the API and missing from the catalog.
