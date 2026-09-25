# DSH ClinePass

Плагин ClinePass для DeepSeek Harness. Его ведут в этом репозитории:
[xiangnan0811/dsh-clinepass](https://github.com/xiangnan0811/dsh-clinepass).

[English](README.md) · [中文说明](README.zh.md)

Пространство настроек — `dsh-clinebot`, id провайдера — `clinebot`, префикс
маршрутов — `/dsh-clinebot`. Не ставьте в тот же профиль другой плагин,
который тоже регистрирует провайдера `clinebot`: оба пишут
`llm-pi-ai.providers.clinebot`.

Имя пакета — `dsh-clinepass`. `private: true` блокирует `npm publish`.

## Установка из репозитория

DeepSeek Harness `0.1.7-rc.2` ставит плагины через pnpm. Достаточно адреса GitHub:

```sh
dsh plugin --profile web add github:xiangnan0811/dsh-clinepass
```

Перезапустите `dsh`. **ClineBot** есть на боковой панели настроек. Страница **Плагины** тоже открывает его из строки `dsh-clinebot` внутри `dsh-clinepass`. Пункт «Встроенные плагины» в настройках только показывает список и больше не содержит эту карточку.

Боковая витрина (`dsh-market`) не требует npm. Установка оттуда вызывает
`dsh plugin add github:владелец/репозиторий`. `npm publish` нужен только для
`dsh plugin add <имя-в-npm>`.

Этот репозиторий не является форком GitHub. Для каталога нужны тема
`dsh-plugin` на странице About и `cordis.patch.yml` в корне. Индекс
запускается около 06:00 и проверяет, что это плагин DSH. Другой путь —
issue в [2BingLing/dsh-market](https://github.com/2BingLing/dsh-market).

Не задавайте `CLINEBOT_API_KEY` в оболочке, из которой запускается `dsh`.
DSH считает переменную источником только для чтения и отклоняет сохранение
ключа со страницы настроек. Ключ сохраняется в карточке плагина. Браузер
вызывает `http://127.0.0.1:<порт>/dsh-clinebot/...` у локального DSH. Плагин
затем вызывает `baseUrl`. Используйте `https://api.cline.bot/api/v1`.

## Страница настроек

- Адрес API и ключ ClinePass.
- Окна 5 часов, недели и месяца из `GET /users/me/plan/usage-limits`:
  процент, шкала и дата сброса. Аккаунт, тариф и время последнего запроса —
  отдельные строки.
- Выбранные модели регистрируются в DSH. Потолок вывода не отправляется как
  `max_tokens`. Отправляется бюджет запроса. Бюджет по умолчанию — 65536.
- Модель для проверки связи выбирается в карточке. Для Muse Spark
  отправляются `reasoning_effort: low` и предел 1024, чтобы рассуждение не
  съело короткий ответ.
- Таблица сессии считает только проверку связи плагина и `/cline test`.

`GET /api/v1/models` на api.cline.bot отвечает 404. С ключом список читается
из `GET /users/me/plan`. `cline-pass/deepseek-v4.1-flash` — обычный id
ClinePass и модель проверки связи по умолчанию.

Проверенный хост: DeepSeek Harness `0.1.7-rc.2`. Пункт в настройках —
`settings.section` `dsh-clinebot`. Та же страница зарегистрирована как
`plugins.row.config` с ключом `dsh-clinepass#dsh-clinebot`.

## Конфигурация

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

| Поле | По умолчанию | Назначение |
| --- | --- | --- |
| `baseUrl` | `https://api.cline.bot/api/v1` | API, который вызывает плагин |
| `apiKeyEnv` | `CLINEBOT_API_KEY` | Имя учётных данных |
| `defaultModel` | `cline-pass/deepseek-v4.1-flash` | Проверка связи и модель провайдера |
| `selectionKind` | `all-except-disabled` | Пустой `disabledModels` регистрирует каталог |
| `timeoutMs` | `15000` | Запросы тарифа и квоты |
| `smokeTimeoutMs` | `25000` | Проверка связи |

В «Настройки → Модели» попадают отмеченные модели. Контекст, потолок вывода,
бюджет запроса, ввод и рассуждение правятся по модели. Пустое поле наследует
каталог.

## Разработка

```sh
npm test
```

`npm test` пересобирает `lib/client.js` и запускает тесты. `npm pack` собирает
локальный архив. Без установки с GitHub: `dsh plugin add ./<файл>.tgz`.

## Лицензия

MIT. Уведомление об авторском праве — в [LICENSE](LICENSE).
