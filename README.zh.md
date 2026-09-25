# DSH ClinePass

DeepSeek Harness 的 ClinePass 插件，维护在这个仓库：
[xiangnan0811/dsh-clinepass](https://github.com/xiangnan0811/dsh-clinepass)。

[English](README.md) · [Русский](README.ru.md)

设置命名空间是 `dsh-clinebot`，提供方 id 是 `clinebot`，路由前缀是
`/dsh-clinebot`。不要在同一个 profile 里再装一个也会注册提供方 `clinebot`
的插件，两边都会写 `llm-pi-ai.providers.clinebot`。

包名是 `dsh-clinepass`。`private: true` 会拦住 `npm publish`。

## 从本仓库安装

DeepSeek Harness `0.1.7-rc.2` 通过 pnpm 安装插件。GitHub 地址就够用：

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
- 显示 5 小时、每周、每月用量。数据来自 `GET /users/me/plan/usage-limits`，含百分比、进度和重置日期。账号、套餐、上次获取各占一行。
- 把勾选的模型注册进 DSH。最大输出不会写成 `max_tokens`，请求预算才会。默认预算是 65536。
- 冒烟测试可以选择模型。Muse Spark 使用 `reasoning_effort: low` 和 1024 的输出上限，避免思考把正文挤空。
- 会话表只统计插件冒烟测试和 `/cline test`。

`api.cline.bot` 的 `GET /api/v1/models` 返回 404。有密钥时，发现走 `GET /users/me/plan`。`cline-pass/deepseek-v4.1-flash` 是普通 ClinePass 模型，也是默认冒烟模型。

已核对的宿主是 DeepSeek Harness `0.1.7-rc.2`。设置侧栏条目是 `settings.section` `dsh-clinebot`。同一页也注册为 `plugins.row.config`，键为 `dsh-clinepass#dsh-clinebot`。

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
| `timeoutMs` | `15000` | 用量和订阅请求 |
| `smokeTimeoutMs` | `25000` | 冒烟测试 |

设置 → 模型里列出的是已勾选的模型。上下文、最大输出、请求预算、输入和思考可以在卡片里按模型覆盖。覆盖留空表示继承目录。

## 开发

```sh
npm test
```

`npm test` 会从 `src/client` 重建 `lib/client.js` 并运行测试。`npm pack` 打本地压缩包。不从 GitHub 安装时，用 `dsh plugin add ./<文件>.tgz`。

## 许可证

MIT。版权声明在 [LICENSE](LICENSE)。
