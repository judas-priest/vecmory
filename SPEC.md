# VecMory — npm MCP-сервер контекстной памяти для AI-агентов

## Обзор

Отдельный npm-пакет. Самостоятельный MCP-сервер (stdio).
Ходит напрямую в Integram HTTP API (PHP-бэкенд).
Хранит цепочки `запрос -> ошибка -> решение` как граф с типизированными рёбрами.
Эмбеддинг локальный (CPU, без внешних API). Ноль новой инфраструктуры —
данные живут в существующей таблице Integram.

Источники:
- [Plan-draft.md](https://github.com/ideav/crm/blob/main/vecmory/Plan-draft.md)
- [summary_vm.md](https://github.com/ideav/crm/blob/main/vecmory/summary_vm.md)
- [mcp-deploy-report.md](https://github.com/ideav/crm/blob/main/vecmory/mcp-deploy-report.md)
- [vecmory_deck.md](https://github.com/ideav/crm/blob/main/vecmory/vecmory_deck.md)
- Gap-анализ Node.js ядра (shared chat Alex)
- [docs/kb/](https://github.com/ideav/crm/tree/main/docs/kb) — API reference
- [mcp-server/index.js](https://github.com/ideav/crm/blob/main/mcp-server/index.js) — reference для Integram API patterns

---

## 1. Архитектура

```
Claude Code / AI-агент
        |
        | MCP stdio
        v
┌─────────────────────────────────┐
│  vecmory (npm, MCP-сервер)       │
│                                   │
│  MCP layer     — тулзы наружу    │
│  Embedder      — @xenova/transformers, 384-dim, CPU │
│  MemoryGraph   — узлы + типизированные рёбра        │
│  SearchEngine  — cosine brute-force, позже graph-ANN │
│  DecayManager  — затухание неиспользуемых узлов      │
│  IntegramHTTP  — HTTP-клиент напрямую к Integram API │
└────────────┬────────────────────┘
             |
             | HTTP (fetch)
             v
┌─────────────────────────────────┐
│  Integram PHP-бэкенд             │
│                                   │
│  POST /{db}/_m_new/{tableId}     │   создание записи
│  POST /{db}/_m_set/{recordId}    │   обновление записи
│  POST /{db}/_m_del/{recordId}    │   удаление записи
│  GET  /{db}/object/{tableId}/    │   чтение записей (JSON_KV)
│  GET  /{db}/report/{id}?JSON_KV  │   отчёты, формульные колонки
│  GET  /{db}/metadata/{tableId}   │   схема таблицы
│  GET  /{db}/xsrf?JSON=1          │   аутентификация по токену
└─────────────────────────────────┘
```

Никаких посредников. Один процесс, один пакет.

---

## 2. Integram HTTP Client

Прямой HTTP-клиент к Integram PHP API. Паттерны взяты из
[mcp-server/index.js](https://github.com/ideav/crm/blob/main/mcp-server/index.js)
и [docs/kb/](https://github.com/ideav/crm/tree/main/docs/kb).

### 2.1. Аутентификация

```
GET {baseUrl}/{db}/xsrf?JSON=1
Headers: X-Authorization: {token}
Response: { _xsrf, token, user, role, id }
```

Токен — строка из поля «Токен» (t125) пользователя Integram. Капча не требуется.
`_xsrf` обязателен для всех POST `_m_*`/`_d_*` операций.
Автопереподключение при истечении сессии (детекция по HTML login-страницы в ответе).

### 2.2. CRUD записей

| Операция | HTTP | Endpoint | Body |
|----------|------|----------|------|
| Создать запись | POST | `/{db}/_m_new/{tableId}?JSON=1` | FormData: `token`, `_xsrf`, `up=1`, `t{colId}=value` |
| Обновить поля | POST | `/{db}/_m_set/{recordId}?JSON=1` | FormData: `token`, `_xsrf`, `t{colId}=value` |
| Удалить запись | POST | `/{db}/_m_del/{recordId}?JSON=1` | FormData: `token`, `_xsrf` |
| Получить запись | GET | `/{db}/object/{tableId}/?JSON_KV&F_I={recordId}` | — |
| Список записей | GET | `/{db}/object/{tableId}/?JSON_KV` | — |
| Кол-во записей | GET | `/{db}/object/{tableId}/?JSON_KV&_count=` | — |

Формат ответа LIST/GET: `{ object: [{id, val, up, base}], reqs: { recordId: { colId: value } } }`.
Поля записей в `reqs`, не в `object`. Клиент мержит `reqs[id]` в объект как `t{colId}`.
Batch delete API нет — удаляем по одному через `_m_del`.

### 2.3. Neighbors (рёбра графа)

Поле `neighbors` — MEMO (не MULTISELECT), хранит JSON-массив ID соседей.
Поле `edge_types` — MEMO, хранит JSON `{ "nodeId": "SIMILAR_TO" }`.
Обновление: `_m_set/{id}` с `t724962=<JSON>` и `t724992=<JSON>`.

### 2.4. Batch-импорт (DATA-формат)

```
POST /{db}/object/{tableId}?JSON&import=1
Content-Type: multipart/form-data
Field: bki_file — файл формата:

DATA
record_name;field1_value;field2_value;...;
record_name;field1_value;field2_value;...;
```

Правила:
- Первая строка строго `DATA`
- Поля через `;`, порядок по metadata таблицы
- Каждая строка заканчивается `;`
- Reference-поля — имя целевой записи (не ID), авторезолв
- Multi-reference — через запятую: `name1,name2,name3`
- Лимит 8 МБ на запрос, чанкинг для больших объёмов
- UTF-8

### 2.5. Отчёты

```
GET /{db}/report/{id}?JSON_KV                    — данные как массив объектов
GET /{db}/report/{id}?JSON_KV&FR_{col}={val}     — с фильтром
GET /{db}/report/{id}?JSON_KV&FR_{col}=>{val}    — больше чем
```

Отчёт = запись типа 22. Колонки = записи типа 28. FROM = записи типа 44.

### 2.6. Формульная колонка (тип 101) — серверный косинус

Колонка отчёта с формулой:
```
JSON_EXTRACT(embedding, '$[0]') * {q0} + JSON_EXTRACT(embedding, '$[1]') * {q1} + ... + JSON_EXTRACT(embedding, '$[383]') * {q383}
```

Вектор запроса передаётся как runtime-параметры. Результат = cosine score.
Сортировка DESC, LIMIT topK. Один HTTP-вызов = серверный косинус по всему корпусу.

### 2.7. RECURSIVE-отчёт — серверный граф-обход

Колонка с `REP_COL_FUNC = "RECURSIVE"` генерирует:
```sql
WITH RECURSIVE c AS (
  SELECT id, neighbors FROM mem WHERE id = :startId
  UNION ALL
  SELECT m.id, m.neighbors FROM mem m JOIN c ON m.id = ANY(c.neighbors)
)
SELECT * FROM c LIMIT :maxNodes
```

Один HTTP-вызов = обход графа на N шагов (~0.3с вместо ~33с клиентского BFS).

### 2.8. Суб-отчёты — композиция

`[report_name]` в поле FROM отчёта = встроенный sub-select.
Пайплайн: `cosine top-k → graph traversal` за один серверный вызов.

### 2.9. Метаданные

```
GET /{db}/metadata/{tableId}?JSON=1   — схема таблицы (порядок полей для DATA-импорта)
GET /{db}/dict?JSON                   — список таблиц
```

---

## 3. Структура узла (Node)

Каждый узел — запись в таблице Integram с реквизитами:

| Поле | Тип в Integram | Описание |
|------|----------------|----------|
| `raw_input` | SHORT (3) | Исходный текст |
| `cleaned_query` | MEMO (12) | Очищенный текст (без ID, стоп-слов) |
| `embedding` | MEMO (12) | Вектор 384-dim как JSON-массив |
| `domain` | SHORT (3) | Категория: `integrations`, `infra`, `project_X` |
| `topic` | SHORT (3) | Тип: `bug_fix`, `feature_request`, `question` |
| `essence` | SHORT (3) | 1-3 ключевых слова |
| `popularity_counter` | NUMBER (13) | Счётчик обращений |
| `decay_score` | NUMBER (13) | Коэффициент затухания (0.0-1.0) |
| `importance_weight` | NUMBER (13) | Агрегированный вес важности |
| `neighbors` | MEMO (12) | JSON-массив ID соседей |
| `edge_types` | MEMO (12) | JSON: `{ "node_id": "SIMILAR_TO", ... }` |

---

## 4. Типы рёбер

| Тип | Описание | Когда создаётся |
|-----|----------|-----------------|
| `SIMILAR_TO` | Семантическая близость (cosine) | Автоматически при записи (top-k соседей) |
| `CAUSED_BY` | Каузальная связь (баг -> причина) | Явно при записи или LLM-классификацией |
| `FOLLOWED_BY` | Временная последовательность | Автоматически (следующий запрос в сессии) |
| `BELONGS_TO` | Принадлежность к проекту/домену | По полю `domain` |
| `REFERENCES` | Упоминание тех же сущностей | По совпадению `essence` |

Хранение: `neighbors` (MEMO) = JSON-массив ID соседей,
`edge_types` (MEMO) = JSON `{ "node_id": "тип" }`.

---

## 5. MCP-тулзы

| Тулза | Параметры | Описание |
|-------|-----------|----------|
| `recall` | `query: string, k?: number` | Семантический поиск + гирлянда |
| `remember` | `text: string, domain?: string, topic?: string, essence?: string[]` | Записать в память |
| `forget` | `nodeId: number` | Удалить узел и рёбра |
| `memory_status` | — | Статистика: total, withNeighbors, recentDay, avgDegree, byDomain |

Агент шлёт текст, не векторы. Эмбеддинг на стороне сервера.

---

## 6. Внутренние методы ядра

### remember(text, meta?)

Pipeline:
1. Очистка текста (удаление ID, магических чисел, стоп-слов)
2. Эмбеддинг (`model.embed(cleaned)`) — 384-dim, L2-нормализация
3. Поиск top-k соседей по косинусу (brute-force или через формульный отчёт)
4. Создание записи в Integram (`_m_new`)
5. Добавление рёбер `SIMILAR_TO` к top-k (multiselect neighbors + edge_types JSON)
6. Добавление обратных рёбер у соседей
7. Если `edgeType` указан явно — типизированное ребро
8. Return `{ id, neighbors, scores }`

### recall(query, k?)

Pipeline:
1. Эмбеддинг запроса
2. Cosine top-k (brute-force или формульный отчёт)
3. Обход рёбер на `garlandDepth` шагов (клиентский BFS или RECURSIVE-отчёт)
4. Bump `popularity_counter`, reset `decay_score` у затронутых
5. Усиление веса пройденных рёбер
6. Дедупликация, сортировка по score
7. Return `{ nodes: [...], garland: "...", total }`

### garland(nodeId, depth?)

Обход графа от узла. Возвращает цепочку `[{ id, text, edgeType, depth }]`.

### decay()

- `decay_score *= decayRate` для всех узлов
- Узлы с `decay_score < threshold` и `popularity_counter <= 1` — архивируются
- Return `{ archived, total }`

### batchImport(records)

Формирует DATA-файл, отправляет `POST ?import=1`.
Если `embedding` не передан — считает локально.
Соседи вычисляются после импорта (отдельный проход).

### status()

Собирает из нескольких запросов:
- `count` — общее кол-во
- отчёт по `neighbors` — кол-во с рёбрами, средняя степень
- фильтр по дате — свежие за сутки
- группировка по `domain`

---

## 7. Эмбеддер

Модель: `Xenova/paraphrase-multilingual-MiniLM-L12-v2`
- 384 dimensions
- Мультиязычная (русский, английский)
- ONNX runtime, CPU
- Должна совпадать с моделью, которой закодирован корпус (критично для recall)

Альтернатива: кастомная функция `embedFn: async (text) => Float32Array`.

---

## 8. Конфигурация

```env
# Integram connection
VECMORY_BASE_URL=https://ideav.ru
VECMORY_TOKEN=your-token
VECMORY_DB=mem
VECMORY_TABLE_ID=724958

# Embedder
VECMORY_MODEL=Xenova/paraphrase-multilingual-MiniLM-L12-v2

# Search
VECMORY_TOP_K=16
VECMORY_GARLAND_DEPTH=2

# Decay
VECMORY_DECAY_RATE=0.95
VECMORY_DECAY_THRESHOLD=0.1
```

---

## 9. Структура пакета

```
vecmory/
  src/
    index.js              — точка входа, VecMory class
    mcp-server.js         — MCP stdio сервер (4 тулзы)
    integram-client.js    — HTTP-клиент к Integram API (auth, CRUD, reports, import)
    embedder.js           — @xenova/transformers wrapper
    search.js             — cosine brute-force + серверный косинус через отчёт
    graph.js              — рёбра, garland, обход
    decay.js              — затухание, архивация
    cleaner.js            — очистка текста
  hooks/
    pre-recall.js         — хук UserPromptSubmit → recall
    post-remember.js      — хук Stop → remember
  test/
    recall.test.js
    remember.test.js
    decay.test.js
    cosine.test.js        — сверка с numpy-эталоном
    integram-client.test.js
  package.json
  .env.example
  README.md
```

---

## 10. Зависимости

| Пакет | Зачем |
|-------|-------|
| `@xenova/transformers` | Локальный эмбеддинг (ONNX, CPU) |
| `@modelcontextprotocol/sdk` | MCP-сервер |

HTTP через `node:fetch` (Node 18+). Минимум зависимостей.

---

## 11. Хуки Claude Code (опционально)

`.claude/hooks.json`:
```json
{
  "hooks": {
    "UserPromptSubmit": [{
      "command": "node /path/to/vecmory/hooks/pre-recall.js \"$PROMPT\""
    }],
    "Stop": [{
      "command": "node /path/to/vecmory/hooks/post-remember.js \"$SUMMARY\""
    }]
  }
}
```

- `pre-recall.js` — recall(prompt) → top-k в stdout → подмешивается в контекст
- `post-remember.js` — извлечь урок → remember(lesson)
- Тумблер: env-флаг `VECMORY_AUTO=1|0` для A/B

---

## 12. Тестирование

### Уровень 1 — recall корректность
- 20-50 пар `запрос -> ожидаемая запись`
- Метрика: recall@k
- Сверка косинуса с numpy (до 5 знака)
- Ранжирование по рангу, не по порогу (базовый косинус ~0.8+)

### Уровень 2 — A/B «с памятью / без»
- 10-20 задач с засеянным корпусом граблей
- Метрики: повтор ошибки, итерации до решения, время, вердикт оператора
- Контрольные задачи (память не должна мешать)

---

## 13. Gap-анализ: что нужно от Integram API

Из shared chat Alex — 10 пунктов, 4 критичных:

| # | Gap | Приоритет | Статус в спеке |
|---|-----|-----------|----------------|
| 1 | batchImport (DATA-формат) | Критично | s2.4 — описан |
| 2 | Формульные колонки (тип 101) для серверного косинуса | Критично | s2.6 — описан |
| 3 | Передача вектора запроса в runtime отчёта | Критично | s2.6 — описан |
| 4 | RECURSIVE для серверного графа | Критично | s2.7 — описан |
| 5 | Локальный эмбеддер | Важно | s7 — @xenova/transformers |
| 6 | setNeighborsBulk | Важно | s6 remember pipeline шаг 5-6 |
| 7 | Суб-отчёты [name] | Важно | s2.8 — описан |
| 8 | deleteBatch | Желательно | нет batch API — удаляем по одному через _m_del |
| 9 | Атомарный инкремент | Желательно | s6 touch — read+write (race ok для MVP) |
| 10 | memoryStatus composite | Мелкое | s6 status — несколько запросов |

Все 10 gap'ов покрыты.

---

## 14. Этапы реализации

### Этап 1 — MVP
- [ ] `integram-client.js` — auth, CRUD, execute_report, metadata
- [ ] `embedder.js` — загрузка модели, embed()
- [ ] `search.js` — cosine brute-force (клиентский)
- [ ] `mcp-server.js` — recall, remember, memory_status
- [ ] Тесты: roundtrip remember→recall, cosine sanity

### Этап 2 — граф
- [ ] `graph.js` — типизированные рёбра, garland()
- [ ] Автосвязывание при remember (SIMILAR_TO)
- [ ] FOLLOWED_BY для последовательных записей
- [ ] forget() с очисткой рёбер
- [ ] Тесты: garland depth, edge types

### Этап 3 — decay + batch
- [ ] `decay.js` — decay(), архивация
- [ ] `batchImport()` — DATA-формат
- [ ] `cleaner.js` — очистка текста
- [ ] Тесты: decay lifecycle, batch import

### Этап 4 — серверная оптимизация
- [ ] Формульный отчёт для серверного косинуса (тип 101)
- [ ] RECURSIVE-отчёт для графа
- [ ] Суб-отчёт [name] для пайплайна cosine→graph
- [ ] Graph-ANN (переключение с brute-force)

### Этап 5 — хуки + A/B
- [ ] Хуки Claude Code (pre-recall, post-remember)
- [ ] Тумблер VECMORY_AUTO
- [ ] A/B тестирование по методике s12
