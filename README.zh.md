# DSH ClinePass

DeepSeek Harness 的 ClinePass 插件，维护在这个仓库：
[xiangnan0811/dsh-clinepass](https://github.com/xiangnan0811/dsh-clinepass)。

[English](README.md) · [Русский](README.ru.md)

设置命名空间是 `dsh-clinebot`，提供方 id 是 `clinebot`，路由前缀是
`/dsh-clinebot`。不要在同一个 profile 里再装一个也会注册提供方 `clinebot`
的插件，两边都会写 `llm-pi-ai.providers.clinebot`。

包名是 `dsh-clinepass`。`private: true` 会拦住 `npm publish`。

## 从本仓库安装

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
- 输入框仅显示当前会话的 ClinePass 回复／尝试用量，排除其他 provider。费用需要在显示设置中明确填写每模型、每百万输入／输出 token 的费率；币种默认 USD，仅表示单位，不做汇率换算。没有费率或完整 usage 时显示不可计算；缓存按输入费率估算，推理不重复加到输出。
- 流式模型诊断最多请求 1024 输出 token、期限 30 秒，可取消，显示首个文本／思考／工具输出和总耗时。诊断计入配置档统计，不计入会话回复用量。`/cline ping <model>` 或 `/cline ping default` 使用该诊断；裸 `/cline ping` 保留 API 连通性检查。`/cline account` 查看账户，`/cline use <凭据名>` 钉选，`/cline use auto` 恢复自动路由。
- 同一张账号卡可以保存额外的 `CLINEBOT_API_KEY_*`。账号名先写入账号池，再保存密钥。密钥没有保存成功时，这个新名字会从账号池去掉。之后的 DSH 对话如果收到 HTTP 429 或 402，会改用下一个已保存的账号。切换账号、这次轮换、修改 API 地址、修改主凭据名，或替换当前正在使用的密钥，都会清掉上一份套餐模型列表，直到下一次成功读到套餐。替换当前密钥时也会删掉已保存的套餐缓存，旧列表不会再从磁盘装回来。已经开始的套餐读取也不能把这份列表装回去。`/cline` 输出纯文本。

`api.cline.bot` 的 `GET /api/v1/models` 返回 404。有密钥时，发现走 `GET /users/me/plan`。`cline-pass/deepseek-v4.1-flash` 是普通 ClinePass 模型，也是默认冒烟模型。

当前候选版本面向 DeepSeek Harness `0.2.1-rc.2`（2026-10-19 的 `next`）。`0.1.7-rc.2` 的验证记录属于先前版本。设置侧栏条目是 `settings.section` `dsh-clinebot`。同一页也注册为 `plugins.row.config`，键为 `dsh-clinepass#dsh-clinebot`。

宿主提供 `connection.requestRejection` 时，全部 `/dsh-clinebot/*` 接口都要求 DSH 登录认证，包括读取和更新检查。请通过 `dsh web` 打印的地址登录。未认证返回 401，宿主或来源校验失败返回 403；设置写入仍保留来源校验。

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
| `selectionKind` | `all-except-disabled` | `disabledModels` 为空时注册目录 |
| `planFilterEnabled` | `false` | 将手动选择与成功读取的套餐取交集；缺少套餐数据时不清空选择 |
| `batchModelDefaults` | 继承 | 上下文、输出能力与请求预算的批量默认值，低于单模型覆盖 |
| `timeoutMs` | `15000` | 用量和订阅请求 |
| `smokeTimeoutMs` | `25000` | 冒烟测试 |
| `webSearchEnabled` | `false` | 按需注册宿主搜索提供方 `clinebot`，不改全局搜索选择 |
| `searchTimeoutMs` | `15000` | 搜索期限，含读取响应体 |

设置 → 模型里列出的是已勾选的模型。上下文、最大输出、请求预算、输入和思考可以在卡片里按模型覆盖。覆盖留空先继承批量默认值，再继承目录。原生模型页的手改值保存在 `hostModelOverrides`，隐藏模型和重启后继续保留；在本卡片显式修改或恢复对应字段会清除该手改值。逐模型默认思考档在原生请求冻结前生效，调用方显式选档和关闭优先。在 next 的 LLM 服务中，只有 `clinebot` 转交给 ClinePass 原生适配器，以观察实际渠道 usage；仍可在“设置 → 模型”中编辑参数。代理切回直连时保留适配器注册。

“代理与账户路由”提供以下设置：

| 字段 | 默认值 | 行为 |
| --- | --- | --- |
| `proxyEnabled` | `false` | 带独立认证的 loopback 代理，只在首个模型输出前尝试其他账户 |
| `accountMode` | `least-used` | 优先最低已测配额；也可选择 `round-robin`，未知用量保持未知 |
| `modelRoutes` | `[]` | 模型指定账户优先，其后为手动钉选、会话绑定和自动策略 |
| `historyImageOffload` | `false` | 通过宿主日志记录和回放历史图片卸载，需要启用宿主图片卸载插件 |
| `historyImagesToKeep` | `2` | 保留的历史图片数；最新用户／工具输入仍然保留 |

代理凭据保存在 DSH 凭据服务中，仅引用名进入配置。关闭代理恢复真实上游地址、账户和原有重试／超时参数；直连保留原有后续请求轮换。连接、首输出和 JSON 响应体期限默认各 15 秒，流空闲期限 30 秒，总期限 300 秒，完整请求体上限 32 MiB。图片尺寸预算独立配置；历史卸载保留原始会话附件。[同步计划](docs/maintenance/UPSTREAM_SYNC_PLAN.md)列出剩余功能和验收。

统计文件位于“当前配置档目录／clinepass／stats.json”，通过宿主原子写入和文件锁处理并发。日期／模型／账户汇总长期保留，单次请求明细仅保留最近 100 条。代理内重试只算一个逻辑请求，单独记录各次上游尝试。缺失 usage 显示未知；缓存与非缓存输入互斥，推理已包含在输出中。数值旁显示实测请求数／总请求数；延迟为完成和首输出的均值，非流式冒烟没有首输出测速。统计不回填旧历史，也不作为账单。

请求和 token 汇总归最终账户，实际尝试另按调用账户汇总，回退前的失败不会转记给后一个账户。CSV 用 `scope=request|attempt` 区分两类行，不能把它们直接相加作为逻辑请求数。

存储故障会显示错误，不阻断模型请求；未写入的计量暂留内存。重置清除本配置档的全部统计，包括筛选范围外的日期；损坏文件先归档，账户和模型配置保留。

“原生网页搜索”使用活动账户和 `baseUrl` 下的 `POST /alpha/web-search`。开启后，在宿主网页搜索设置中明确选择 `clinebot`；其他搜索和抓取提供方保持原样。宿主 `web_search` 工具传入结果上限，每个渠道请求最多取 10 条，未传上限时取 5 条。只有有效的空结果数组才表示没有结果；HTTP、缺少凭据、响应格式、超时及取消分别报错，不回退到其他网站或修改账户钉选。关闭功能或卸载会注销提供方并取消在途搜索。当前已通过隔离 next 和本地 mock；真实渠道可用性仍待验证。

## 开发

```sh
npm run build:client
npm test
```

`npm test` 不改写产物，会检查 `lib/client.js` 与源文件一致、执行未定义变量检查，再运行测试。`npm pack` 打本地压缩包。不从 GitHub 安装时，用 `dsh plugin --profile web add ./<文件>.tgz`。

## 许可证

MIT。版权声明在 [LICENSE](LICENSE)。
