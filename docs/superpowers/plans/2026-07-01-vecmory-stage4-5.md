# VecMory — План: Этапы 4-5 + баги из аудита

> Результат аудита спеки vs код от 2026-07-01.
> Перепроверено по PHP-движку (`../crm/index.php`) и mcp-server (`../crm/mcp-server/index.js`).
> Всё ниже реализуемо без участия Alex'а — API Integram уже поддерживает:
> - Формульные колонки: `t101` (REP_COL_FORMULA, define 101 в PHP)
> - Computed columns: `fieldId: 0` + `formula` + `set` (t132)
> - RECURSIVE: `REP_COL_FUNC` (define 63 в PHP), проверка `=== "RECURSIVE"` на строке 3734
> - Суб-отчёты: `[имя_отчёта]` в поле FROM (t102), строка 3748 PHP
> - mcp-server: `integram_create_report`, `integram_add_report_column` (t101), `integram_add_report_from`, `integram_execute_report`
>
> **Маппинг реквизитов колонки отчёта (тип 28):**
> | PHP define | Реквизит | mcp-server поле | Назначение |
> |---|---|---|---|
> | REP_COL_NAME (100) | t100 | nameInReport | Имя в отчёте (ключ в JSON_KV, alias для FR_) |
> | REP_COL_FORMULA (101) | t101 | formula | Формула / алиас поля |
> | REP_COL_FROM (102) | t102 | — | Фильтр FROM |
> | REP_COL_TO (103) | t103 | — | Фильтр TO |
> | REP_COL_FUNC (63) | t104 (ссылка на тип 63) | functionId | Функция: SUM, COUNT, RECURSIVE, abn_ID(85) |
> | REP_COL_HIDE (107) | t107 | hide | Скрыть колонку |
> | — | t109 | sort | Сортировка |
> | — | t132 | set | SET-выражение для вычисляемых колонок |
> | REP_COL_ALIAS (58) | t58 | alias | ALIAS колонки |

---

## Приоритет 0: Баги из аудита (блокеры)

### 0.1 edgeType не пробрасывается через MCP
**Проблема:** `index.js:86` принимает `meta.edgeType`, но MCP-тулза `remember` не выставляет этот параметр. Нельзя создать ребро `CAUSED_BY` через MCP.
**Файл:** `src/mcp-server.js`
**Фикс:** добавить `edgeType` в inputSchema тулзы `remember` и передать в `vm.remember()`.
```js
// mcp-server.js — в TOOLS[1].inputSchema.properties добавить:
edgeType: { type: 'string', description: 'Edge type: SIMILAR_TO, CAUSED_BY, FOLLOWED_BY, BELONGS_TO, REFERENCES' }

// В case 'remember' передать:
const result = await vm.remember(args.text, {
  domain: args.domain,
  topic: args.topic,
  essence: args.essence,
  edgeType: args.edgeType,
});
```
**Тест:** вызвать `remember` с `edgeType: 'CAUSED_BY'`, затем `recall` — проверить что ребро типизировано.
**Время:** 10 минут.

### 0.2 recall — результаты не сортируются по score
**Проблема:** спека s6 шаг 6 говорит «дедупликация, сортировка по score», garland дедуплицирует, но итоговый `nodes` не сортируется.
**Файл:** `src/index.js`, метод `recall()`
**Фикс:** после формирования `nodes` добавить `.sort((a, b) => (b.score ?? 0) - (a.score ?? 0))`.
**Время:** 5 минут.

### 0.3 val vs t{tableId} при create
**Проблема:** `create()` пишет `val: text.slice(0,200)`, но по документации Integram главное значение записи = `t{tableId}`. Сейчас работает случайно.
**Файл:** `src/index.js`, метод `remember()`
**Фикс:** добавить `[f.tableId || 't' + client.tableId]: text.slice(0, 200)` или передавать через `t{tableId}` в create.
**Время:** 15 минут.

### 0.4 list() без пагинации
**Проблема:** `client.list()` не использует `LIMIT/pg`. На большом корпусе не вернёт все записи.
**Файл:** `src/integram-client.js`, метод `list()`
**Фикс:** добавить цикл пагинации `LIMIT=200&pg=1`, `pg=2`, ... пока `object.length > 0`. Дедупликация по id (документированная грабля Integram).
**Время:** 30 минут.

### 0.5 remember() делает N+1 HTTP-запросов
**Проблема:** для каждого из topK=16 соседей — отдельный `get()` + `update()`. Это 32+ запроса на один `remember`.
**Файл:** `src/index.js`, метод `remember()`
**Фикс:** загрузить всех соседей одним `list()` (уже в памяти от поиска), использовать кеш `nodeMap`, не вызывать `get()` повторно.
**Время:** 30 минут.

---

## Этап 4: Серверная оптимизация

### 4.1 Серверный косинус через формульную колонку
**Что:** Создать отчёт в Integram с формульной колонкой (t101) для вычисления cosine similarity на сервере. Вместо brute-force на клиенте (тянуть все векторы → считать косинус) — один HTTP-вызов.

**Как это работает в PHP-движке:**
- Колонка отчёта (тип 28) с `fieldId: 0` (computed) и `t101` = SQL-формула
- Формула: `JSON_EXTRACT(vec_field, '$[0]') * {q0} + JSON_EXTRACT(vec_field, '$[1]') * {q1} + ...`
- Вектор запроса передаётся через `FR_` фильтры или через runtime параметры SELECT
- PHP строит SQL с формулой как вычисляемую колонку, сортирует DESC, LIMIT topK
- summary_vm.md: «Топ-5 совпал с эталоном numpy. Форк движка не нужен.»

**Через mcp-server API (уже работает):**
```js
// 1. Создать отчёт
integram_create_report({
  name: 'vecmory_cosine',
  fromTables: [{ tableId: 724958 }],  // VecMoryNodes
  columns: [
    { fieldId: 0, nameInReport: 'id', formula: 'abn_ID' },  // ID записи
    { fieldId: 0, nameInReport: 'score',
      formula: "JSON_EXTRACT(t724960,'$[0]')*{q0}+JSON_EXTRACT(t724960,'$[1]')*{q1}+...+JSON_EXTRACT(t724960,'$[383]')*{q383}" },
    { fieldId: 724959, nameInReport: 'text' },  // поле text
  ],
  orderBy: 'score DESC',
  limit: '16'
})

// 2. Вызвать с вектором запроса
integram_execute_report({ reportId, params: { q0: 0.123, q1: -0.456, ... } })
```

**Как передать вектор запроса (384 чисел) в формулу:**

Формула в `t101` — это сырой SQL, без runtime-подстановки `{q0}`. PHP (строка 2916) подставляет
формулу как есть: `$field = $GLOBALS["STORED_REPS"][$id][REP_COL_FORMULA][$key]`.
Подстановка `[alias]` → реальное поле SQL (строка 3557). Но подстановки пользовательских
параметров **нет**.

**Рабочий вариант:** перезаписывать `t101` формулу через `_m_set/{colId}` перед каждым вызовом
отчёта, подставив конкретные числа вектора запроса прямо в SQL:
```
JSON_EXTRACT([vec],'$[0]')*0.123 + JSON_EXTRACT([vec],'$[1]')*-0.456 + ...
```
Где `[vec]` — alias колонки вектора (PHP заменит на реальное поле).
Два HTTP-вызова: `_m_set` (обновить формулу) → `report/` (выполнить).

**Альтернатива:** создавать формулу с WHERE-фильтром, но 384 числа в URL — это ~3KB, может
превысить лимит URL. POST с FormData надёжнее.

**Итого:** серверный косинус работает, но требует `_m_set` перед каждым `report/` — два вызова
вместо одного. Всё равно быстрее чем тянуть все векторы на клиент.

**Файлы:**
- `src/integram-client.js` — добавить `createReport()`, `addReportColumn()`, `addReportFrom()`
- `src/index.js` — `recall()` и `remember()` переключаются на `report()` если `cosineReportId` задан
- `src/search.js` — экспортировать `buildCosineFormula(dims)` для генерации SQL

**Тесты:** создать отчёт на live, выполнить, сравнить top-k с brute-force. Должны совпасть.
**Время:** 1-2 дня (+ время на выяснение формата передачи вектора).

### 4.2 RECURSIVE-отчёт для серверного графа
**Что:** Заменить клиентский BFS (N HTTP-запросов на каждый hop) одним серверным вызовом.

**Как работает в PHP (index.php:3734):**
- Первая колонка отчёта должна иметь `REP_COL_FUNC` = `"RECURSIVE"` (функция в t104)
- PHP проверяет: `$GLOBALS["STORED_REPS"][$id][REP_COL_FUNC][1] === "RECURSIVE"`
- Генерирует `WITH RECURSIVE c AS (SELECT id, 0 t FROM ... WHERE ... UNION SELECT ...)` автоматически
- Суб-отчёт в FROM: если `t102` (REP_COL_FROM) = `[имя_отчёта]`, PHP подставляет результат другого отчёта как `AND id IN(sub_query)`
- Фильтр стартовой точки: через `FR_{имя_колонки}=id` (стандартный механизм фильтров)
- LIMIT передаётся через `?LIMIT=N`

**Через mcp-server API:**
```js
// 1. Создать RECURSIVE отчёт
integram_create_report({
  name: 'vecmory_graph',
  fromTables: [{ tableId: 724958 }],
  columns: [
    {
      fieldId: 724962,         // neighbors field
      nameInReport: 'node_id',
      functionId: ???          // нужно найти ID записи "RECURSIVE" в таблице функций (тип 63)
    }
  ]
})
// 2. Вызвать с фильтром стартовой ноды
integram_execute_report({ reportId, params: { FR_node_id: startId, LIMIT: maxNodes } })
```

**Как задать RECURSIVE:**
PHP (строка 2458-2467) поддерживает параметр `?SELECT=колонка:ФУНКЦИЯ` при вызове отчёта.
Функция применяется динамически: `$new_funcs[col_index] = strtoupper($f[1])`.
Значит можно: `report/{id}?JSON_KV&SELECT=node_id:RECURSIVE` — без сохранения в t104.
Альтернативно можно задать статически в t104 при создании колонки.

**КРИТИЧЕСКАЯ ПРОБЛЕМА: RECURSIVE не совместим с нашей структурой.**
PHP (строки 3765-3770) генерирует два варианта CTE:
1. Для ссылочных полей (`references`): `JOIN c ON c.id=ref.t WHERE ref.val='{ref_req}'`
2. Для подчинённых таблиц: `JOIN c ON c.id=ref.up WHERE ref.t=$typ`

Оба варианта работают через **структурные связи Integram** (parent-child `up` или ссылочные
реквизиты), а **не через JSON-массив**. Наш `neighbors` — это MEMO поле с `[id1, id2, id3]`,
не ссылочный реквизит и не parent-child.

**Вывод:** RECURSIVE отчёт **не подходит** для обхода графа VecMory в текущей структуре данных.

**Альтернативы:**
1. Оставить клиентский BFS (текущая реализация). На малом корпусе (<1000) — достаточно.
2. Переделать `neighbors` с MEMO на ссылочный реквизит (multi-ref). Это **ломает** текущую
   структуру — нужно согласовать с Alex'ом.
3. Сделать серверный обход через SET-отчёт (тип 132): итеративно вызывать косинус-отчёт,
   подставляя id найденных нод. Не один вызов, но меньше чем N round-trips.

**Файлы:**
- `src/graph.js` — `garland()` принимает опциональный `reportFn`, fallback на BFS
- `src/index.js` — передавать `reportFn` если `recursiveReportId` задан

**Время:** 1 день (+ исследование совместимости RECURSIVE с JSON neighbors).

### 4.3 Суб-отчёт cosine → graph
**Что:** Композиция: сначала cosine top-k, потом граф-обход от найденных — один HTTP-вызов.

**Как работает в PHP (index.php:3748):**
- В поле FROM первой колонки (`t102`, REP_COL_FROM) пишем `[имя_отчёта]`
- PHP вызывает `Get_block_data($sub_query, FALSE)` для вложенного отчёта
- Результат подставляется как `AND id IN(sub_query_sql)`
- Т.е. cosine top-k отдаёт список id → RECURSIVE фильтрует по ним

**Зависимости:** 4.1 должен работать. 4.2 (RECURSIVE) **не работает** с JSON neighbors.
**Без 4.2 суб-отчёт cosine→graph невозможен** в один вызов — нет серверного графа для композиции.
**Статус: ЗАБЛОКИРОВАН** до решения вопроса с neighbors (MEMO vs multi-ref).
**Время:** 0.5 дня (если 4.2 решён).

---

## Этап 5: Хуки + автоматизация

### 5.1 FOLLOWED_BY — автосвязывание последовательных записей
**Что:** При вызове `remember()` в одной сессии — автоматическое ребро `FOLLOWED_BY` к предыдущей записи.

**Как:**
1. `VecMory` хранит `#lastRememberedId` (в памяти процесса).
2. При `remember()` — если `#lastRememberedId` существует, добавить ребро `FOLLOWED_BY` в обе стороны.
3. MCP-тулза может передавать `sessionId` для разделения сессий.

**Файлы:** `src/index.js`
**Время:** 30 минут.

### 5.2 Хуки Claude Code (авто-recall, авто-remember)
**Что:** Два скрипта — при каждом промпте автоматически recall, при завершении автоматически remember.

**Файлы создать:**
- `hooks/pre-recall.sh` — вызывает `recall(prompt)`, stdout подмешивается в контекст
- `hooks/post-remember.sh` — вызывает `remember(summary)` после Stop

**Как работает:**
```bash
# hooks/pre-recall.sh
#!/usr/bin/env bash
[ "${VECMORY_AUTO:-1}" = "0" ] && exit 0
PROMPT="$1"
node -e "
  import('./src/index.js').then(async ({ VecMory }) => {
    // ... init, recall, print to stdout
  });
" "$PROMPT" 2>/dev/null
```

**Регистрация в `.claude/settings.json`:**
```json
"hooks": {
  "UserPromptSubmit": [{ "hooks": [{ "type": "command", "command": "bash /path/to/vecmory/hooks/pre-recall.sh" }] }],
  "Stop": [{ "hooks": [{ "type": "command", "command": "bash /path/to/vecmory/hooks/post-remember.sh" }] }]
}
```

**Graceful fallback:** если бэкенд недоступен — exit 1, Claude Code покажет warning но продолжит.
**Время:** 2-3 часа.

### 5.3 Тумблер VECMORY_AUTO
**Что:** env-флаг `VECMORY_AUTO=1|0`. Хуки проверяют и пропускают если `0`.
**Время:** 5 минут (уже в примере выше).

### 5.4 cosine.test.js — сверка с numpy
**Что:** Спека s12 описывает сверку косинуса с numpy до 5 знака. Тест не создан.
**Файл создать:** `test/cosine-numpy.test.js`
**Как:** захардкодить 5-10 пар векторов + numpy-эталон, сравнить с `findTopK()`.
**Время:** 1 час.

---

## Порядок выполнения

```
0.1 edgeType в MCP          (10 мин)     ← блокер
0.2 sort по score            (5 мин)      ← блокер
0.3 val → t{tableId}         (15 мин)     ← блокер
0.4 пагинация list()         (30 мин)     ← блокер
0.5 N+1 → кеш в remember()  (30 мин)     ← блокер
─────────────────────────────────────────
5.1 FOLLOWED_BY              (30 мин)     ← быстрая фича
4.1 серверный косинус         (1-2 дня)    ← главная оптимизация (два HTTP: _m_set + report/)
4.2 RECURSIVE граф            ЗАБЛОКИРОВАН ← neighbors=MEMO, не ссылка. Нужно решение с Alex'ом
4.3 суб-отчёт cosine→graph   ЗАБЛОКИРОВАН ← зависит от 4.2
─────────────────────────────────────────
5.2 хуки Claude Code          (2-3 часа)   ← после всего
5.3 тумблер                   (5 мин)
5.4 cosine numpy test         (1 час)
```

**Итого реализуемого:** ~2-3 дня.
- Баги (0.1-0.5) — первый день
- Серверный косинус (4.1) — 1-2 дня
- FOLLOWED_BY + хуки + тест — полдня

**Заблокировано (нужен Alex):**
- 4.2 RECURSIVE — PHP-движок обходит граф через parent-child (up) или ссылочные реквизиты,
  а наш neighbors — MEMO с JSON-массивом. Нужно либо переделать neighbors на multi-ref,
  либо отказаться от серверного графа.
- 4.3 Суб-отчёт — зависит от 4.2.
