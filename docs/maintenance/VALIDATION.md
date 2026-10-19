# Validation record

Latest package: `dsh-clinepass@0.5.7`. The add-account label, credential name, and key stay hidden until Add account is chosen. Cancel clears those fields. A failed save stays open. The 0.5.6 behavior below still applies. 0.5.6 masks the account email on the settings card until Show email is chosen. That choice is not saved, and `/cline` stays masked. A cancellation timestamp is shown when the plan payload includes one. A plan name containing `[Internal]` is not used as the label. When more than one key is saved, the card lists the other accounts' three usage percents without writing the cache that chooses the next account after HTTP 429 or 402. Finished ClinePass streams are counted with smoke tests and `/cline test`. 0.5.5 stores an added account name before its secret, separates usage cache entries by API address and the full credential, and drops the previous plan model list when the account, API address, primary credential name, or active key changes. Replacing the active key deletes the saved plan cache. A plan read that has already started its settings write cannot put that list back. `/cline` returns `{ kind: 'success' | 'error', text }` in plain text. Extra accounts use `CLINEBOT_API_KEY_*`. A DSH turn can switch the next saved account when the finish failure is harness code `RATE_LIMIT` or `QUOTA`, or HTTP 429 or 402; that turn is not added to the session table. The local proxy, upstream context table, and upstream settings-slot registration were not adopted. Earlier notes below used the working name `dsh-clinebot-local` through `0.4.0-candidate.17`. The request budget described below as 8192 was raised to 65536 in candidate.8. The record through "Side effect to know about" is candidate.3 (`0fdb585`). Candidate.4 is `7cd2244`. Candidate.5 is the trial repair. Candidate.6 corrects the V4.1 Flash channel claim.

## Native update candidate (2026-10-19)

Above `80c38e0`, P7 adds update target checks and a `plugins.tab` contribution.
The public owner `install(target)` opens the host's existing installer; it owns
`inspect`/`installBundle`/`cancelInstall`/`waitForInstall`, locking, rollback and
application feedback. The plugin never spawns its own package manager. Target
preview reads only source and package identity; it does not duplicate the native
installation inspection or change a dependency by HTTP POST.

- `npm test`: 131 passed, client 187247 bytes. All 26 production HTTP routes
  retain host authentication. New checks cover GitHub commit pinning, source
  recognition/redaction, explicit local targets, malformed/wrong/oversized/link
  archive manifests, no extraction, success-cache races, source changes during
  checks, missing manager/profile data, response-body deadlines and cancellation.
- Native acceptance uses only project-local `DSH_HOME`, fake credentials, a local
  mock and DSH `0.2.1-rc.2` CLI Web. Disposable archives provide new versions,
  a same-version code marker, an intentional apply exception and a stalled local
  dependency. Their fixture versions are not repository releases; the repository
  remains `0.5.7` and private.
- Checking the real repository pinned `e10684b8711d577cd769b0cb0c2ce6a87f848162`.
  Its [manifest](https://github.com/xiangnan0811/dsh-clinepass/blob/e10684b8711d577cd769b0cb0c2ce6a87f848162/package.json)
  still requires old DSH peers. The native installer correctly refused it on
  next and retained the existing candidate. Retry/cancel returned to the native
  install form. A compatible local archive installed successfully; after restart,
  a real model call retained budget 3072 and High effort and added exactly its
  measured session usage.
- An archive that deliberately throws at plugin activation produced native phase
  `failed`, including `ISOLATED_UPDATE_APPLY_FAILURE`, despite package installation
  finishing. Reinstalling the normal candidate through the host UI recovered it.
  Three fake credentials, two selected models, the custom model, proxy settings,
  rates and all 17 request aggregates remained identical after recovery.
- A no-HMR overlay verified the restart-required path. Acceptance exposed that
  package files and even their physical paths can be replaced in place; reading
  the current manifest after install falsely identifies running code. The final
  implementation captures version/path/source at instance startup. Installing a
  same-version marked archive then left `runtimeMatchesInstallation: false` and
  its fixture-only authenticated marker at 404 until restart; after restart the
  marker returned the new code and the running identity matched. Regression tests
  cover both retargeted symlinks and unchanged paths/version numbers.
- Two independent browser pages started concurrent installs. With a fixture-only
  native idle deadline of 1000 ms, the stalled dependency timed out and its local
  download connections closed; the other archive install succeeded. Each page
  received its own result. The same configuration and statistics snapshot was
  intact afterward. Ordinary startup without either test overlay was restored.
- Browser offline and check cancellation displayed errors without a current-commit
  success claim, then recovered to explicit target checks. English/light at 390px
  had content/scroll width 281px. Chinese/dark native detail cards were readable at
  390px (285px/285px); nested Escape closed only the detail modal and restored the
  original button's focus. Native language choices were English and Chinese.
- A hot client update replaced an existing stale stylesheet, left exactly one
  style node and restored the sidebar's computed flex layout. A regression test
  also checks that unchanged styles are not rewritten. The settings-to-Plugins
  shortcut closed the settings modal.
- Desktop and final whole-plan acceptance remain open. The public GitHub candidate
  has not been updated/pushed here; its old compatibility refusal is not proof of
  installing a published next candidate. No interactive profile, global DSH
  installation, tag, Release or npm publication was changed.

## Native web search candidate (2026-10-19)

Above `aefdfd1`, P6 implements the opt-in `clinebot` search provider using the
current next `WebRuntime`. The request/response shape follows the fixed upstream
`4390f50` adapter (`POST /alpha/web-search`, `query`/`numResults`, `results[]`);
that source is interface evidence, not proof that the live channel is available.

- `npm test`: 120 passed, client 181033 bytes. Tests use the installed native
  web registry and a local HTTP server to cover opt-in, selection preservation,
  re-registration/disposal, result bounds and metadata, active credentials,
  empty results, 401/402/429/500, invalid JSON/shape/URLs, embedded errors, missing
  credentials, network errors, body deadlines, caller/disable/shutdown cancellation.
- Full-plugin HTTP configuration saves exposed a volatile-event ordering issue:
  the old config was read before the local saved snapshot changed. Capability
  synchronization now runs in the same queue as provider synchronization, reading
  current settings. A full-plugin native-context regression covers repeated saves.
- A packed candidate installed into the isolated DSH `0.2.1-rc.2` CLI Web profile.
  The browser toggle registered, unregistered and re-registered search; startup
  with search enabled also registered it. Only the fixture's host search selection
  was explicitly pinned to `clinebot`; the plugin never writes that choice.
  At 390px, the new search controls were readable with content/scroll width both
  285px. Saving a 12000 ms deadline through the real input persisted it; restoring
  15000 ms preserved registration. Full bilingual/theme acceptance stays in P8.
- A mock model emitted a real native `web_search` call. The host requested eight
  results, the ClinePass provider returned a real fixture URL/title/snippet, and
  the host delivered that source back in the model's tool result. Switching the
  fixture to account two caused the next search to use account two. Mock HTTP 429
  appeared in the native tool result as HTTP 429, without a fabricated
  `No results found.` success. The search does not itself rotate the global pin.
- This verifies the actual plugin, credential resolution and host tool chain with
  fake keys/local responses. Real ClinePass search access, external channel shape
  and Desktop remain unverified. P7 updates and P8 acceptance stay open.

## Usage surfaces and diagnostics candidate (2026-10-19)

Above `0b40f8f`, the P5 implementation adds sidebar quotas, a native detail modal,
current-session projections, explicit-rate estimates and streaming probes. This
is a committed implementation checkpoint; remaining acceptance in the
[sync plan](UPSTREAM_SYNC_PLAN.md) still applies.

- `npm test`: 114 passed, including build drift and lint checks. The generated
  client is 177519 bytes, below 256 KiB. Authentication tests cover all 26 routes.
  New checks exercise mixed-provider replay, absent native wire usage, replacement
  settlements/retries, explicit/unknown/zero rates, countdown states, quota observer
  lifetimes, probe cancellation/deadlines/shutdown, diagnostic attribution,
  display reads versus routing caches, and concurrent preference patches.
- Packed installation into the project-local isolated CLI Web profile used DSH
  `0.2.1-rc.2`, fake credentials and a local mock. Sidebar and composer surfaces
  appeared before visiting settings. The native modal preserved the conversation
  and closed with Escape. Its overview and full configuration are separate tabs.
- In a mixed-provider native session, the host counted 96 tokens while ClinePass
  showed one ClinePass reply and 48 tokens, excluding the other provider's 48.
  Switching sessions restored the older session's own unknown/measured state;
  restart retained the projection. A user-entered rate of USD 2/10 per million
  prompt/output tokens produced USD 0.00016 for 40 prompt and 8 output tokens,
  without adding cached or reasoning tokens twice.
- Native `/cline account`, `/cline use <name>`, `/cline use auto` and
  `/cline ping default` completed. Probes were recorded once as source `probe`,
  without a session id, and did not increase the composer reply counter. The
  latest packed UI probe returned first-output and total latency of 73 ms against
  the local mock; those timings do not describe the real ClinePass service.
- The final responsive quota cards were inspected in the actual host modal at
  390px in light theme: content width and scroll width were both 285px, labels and
  reset text remained readable, missing weekly/monthly data stayed unknown.
  Earlier desktop/native-modal checks do not replace the remaining complete
  light/dark, compact-sidebar, display-switch and error/recovery acceptance matrix.
- Subsequent native checks on the same P5 code verified delayed-probe cancellation
  reaches the upstream connection, leaves proxy activeRequests at zero and recovers
  to success. A past reset shows resetting; HTTP 503 shows an explicit quota error
  in the modal/sidebar, then refresh recovers. Compact sidebar uses its labelled
  ring, and both displays toggle off/on; hiding sidebar quota keeps the open modal
  available for re-enabling it. Unit tests cover subscription/timer release.
- Remaining native checks include full bilingual/keyboard/mobile paths and P2/P3
  lifecycle/concurrency/import scenarios. Desktop and real channel calls remain
  unexecuted. No interactive profile or global installation was modified.

## Persistent statistics candidate (2026-10-19)

Above `29914f9`, P4 adds profile-isolated durable statistics, queries and controls.
The [whole sync plan](UPSTREAM_SYNC_PLAN.md) stays open; remaining P2/P3 native
acceptance, P5 surfaces/diagnostics, P6 search, P7 native updates and P8 still apply.

- `npm test`: 103 passed. The generated client is 147407 bytes. All 25 plugin
  HTTP routes pass the unauthenticated boundary check. Added tests exercise
  concurrent writers, restart, ENOSPC/recovery, corrupt and unsupported files,
  reset failure/archiving, measured/unknown usage, safe CSV, native cancellation,
  captured transport identity, and account-attempt aggregates after the 100-record
  detail limit. CSV bodies retain request deadlines and structured HTTP failures.
- A packed candidate was installed into the existing project-local isolated
  `sync` CLI Web profile on DSH `0.2.1-rc.2`, with only fake credentials and a
  local mock. Native direct requests without wire usage persisted null counters,
  despite the stock SDK emitting zero defaults. The public provider stream-event
  observer distinguishes absence from a measured zero without modifying chunks.
- With explicit wire usage (40 prompt, 10 cached, 8 output, 3 reasoning), direct
  and proxy requests each stored 30 uncached input, 10 cached input and total 48.
  Reasoning stayed inside output. A 429 on the primary account followed by success
  on account two produced one logical request and two attempts. The failed/limited
  attempt remained attributed to primary, independently of the final account.
- Restarting the host retained totals and measured sample counts. The browser
  filtered account two to one request, two associated attempts and 48 tokens.
  Actual CSV download completed inside project scratch. The final export contains
  separate `scope=request` and `scope=attempt` rows and no credential values.
  `/cline stats` and `/cline test` ran through the native composer; the latter
  recorded source `smoke`, actual credential reference and the mock's reported usage.
- Deliberately corrupting only the isolated statistics file left the next native
  model call successful and its measurement buffered. The settings page displayed
  `STATS_CORRUPT`; reset archived the exact invalid bytes, cleared the statistics
  and retained all three fake credentials, two selected models and proxy settings.
- Screenshots were inspected in dark and light themes at 1280px. At 390px the
  host's fixed sidebar still leaves about 101px for content: mobile usability is
  not accepted. P5's standalone detail surface remains required. Desktop and
  final whole-plan packed/platform acceptance remain open. No external ClinePass
  model call, interactive profile mutation or global DSH upgrade occurred.

## Native adapter and proxy candidate (2026-10-19)

The candidate above `145a425` implements per-model effort defaults, the native
adapter, loopback proxy, account/session routing and historical image policy.
The complete [sync plan](UPSTREAM_SYNC_PLAN.md) remains open, including durable
analytics, additional usage surfaces, search, native updates and final acceptance.

- `npm test`: 91 passed on the next development dependencies. The bundle is
  137447 bytes, checked without rewriting. All 22 HTTP routes are covered by
  the unauthenticated boundary check. Proxy tests cover split UTF-8/SSE, embedded
  errors, 401/402/429/5xx, empty/truncated output, heartbeat-only first-output
  timeouts, stalled JSON bodies, cancellation and shutdown, body byte budgets,
  retry deduplication and routing precedence. Native tests use the installed
  `0.2.1-rc.2` adapter, registry and session replay APIs.
- Packed installation into the project-local isolated CLI Web profile booted
  the candidate with fake credentials and a local HTTP mock. Actual conversation
  requests passed through the proxy with a default High effort and preserved
  request budget of 2048. Session metadata reached only the proxy. An auxiliary
  title request used its explicit Off choice.
- Chromium saved 3072 through the new provider-card parameter editor in Settings
  → Models. The value survived restart and switching the proxy off through the
  ClineBot settings UI. The proxy listener stopped and a direct native conversation
  completed with budget 3072 and High effort.
- A synthetic PNG was uploaded through the native composer. Its first request
  contained one image. Enabling historical offload with zero retained historical
  images caused the native host to append `image/offload` and retry successfully:
  the mock received zero images and one offloaded placeholder. A host restart and
  subsequent direct request preserved that projection and the original attachment.
  Detached log replay and immutable original-image references also have a native
  regression test.
- Acceptance exposed two repaired issues: old nested `dsh-llm@0.1.5-rc.3` dropped
  `offloadImages`, and reparsing marked/frozen Schemastery dictionaries broke
  provider preparation and later configuration edits. Next peer declarations,
  an image-offload capability error and detached parsing address these cases.
  Reinstalling the isolated profile dependencies removed the stale old copy.
- Explicit adapter disposal and proxy cancellation/credential restoration pass
  native/unit tests. Full-host SIGTERM did not establish awaited cleanup;
  actual plugin disable/re-enable remains an integration acceptance item.
- Screenshots of the native model editor and proxy settings were inspected at
  1280px in the dark theme. New mobile and light-theme acceptance, Desktop,
  real ClinePass channel calls, key discovery/import through native services and
  final whole-plan packed acceptance remain open. No interactive profile or
  global DSH installation was modified, and no real external key was used.

## Previous model and credential candidate

P1 and the model/credential management portion of P2 in the
[sync plan](UPSTREAM_SYNC_PLAN.md) were implemented on 2026-10-19. The complete
plan remained open at that checkpoint; the native/proxy candidate above records
subsequent work.

- `npm test`: 71 passed, including the installed next Schemastery (volatile
  configuration values), installed adapter wire capture, complete plugin-route
  authentication boundary (18 routes), body/header timeouts, cancellation,
  plan/account races, model CRUD/default precedence, retained host edits and
  independent key validation. The client is 118462 bytes. Tests now check the
  generated bundle without rewriting it and run `no-undef` before the suite.
- Isolated CLI Web on installed DSH `0.2.1-rc.2` (npm `next` rechecked): the
  browser saved a batch context of 128000 and a custom model with a 64000 context,
  registered none, and restored all. Failed key validation recovered to success;
  status confirmed validation had not saved a secret. A fake credential and
  local mock plan enabled exactly the two returned plan models.
- Native provider edits were checked through the profile's actual stored model
  document: setting its request budget to 2048, hiding all models, restarting,
  and registering them again retained 2048, the custom declaration, verified plan
  and filtering. Captured edits are durable `hostModelOverrides`; restoring
  capabilities leaves request budgets intact.
- Real Chromium screenshots were inspected in light and dark themes. At 1280px
  the card is usable and warning/business tokens resolve. At 390px the host's
  fixed settings sidebar leaves approximately 101px for the plugin. The plugin
  no longer overflows horizontally, but this is not mobile usability acceptance;
  P5/P8 must still provide and verify the planned standalone detail surface.
- Key discovery tests use disposable project-local fixture homes and fake keys;
  no interactive Cline/VS Code/Cursor files were scanned. The independent
  validation endpoint was exercised against a local server and did not write
  credentials or settings. Native discovery/import acceptance remains open.
- Missing percentages and prices stay unknown; malformed limits responses fail,
  and a successful usage response without plan membership does not verify an
  empty plan. Update checks report disabled/failure separately from up-to-date.
- This pass used a checkout-linked plugin and a local mock at `127.0.0.1:38909`.
  No real ClinePass model/credential, Desktop app, global installation or
  interactive DSH profile was used. The final management candidate was also
  packed (55 files, client 118462 bytes, no scratch or credentials), installed
  into the isolated profile and booted. A batch change preserved the host budget
  of 2048, and two concurrent fake account additions allocated distinct `_2`
  and `_3` names. The installer reported missing host peers in the profile tree;
  runtime loading succeeded. Packed acceptance of the complete plan remains P8.

## Previous next baseline

Unreleased candidate above `dsh-clinepass@0.5.7`, checked on 2026-10-19 with
DeepSeek Harness `0.2.1-rc.2` (the npm `next` tag on that date). Upstream comparison:
[`4390f50`](https://github.com/GooDAnDReaDY/dsh-clinebot/commit/4390f50a0900465f3c79aa07e1e648d64a7d18be),
upstream version `0.5.31`. This candidate selectively adopts the host authentication
boundary, keeping this repository's direct provider, model capability/request-budget
split, account isolation, and disabled automatic updater.

- The unmodified manifest was rejected by the next installer's compatibility gate
  because its DSH peers only admitted `0.1.x`. The candidate adds
  `^0.2.1-rc.2` alongside the existing range and removes the request for the
  standalone client slots bundle, absent from this host. The client still consumes
  the native `slots`, `configForms`, and `locale` services.
- `npm test`: 57 passed. The rebuilt client is 99353 bytes. Added route-boundary
  tests cover all 16 HTTP routes, authentication errors, admitted writes, CSRF,
  and the legacy access behavior when no host authentication method exists.
  A test using the installed DSH adapter lists all 16 models and sends a real
  streaming HTTP request to a local mock with a fake credential. The captured
  body has `max_tokens: 65536`, `reasoning_effort: high`, and
  `thinking: { type: 'enabled' }`; it finishes without an adapter error.
- A project-local isolated `DSH_HOME` booted the web profile at
  `127.0.0.1:35239`. Installation from the checkout and from its packed tgz both
  succeeded without a compatibility exemption. pnpm's standalone peer check
  reports the host-provided peers as missing from the profile dependency tree;
  the DSH runtime resolves them and successfully boots the packed plugin.
- Anonymous requests to status, config, usage, account usage, auth status, and
  update checks returned 401, as did an anonymous config write. Chromium loaded
  the authenticated UI, opened ClineBot from Settings and from the installed
  plugin's Configure control, and displayed the card without an error. The
  desktop page was inspected at 1280 x 900; no new mobile layout pass was made.
- Saving a request-budget override of 4096 through the form succeeded. With a
  loopback mock API and fake keys, saving the primary credential, adding a second
  account, and switching to it returned 200. Restarting DSH retained the override,
  both credentials, the selected account, and the registered provider. Replacing
  the active fake credential also succeeded after installing the packed plugin.
- `npm pack` included 47 files and no scratch, credentials, environment files, or
  review prompts. No live ClinePass credential or model request was used. The
  interactive DSH home and global DSH installation were not changed. The old
  `0.1.7-rc.2` acceptance below is historical, not a rerun of that host.

## Previous host

DeepSeek Harness `0.1.7-rc.2` does not provide `settingsScope`. A client that injects it stays pending, and the web boot screen reports `dsh-clinepass: pending (waiting for service: settingsScope)`. From 0.5.1 the client injects `configForms`, `slots`, and `locale`. Settings → 内置插件 is a read-only inventory. The page is a `settings.section` named `dsh-clinebot`, and the same page is `plugins.row.config` at `dsh-clinepass#dsh-clinebot`. The 0.1.5-rc.2 notes below stay as the record of that host. An isolated `DSH_HOME` on 0.1.7-rc.2 booted past the plugin screen, showed ClineBot in the settings sidebar, opened the same form from the sidebar Plugins row, and accepted a settings write. The interactive `~/.dsh` profile was not changed.

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
| `configForms` wait breaks web boot | Confirmed for 0.1.5-rc.2: the string was absent from that host. 0.5.1 injects `configForms` because 0.1.7-rc.2 provides it and no longer provides `settingsScope`. | `rg` on the installed 0.1.7-rc.2 tree finds `configForms` in `@deepseek-ai/dsh-client-ui-settings` and no `settingsScope`. |
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

## 0.5.5 isolated boot (2026-10-03)

`npm test` on this tree: 48 passed. The client bundle was 91411 bytes.

Host: DeepSeek Harness `0.1.7-rc.2`. Isolated home: `DSH_HOME=/tmp/dsh-clinebot-accept-055/home`, profile `cbweb` created from the shipped `web` template. The plugin was installed with `dsh plugin --profile cbweb add` of this checkout. The process was started with `CLINEBOT_API_KEY` unset, `--no-open`, host `127.0.0.1`, port `35231`. The interactive `dsh web` process was left running. No ClinePass credential was sent.

`GET /dsh-clinebot/status` returned 200. The provider id was `clinebot`, `isRegistered` was true, 16 models were listed, the default model was `cline-pass/deepseek-v4.1-flash`, and the base URL was `https://api.cline.bot/api/v1`. The key was absent. `GET /dsh-clinebot/config` returned 200 with that default model. `POST /dsh-clinebot/save-key` with an empty key returned 400 `API key cannot be empty`. No `$DSH_HOME/clinebot-models-cache.json` was created. `~/.dsh/clinebot-models-cache.json` stayed at mtime `1790682638` and size 7292. The settings page was not walked in a browser. No live plan read was made.

## 0.5.6 isolated boot (2026-10-03)

`npm test` on this tree: 53 passed. The client bundle was 98278 bytes.

Host: DeepSeek Harness `0.1.7-rc.2`. Isolated home: `DSH_HOME=/tmp/dsh-clinebot-accept-056/home`, profile `web` from the shipped web template. The plugin was installed with `dsh plugin --profile web add` of this checkout. The process was started with `CLINEBOT_API_KEY` unset, `--no-open`, host `127.0.0.1`, port `35232`. No ClinePass credential was sent. `~/.dsh` was not changed.

`GET /dsh-clinebot/status` returned 200. The provider id was `clinebot`, `isRegistered` was true, 16 models were listed, the default model was `cline-pass/deepseek-v4.1-flash`, and the base URL was `https://api.cline.bot/api/v1`. The key was absent, `usage.user` was absent, and `recentRequests` was empty. `GET /dsh-clinebot/config` returned 200 with that default model. `POST /dsh-clinebot/save-key` with an empty key returned 400 `API key cannot be empty`. `GET /dsh-clinebot/usage` returned 400 `API key not found`. `GET /dsh-clinebot/usage/accounts` returned 200 with an empty account list. No isolated `clinebot-models-cache.json` was created. `~/.dsh/clinebot-models-cache.json` stayed at mtime `1790682638` and size 7292. The settings page was not walked in a browser. No live plan read was made.

## 0.5.7 add-account form (2026-10-03)

`npm test` on this tree: 53 passed. The client bundle was 99338 bytes. The version bump does not change that bundle.

Host: DeepSeek Harness `0.1.7-rc.2`. Isolated home: `DSH_HOME=/tmp/dsh-clinebot-accept-057/home`, profile `web` from the shipped web template. The plugin was installed with `dsh plugin --profile web add` of this checkout. The process was started with `CLINEBOT_API_KEY` unset, `--no-open`, host `127.0.0.1`, port `35233`. No ClinePass credential was sent. `~/.dsh` was not changed. That home was removed after the walk.

Settings → ClineBot showed only the Add account button. Choosing it revealed the label, credential name, and key, with Show, Save account, and Cancel. An invalid credential name kept the form and the message. Cancel cleared the fields and the message. At 390px the new fields stacked inside the account card. The existing account table still extends past that narrow column. No account was saved. No live plan read was made. `~/.dsh/clinebot-models-cache.json` stayed at mtime `1790682638` and size 7292.
