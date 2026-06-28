# VecMory — установка MCP-сервера в Claude Code

## Быстрая установка

```bash
# 1. Клонировать
git clone https://github.com/judas-priest/vecmory.git
cd vecmory

# 2. Установить зависимости
npm install

# 3. Создать .env из шаблона и вписать свой токен
cp .env.example .env
# Отредактировать VECMORY_TOKEN в .env

# 4. Добавить MCP-сервер в Claude Code
claude mcp add vecmory bash "$(pwd)/start-mcp.sh"
```

После этого перезапустите сессию Claude Code. Проверьте через `/mcp` — vecmory должен быть `connected`.

## Ручная установка (без `claude mcp add`)

Добавьте в `~/.claude.json` в секцию `mcpServers`:

```json
"vecmory": {
  "type": "stdio",
  "command": "bash",
  "args": ["/полный/путь/к/vecmory/start-mcp.sh"]
}
```

Перезапустите сессию.

## Почему bash-wrapper, а не node напрямую

Claude Code не пробрасывает `env` из конфига в MCP-процессы ([баг #11927](https://github.com/anthropics/claude-code/issues/11927)). `start-mcp.sh` загружает `.env` через `source` и запускает node.

## Первый запуск

При первом вызове любой тулзы (`recall`, `remember`, и т.д.) произойдёт:
1. Авторизация в Integram API (мгновенно)
2. Загрузка модели эмбеддинга ~90MB (один раз, кешируется)

Последующие вызовы работают мгновенно.

## Доступные тулзы

- `recall` — семантический поиск по памяти
- `remember` — сохранить факт/решение
- `forget` — удалить запись
- `memory_status` — статистика

## Настройки

Все настройки в `.env`. Ключевые:

| Переменная | Описание |
|-----------|----------|
| `VECMORY_TOKEN` | Токен пользователя Integram (обязательно) |
| `VECMORY_DB` | Имя базы данных |
| `VECMORY_TABLE_ID` | ID таблицы VecMoryNodes |
| `VECMORY_MODEL` | Модель эмбеддинга (по умолчанию multilingual MiniLM) |
| `VECMORY_TOP_K` | Кол-во результатов поиска (по умолчанию 16) |

## Коммиты

- Не использовать co-authored-by
- includeCoAuthoredBy: false
