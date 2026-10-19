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
`dsh plugin add github:所有者/仓库`。只有想用 `dsh plugin add <npm 包名>` 时才需要 `npm publish`。

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
- 会话表统计已经结束的 ClinePass 流、插件冒烟测试和 `/cline test`。表里不保留提示文本。
- 同一张账号卡可以保存额外的 `CLINEBOT_API_KEY_*`。账号名先写入账号池，再保存密钥。密钥没有保存成功时，这个新名字会从账号池去掉。之后的 DSH 对话如果收到 HTTP 429 或 402，会改用下一个已保存的账号。切换账号、这次轮换、修改 API 地址、修改主凭据名，或替换当前正在使用的密钥，都会清掉上一份套餐模型列表，直到下一次成功读到套餐。替换当前密钥时也会删掉已保存的套餐缓存，旧列表不会再从磁盘装回来。已经开始的套餐读取也不能把这份列表装回去。`/cline` 输出纯文本。

`api.cline.bot` 的 `GET /api/v1/models` 返回 404。有密钥时，发现走 `GET /users/me/plan`。`cline-pass/deepseek-v4.1-flash` 是普通 ClinePass 模型，也是默认冒烟模型。

已核对的宿主是 DeepSeek Harness `0.1.7-rc.2` 和 `0.2.1-rc.2`（2026-10-19 的 `next`）。设置侧栏条目是 `settings.section` `dsh-clinebot`。同一页也注册为 `plugins.row.config`，键为 `dsh-clinepass#dsh-clinebot`。

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

设置 → 模型里列出的是已勾选的模型。上下文、最大输出、请求预算、输入和思考可以在卡片里按模型覆盖。覆盖留空先继承批量默认值，再继承目录。原生模型页的手改值保存在 `hostModelOverrides`，隐藏模型和重启后继续保留；在本卡片显式修改或恢复对应字段会清除该手改值。逐模型默认思考档仍待[同步计划](docs/maintenance/UPSTREAM_SYNC_PLAN.md)中的原生适配器接入。

## 开发

```sh
npm run build:client
npm test
```

`npm test` 不改写产物，会检查 `lib/client.js` 与源文件一致、执行未定义变量检查，再运行测试。`npm pack` 打本地压缩包。不从 GitHub 安装时，用 `dsh plugin add ./<文件>.tgz`。

## 许可证

MIT。版权声明在 [LICENSE](LICENSE)。
