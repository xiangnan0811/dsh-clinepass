# DSH ClinePass

DeepSeek Harness 的 ClinePass 插件，维护在这个仓库：
[xiangnan0811/dsh-clinepass](https://github.com/xiangnan0811/dsh-clinepass)。

[English](README.md) · [Русский](README.ru.md)

设置命名空间是 `dsh-clinebot`，提供方 id 是 `clinebot`，路由前缀是
`/dsh-clinebot`。不要在同一个 profile 里再装一个也会注册提供方 `clinebot`
的插件，两边都会写 `llm-pi-ai.providers.clinebot`。

包名是 `dsh-clinepass`。`private: true` 会拦住 `npm publish`。

## 从本仓库安装

`0.8.0` 版本要求 DeepSeek Harness `^0.2.1-rc.2`。

DeepSeek Harness 通过 pnpm 安装插件。GitHub 地址就够用：

```sh
dsh plugin --profile web add github:xiangnan0811/dsh-clinepass
```

重启 `dsh`。设置侧栏里有 **ClineBot**。侧边栏的**插件**页打开 `dsh-clinepass` 后，`dsh-clinebot` 这一行也可以进入配置。设置里的**内置插件**只读，不再挂第三方插件的设置。

侧边栏里的插件市场（`dsh-market`）不要求先发 npm。它的一键安装用的是
`dsh plugin --profile web add github:所有者/仓库`。只有想用 `dsh plugin --profile web add <npm 包名>` 时才需要 `npm publish`。

这个仓库不是 GitHub fork。About 页加上 topic `dsh-plugin`，并且根目录有
`cordis.patch.yml`，市场才会收录。收录大约每天 06:00 跑，还会再确认这是 DSH 插件。
也可以到 [2BingLing/dsh-market](https://github.com/2BingLing/dsh-market) 提交流 issue。

不要在启动 `dsh` 的终端里设置 `CLINEBOT_API_KEY`。DSH 会把它当成只读来源，设置页保存密钥会被拒绝。密钥在插件卡片里保存。浏览器访问的 `http://127.0.0.1:<端口>/dsh-clinebot/...` 是本机 DSH，插件再按 `baseUrl` 请求 API。`baseUrl` 用 `https://api.cline.bot/api/v1`。

## 设置页

- 保存 API 地址和 ClinePass 密钥。
- 显示 5 小时、每周、每月用量。数据来自 `GET /users/me/plan/usage-limits`，含百分比、进度和重置日期。账号、套餐、上次获取各占一行。账号邮箱默认打码，可以手动显示原文。套餐若带取消时间，会多出一行。保存了多把密钥时，其余账号各显示这三个百分比。这张列表不改变限流后选中的账号。
- 把勾选的模型注册进 DSH。最大输出不会写成 `max_tokens`，请求预算才会。默认预算是 65536。
- 支持选择快捷操作、搜索、可选套餐过滤、批量默认值和自定义模型表单。显式空选择表示不注册模型。单模型覆盖优先于批量默认值；恢复能力参数不会改变请求预算，预算有单独恢复按钮。
- 可以保存前验证密钥，也可以主动检查已知 Cline CLI、VS Code、Cursor 文件及 Cline 环境变量。发现列表仅显示遮罩，通过五分钟有效的服务端编号导入所选密钥到账户池。编辑器加密的秘密可能无法发现。
- 冒烟测试可以选择模型。Muse Spark 使用 `reasoning_effort: low` 和 1024 的输出上限，避免思考把正文挤空。
- 按 DSH 配置档持久化请求结果、重试次数、延迟及实际返回的 token 计数。可按 UTC 日期、模型或账户筛选、导出 CSV、重置统计；`/cline stats` 和 `/cline telemetry` 显示同一份汇总。不保存提示文本或密钥值。
- 侧栏配额按钮打开宿主详情弹窗，包含配额、统计和完整配置，适合窄屏。配额显示重置倒计时，缺失时间或用量保持未知。侧栏和输入框组件可分别关闭，默认开启。
- 输入框仅显示当前会话的 ClinePass 回复／尝试用量，排除其他 provider。费用按每百万 token 分别计算非缓存输入、输出、缓存读取、缓存写入（创建提示缓存），费率依次取手动费率、绑定的参考价、自动匹配的 `models.dev` USD 参考价。推理不重复加到输出；币种默认 USD，不做汇率换算，其他币种需手动费率。缺失的缓存单价按输入单价计；未上报的计数按零计，没有价格的模型不计入。ClinePass 订阅不按请求计费，这里只是粗略参考，不是账单。
- 自相矛盾的 token 计数不参与计量和费用估算，模型回复及请求结果仍保留。会话投影缓存会按新规则从既有日志重新计算，不推测性补齐历史上未记录的原始用量。
- 流式模型诊断最多请求 1024 输出 token、期限 30 秒，可取消，显示首个文本／思考／工具输出和总耗时。诊断计入配置档统计，不计入会话回复用量。`/cline ping <model>` 或 `/cline ping default` 使用该诊断；裸 `/cline ping` 保留 API 连通性检查。`/cline account` 查看账户，`/cline use <凭据名>` 钉选，`/cline use auto` 恢复自动路由。
- 同一张账号卡可以保存额外的 `CLINEBOT_API_KEY_*`。账号名先写入账号池，再保存密钥。密钥没有保存成功时，这个新名字会从账号池去掉。之后的直连 DSH 对话如果收到 HTTP 429 或确认的账户配额耗尽，会为后续请求切换账号；HTTP 402 仅表示该模型余额不足，不改变全局活动账号。切换账号、这次轮换、修改 API 地址、修改主凭据名，或替换当前正在使用的密钥，都会清掉上一份套餐模型列表，直到下一次成功读到套餐。替换当前密钥时也会删掉已保存的套餐缓存，旧列表不会再从磁盘装回来。已经开始的套餐读取也不能把这份列表装回去。`/cline` 输出纯文本。

2026-10-26 已核对 [ClinePass 推荐接口](https://api.cline.bot/api/v1/ai/cline/recommended-models)及[模型详情接口](https://api.cline.bot/api/v1/ai/cline/models)：前者提供订阅型号，后者提供模型名称和参考参数。`GET /api/v1/models` 现在也可用，作为仅含 ID 的回退来源。“同步订阅模型”仍单独读取当前账户的 `/users/me/plan`，默认冒烟模型仍为 `cline-pass/deepseek-v4.1-flash`。

目录在启动约 0.5 秒尝试同步，3 秒、15 秒时按需补试；之后每小时检查，成功结果超过 6 小时才刷新。手动同步更新同一新鲜度；失败保留有效结果，停用和卸载取消读取。普通配额轮询不读取完整目录。v4 模型缓存按地址、账户和凭据内容指纹隔离，旧版本失效后重新读取；缓存保存失败会显示警告，配置与模型调用仍可使用。

FREE 徽标和筛选只使用推荐接口明确 `free` 列表中的精确 ID（2026-10-29 已核对），不由名称或零参考价推断；目录信息不证明账户权限或实际调用。日期模型只展示接口返回的精确 ID 和对应版本参数，普通厂商 ID 不改写成 Pass ID，推荐列表不扩大套餐成员或自动添加自定义模型。

代理对 HTTP 402 按账户＋精确模型冷却 5 分钟，首个有效输出前可尝试其他可用账户；该账户其他模型不受影响。恢复按钮只恢复对应范围；仅传账户的恢复 API 仍清除该账户全部冷却。直连、测速和冒烟的 402 不触发全局轮换。HTTP 413／已知请求大小错误不重试、不切账户，提示新建会话或减少消息／图片；上下文 token 超限单独分类。新增统计分别记录余额不足、限流和请求过大，旧聚合不回填新分类。

当前默认启用 GLM 5.3 / 5.3 Flash、Kimi K3.1 Pro、MiniMax M3.1 Flash、MiMo V2.6 Flash / Pro、Qwen 3.8 Max、DeepSeek V4.1 Flash（稳定别名及 1017）、DeepSeek V4 Pro 和 Muse Spark 1.3 Contributor。旧代型号保留供手动启用，不再隐式启用；已有显式选择和旧型号默认项仍可使用，ID、预算和上游钉选不改写。“启用当前默认模型”清除禁用和旧型号选入项，保留已保存的默认型号；“全部注册”包含旧型号。

在“自定义模型 → 从接口获取模型”中搜索并选择型号，即可填入准确 ID、名称、上下文、输出上限和图像能力。只向已配置的 API 发送当前凭据；普通 API 型号单列，避免与 ClinePass 订阅计费混淆。已列出的 Pass 型号仅在供应商型号后缀完全一致且唯一时借用其参考参数，不根据普通 API 型号凭空生成 Pass ID。内置型号可直接启用；自定义型号保存后也会选中，即使此前取消了全部注册。手动添加只需 ID，高级参数可留空继承；未知上限不猜测。预填请求预算最多 65536，若已发布的上下文或输出上限更低则随之降低，不把输出能力上限直接当预算，也不猜测思考档位。

发现列表不修改已验证套餐，不发送推理请求。套餐过滤仍然生效，所选型号被过滤时会提示；用户保存的自定义声明和参数在账户切换后保留。参数预填是接口参考值，不代表已实测该账户的渠道能力。

`0.8.0` 版本面向 DeepSeek Harness `0.2.1-rc.2`（2026-10-19 的 `next`）。`0.1.7-rc.2` 的验证记录属于先前版本。设置侧栏条目是 `settings.section` `dsh-clinebot`。同一页也注册为 `plugins.row.config`，键为 `dsh-clinepass#dsh-clinebot`。

宿主提供 `connection.requestRejection` 时，全部 `/dsh-clinebot/*` 接口都要求 DSH 登录认证，包括读取和更新检查。请通过 `dsh web` 打印的地址登录。未认证返回 401，宿主或来源校验失败返回 403；设置写入仍保留来源校验。
写操作必须带 Origin 或 Referer，不能仅凭 Fetch Metadata 获准；转发主机头仅接受来自 loopback 代理的值，宿主认证仍然必需。

`0.8.0` 还通过了 DSH `0.2.1-rc.3` 的隔离 Web 和直连 headless 夹具验收。headless 默认关闭托管凭据服务，本插件需要该服务：在对应 profile 的 patch 中启用 `{id: credentials, disabled: false}`，并把 `agent-default-model` 设为提供方 `clinebot` 及一个已启用模型；仍可用启动环境变量供给密钥。上游可选 TUI 设置集成暂缓，官方宿主尚无可验证的 `tuiSettingsSections` 消费者。

## 配置

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

| 字段 | 默认 | 作用 |
| --- | --- | --- |
| `baseUrl` | `https://api.cline.bot/api/v1` | 插件请求的 API |
| `apiKeyEnv` | `CLINEBOT_API_KEY` | 凭据名 |
| `defaultModel` | `cline-pass/deepseek-v4.1-flash` | 冒烟测试和提供方默认模型 |
| `selectionKind` | `all-except-disabled` | 注册当前型号及明确选入的旧型号，排除 `disabledModels`；显式模式仅注册 `explicitModels` |
| `planFilterEnabled` | `false` | 将手动选择与成功读取的套餐取交集；缺少套餐数据时不清空选择 |
| `batchModelDefaults` | 继承 | 上下文、输出能力与请求预算的批量默认值，低于单模型覆盖 |
| `upstreamPins` | `[]` | 按模型固定 ClinePass 后端供应商，与账户钉选独立 |
| `timeoutMs` | `15000` | 用量和订阅请求 |
| `smokeTimeoutMs` | `25000` | 冒烟测试 |
| `webSearchEnabled` | `false` | 按需注册宿主搜索提供方 `clinebot`，不改全局搜索选择 |
| `searchTimeoutMs` | `15000` | 搜索期限，含读取响应体 |
| `statsRetentionDays` | `95` | 分钟汇总保留 0–3650 天，0 为不限；每日汇总长期保留 |
| `quotaForecastEnabled` | `false` | 用间隔至少一分钟的同账户、同窗口实测样本估算配额消耗速度 |
| `priceAutoSync` | `false` | 模型同步时自动刷新公共参考价格，最多每六小时一次 |
| `priceBindings` | `[]` | 显式 `{model, provider, sourceModel}` 价格绑定；手动 `costRates` 优先 |
| `dailyBudget`、`monthlyBudget` | `0` | 可选 UTC 日／月费用估算限额，使用 `costCurrency`，0 分别表示关闭 |

设置 → 模型里列出的是已勾选的模型。上下文、最大输出、请求预算、输入和思考可以在卡片里按模型覆盖。覆盖留空先继承批量默认值，再继承目录。原生模型页的手改值保存在 `hostModelOverrides`，隐藏模型和重启后继续保留；在本卡片显式修改或恢复对应字段会清除该手改值。逐模型默认思考档在原生请求冻结前生效，调用方显式选档和关闭优先。在 next 的 LLM 服务中，只有 `clinebot` 转交给 ClinePass 原生适配器，以观察实际渠道 usage；仍可在“设置 → 模型”中编辑参数。代理切回直连时保留适配器注册。

在设置页的 **“钉上游 · 固定模型供应商”** 区域选择模型，填写供应商 ID（例如 `deepseek`），点击“保存上游”。模型编辑器也保留同一入口。留空保存或点击“恢复自动路由”即可取消。选中的模型被删除后，需重新选择才能保存，不会自动改选其他模型。例如配置：

```yaml
upstreamPins:
  - model: cline-pass/deepseek-v4.1-flash-1017
    provider: deepseek
```

`0.7.2` 新增独立的 **DeepSeek V4.1 Flash 1017** 条目；旧模型、默认值、会话选择和已有钉选保持原 ID。该快照已列于 [Cline 官方推荐接口](https://api.cline.bot/api/v1/ai/cline/recommended-models)（2026-10-25）；图像、思考、1M 上下文及 384K 输出能力依据 [DeepSeek 官方文档](https://api-docs.deepseek.com/quick_start/pricing/)，不是 ClinePass 实测上限。请求预算仍默认 65536。

稳定别名与日期快照可能走不同路由。验证时先勾选 `cline-pass/deepseek-v4.1-flash-1017`，为这个完整 ID 单独保存 `deepseek` 限制，再在“流式模型测速”中明确选择它。仅修改冒烟默认模型不会切换现有会话；正常聊天需在会话模型选择器中主动选择快照。若开启套餐过滤，快照还必须出现在当前账号已发现的套餐列表中。网关是否执行限制以当前账号的响应为准，插件不自动改模型或发探测请求。

测速和请求历史的“响应路由详情”显示响应 ID、返回模型、网关规范模型、解析供应商及 DeepSeek 命名空间指纹（仅限实际返回的字段），便于区分请求模型和网关映射。它们不替代最终上游核对；匿名私有渠道不会被当作 `deepseek` 放行。记录仅保留有界标识，不保存完整规划说明、请求头或正文，旧记录不补猜。冒烟统计按请求模型归属，返回模型单独展示。

插件启用期间，原生直连／代理聊天、标题／压缩等辅助调用、流式测速和冒烟测试均遵守限制。直连在准备调用时固定配置，代理使用请求进入代理时的配置；切换账号重试仍保留同一供应商限制，不请求回退到其他供应商。请求同时携带 `provider.only` 与 `providerOptions.gateway.only`，分别覆盖 OpenRouter 和网关规划器；`zai`／`z-ai` 按各自协议拼写。不会自动枚举供应商或发出探测请求。

对 `cline-pass/deepseek-v4.1-flash-1017` 的 `deepseek` 钉选，插件还会在 `providerOptions.gateway.has` 中补齐 `vision` 和 `implicit-caching`，保留调用方已有的额外能力条件并去重；缺失、`null` 或空列表均补入这两项。仍使用原 ClinePass 模型 ID 和凭据，不改写模型选择或已保存配置。2026-10-26 单账号实测中，仅 `only` 会走匿名私有候选，组合参数则命中 DeepSeek；无后缀模型加上这两项仍走私有渠道，因此此修复只作用于上述日期模型与钉选组合。其他钉选和自动路由保持原行为。额外能力条件可能导致没有匹配候选。

保存后可运行“流式模型测速”，对照指定与实际上游，会产生真实请求。只有结构化 `finalProvider` 或直连响应的 `provider` 才作为确认依据；供应商不符返回 `UPSTREAM_PIN_MISMATCH`，整次响应都没有供应商信息返回 `UPSTREAM_PIN_UNVERIFIED`。部分账号（包括私有路由）可能忽略限制，不能以 HTTP 200 宣称钉住成功。供应商信息可能在输出开始后才返回：此时会报错结束，不重放，无法撤回已有输出和费用。固定供应商不能保证缓存命中，也不能强迫服务端改变路由政策。本地网关验证覆盖真实 DSH 适配器及失败路径；2026-10-26 已用一个真实 ClinePass 账号的小文本请求验证日期模型的组合参数，尚未验证图片、长上下文、额度扣减或未来路由。协议参考 [cline-pass-switcher](https://github.com/munmunjaklin458-afk/cline-pass-switcher/tree/02538a3137a08948a94f26f17dd4aeff8c029ed1) 与 [dsh-cline-pass](https://github.com/yhshzh/dsh-cline-pass/tree/008fa828c8c2c862d909e940372b72285e3c8ba4) 的公开实现，未复制其实现代码。

普通聊天也会显示上游：输入区提示“上次响应”的供应商，展开可查看当前会话的请求；统计页“最近请求”默认显示最近 10 次、最多展开到 50 次（共保留 100 次，含失败、自动路由及账户重试明细）。逐次保留指定上游、是否附加限制、响应报告上游和核对结果，重启后继续保留；不记录密钥或聊天正文。显示区分本次命中、未命中、无法确认、未附加限制、自动路由和历史未记录。“已附加”不代表网关已接收；本次供应商相符不证明后续请求会遵守限制。模型旁的标签只表示指定的供应商。当前会话明细随会话结算、打开详情或手动刷新更新，只从最近 100 次记录中筛选本会话，不借用其他会话或当前配置补齐缺失证据。CSV 仍导出汇总统计，上游明细通过统计 API 的 `recent` 字段提供。

“代理与账户路由”提供以下设置：

| 字段 | 默认值 | 行为 |
| --- | --- | --- |
| `proxyEnabled` | `false` | 带独立认证的 loopback 代理，只在首个模型输出前尝试其他账户 |
| `accountMode` | `least-used` | 优先最低已测配额；也可选择 `round-robin`，未知用量保持未知 |
| `modelRoutes` | `[]` | 模型指定账户优先，其后为手动钉选、会话绑定和自动策略 |
| `historyImageOffload` | `false` | 通过宿主日志记录和回放历史图片卸载，需要启用宿主图片卸载插件 |
| `historyImagesToKeep` | `2` | 保留的历史图片数；最新用户／工具输入仍然保留 |

代理凭据保存在 DSH 凭据服务中，仅引用名进入配置。关闭代理恢复真实上游地址、账户和原有重试／超时参数；直连保留原有后续请求轮换。连接、首输出和 JSON 响应体期限默认各 15 秒，流空闲期限 30 秒，总期限 300 秒，完整请求体上限 32 MiB。图片尺寸预算独立配置；历史卸载保留原始会话附件。[验证记录](docs/maintenance/VALIDATION.md)列出功能验收与未覆盖范围。代理仅接受插件模型列表中的精确 ID；使用新型号前请先添加模型。

统计文件位于“当前配置档目录／clinepass／stats.json”，通过宿主原子写入和文件锁处理并发。日期／模型／账户汇总长期保留，单次请求明细仅保留最近 100 条。代理内重试只算一个逻辑请求，单独记录各次上游尝试。缺失 usage 显示未知；缓存与非缓存输入互斥，推理已包含在输出中。数值旁显示实测请求数／总请求数；延迟为完成和首输出的均值，非流式冒烟没有首输出测速。统计不回填旧历史，也不作为账单。

请求和 token 汇总归最终账户，实际尝试另按调用账户汇总，回退前的失败不会转记给后一个账户。CSV 用 `scope=request|attempt` 区分两类行，不能把它们直接相加作为逻辑请求数。

存储故障会显示错误，不阻断模型请求；未写入的计量暂留内存。重置清除本配置档的全部统计，包括筛选范围外的日期；损坏文件先归档，账户和模型配置保留。

统计卡片只有一个筛选栏：时间范围（全部、24 小时、7／30／90 天或自定义本地分钟范围，不含结束分钟）、模型、账户和“仅看失败”，修改后立即生效。结果依次为请求、成功率、token、参考费用和首输出 KPI；token 构成与缓存命中率（缓存读取 ÷ 全部输入）；P50／P95 分桶边界与平均延迟；星期／小时热力图（使用浏览器当前的 UTC 偏移）；按日期／模型／账户的分项明细与 token 占比。上报率低于 95% 的字段会标记。CSV 与 JSON 导出沿用当前筛选。旧每日汇总保留，不伪造分钟或分位数样本；时间范围和失败过滤仅包含保留的分钟明细。账户历史独立保留最近 200 条选路、冷却、恢复和切换事件，统计重置不清除这些事件。附加账户支持重命名和清除已存密钥，保留账户条目及钉选；环境密钥须在来源处移除。

可在“用量与费率”或统计的参考费用面板同步 `models.dev` 的公共 USD 参考价格。缓存位于当前配置档的 `clinepass/prices.json`；失败保留上次成功目录并显示错误与更新时间。统计和会话估算按模型名自动匹配参考价（优先 ClinePass 自身条目，其次官方厂商，再次其他提供方；末尾 `-MMDD` 日期会去掉后再试）。明确绑定提供方和模型可覆盖自动匹配，手动费率整行优先，包括未补齐的旧费率。其他币种只使用手动费率。

日／月预算默认关闭，启用后在原生调用、代理、冒烟和测速开始前，用同一套参考估算与限额比较，只有达到限额才阻止新调用；缺少价格、用量或统计时按零计。在途请求仍可能超过限额。它是本地估算，不代表账单或订阅配额；重置统计也会重置预算已用金额。切换币种只改变手动费率和限额的单位，不做汇率换算。`/cline cost`、`/cline budget` 显示同一估算。

配额速度预测也默认关闭，只使用同账户、同窗口的实际连续采样；样本不足、错误、重置和账户切换时清空预测，不影响路由。

“原生网页搜索”区分模型内置搜索与独立搜索提供方。[Cline 官方代码](https://github.com/cline/cline/blob/40c5d99031fe1128189c5b52e40638d2b7787754/sdk/packages/llms/src/providers/builtins.ts)为 ClinePass 声明了模型内置搜索能力；这不能证明 `POST /alpha/web-search` 是 ClinePass 可用的独立接口。原适配保留在“ClinePass 独立搜索 · 实验性”中，默认关闭，真实渠道尚未验证。仅在确认网关支持该接口后启用，再在宿主网页搜索设置中选择 `clinebot`；注册不等于验证成功。每次最多 10 条结果，默认 5 条，错误与空结果区分，关闭会注销并取消在途搜索。

DeepSeek 官方已提供独立 Search／Fetch，请在宿主网页搜索设置中配置官方提供方和 DeepSeek 密钥。两者各按每千次成功且有结果的请求收费 5 元，失败、空结果、超时不计费；Harness 等服务端工具调用从北京时间 2026-11-01 00:00 起收费。这些费用不纳入本插件的 ClinePass token 估算。详见 [DeepSeek 官方说明](https://api-docs.deepseek.com/zh-cn/guides/search/)。

在 DSH next `0.2.1-rc.2` 中，实际停用插件会取消在途调用、关闭代理、删除临时凭据并恢复内置模型适配器。保存的模型／账户配置仍保留；重新启用和热更新会自动同步当前适配器与凭据，保留配置和持久化统计。这些路径已通过隔离 CLI Web 验收；Desktop 仍待验收。

设置页顶部仅显示运行中的插件版本和仓库地址。更新仍在**插件 → ClinePass 更新**中进行。GitHub 目标固定为本仓库经过检查的提交；本地目录、压缩包和 registry 安装需要明确选择目标。本地更新填写 `npm pack` 生成的 `.tgz`／`.tar.gz` 绝对路径。宿主负责检查与安装、配置档锁、取消及失败／需重启反馈，保留账户、模型配置和统计，不会在后台自动安装。

运行版本与安装版本分别记录，包括同版本更新；压缩包路径／版本一致或未记录 Git 提交号时，不能宣称内容已经一致。按宿主提示重启或刷新后再检查。压缩包检查只读取清单，不解包：压缩大小最多 16 MiB，条目总大小 64 MiB，清单 256 KiB。`GET /dsh-clinebot/update` 仅检查状态；安装交给原生弹窗，旧 HTTP 安装操作返回 405。

## 开发

```sh
npm run build:client
npm test
```

`npm test` 不改写产物，会检查 `lib/client.js` 与源文件一致、执行未定义变量检查，再运行测试。`npm pack` 打本地压缩包。不从 GitHub 安装时，用 `dsh plugin --profile web add ./<文件>.tgz`。

## 许可证

MIT。版权声明在 [LICENSE](LICENSE)。
