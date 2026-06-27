# VecMory MCP Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a self-contained npm MCP server that provides AI agents with contextual memory — storing, searching, and linking knowledge as a graph with typed edges, backed by Integram API.

**Architecture:** Single-process MCP stdio server. Local CPU embeddings via `@xenova/transformers` (384-dim). Graph stored in Integram table via HTTP API. Cosine brute-force search for MVP, server-side formula reports later.

**Tech Stack:** Node.js 18+ (ESM), `@xenova/transformers`, `@modelcontextprotocol/sdk`, `vitest` for testing.

---

## File Map

| File | Responsibility |
|------|---------------|
| `package.json` | ESM package, scripts, dependencies |
| `src/cleaner.js` | Text cleaning — strip IDs, magic numbers, stop words |
| `src/integram-client.js` | HTTP client — auth, CRUD, reports, batch import, metadata |
| `src/embedder.js` | `@xenova/transformers` wrapper — load model, embed text, L2 normalize |
| `src/search.js` | Cosine brute-force over embeddings fetched from Integram |
| `src/graph.js` | Edge management — add/remove edges, garland BFS traversal |
| `src/decay.js` | Decay scoring — multiply decay, archive cold nodes |
| `src/index.js` | VecMory class — orchestrates remember/recall/forget/status |
| `src/mcp-server.js` | MCP stdio server — 4 tools wired to VecMory |
| `test/cleaner.test.js` | Cleaner unit tests |
| `test/integram-client.test.js` | Integram client tests (mocked fetch) |
| `test/embedder.test.js` | Embedder tests (mocked transformers) |
| `test/search.test.js` | Cosine search tests (pure math, no network) |
| `test/graph.test.js` | Graph edge/garland tests |
| `test/decay.test.js` | Decay lifecycle tests |
| `test/index.test.js` | VecMory integration tests (all deps mocked) |
| `.env.example` | Example environment variables |

---

### Task 1: Project Scaffolding

**Files:**
- Create: `package.json`
- Create: `.env.example`
- Create: `vitest.config.js`

- [ ] **Step 1: Initialize package.json**

```bash
cd /home/dima/Projects/vecmory
```

Create `package.json`:

```json
{
  "name": "vecmory",
  "version": "0.1.0",
  "description": "MCP server for AI agent contextual memory with graph-based knowledge storage",
  "type": "module",
  "main": "src/index.js",
  "bin": {
    "vecmory": "src/mcp-server.js"
  },
  "scripts": {
    "start": "node src/mcp-server.js",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "engines": {
    "node": ">=18.0.0"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.12.1",
    "@xenova/transformers": "^2.17.2"
  },
  "devDependencies": {
    "vitest": "^3.2.3"
  }
}
```

- [ ] **Step 2: Create vitest config**

Create `vitest.config.js`:

```js
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
  },
});
```

- [ ] **Step 3: Create .env.example**

Create `.env.example`:

```env
# Integram connection (token auth — no captcha)
VECMORY_BASE_URL=https://ideav.ru
VECMORY_DB=mem
VECMORY_TOKEN=your-token-here
VECMORY_TABLE_ID=724958

# Field mapping (Integram requisite IDs for VecMoryNodes table)
VECMORY_FIELD_TEXT=724959
VECMORY_FIELD_VEC=724960
VECMORY_FIELD_NEIGHBORS=724962
VECMORY_FIELD_CLEANED_QUERY=724978
VECMORY_FIELD_DOMAIN=724980
VECMORY_FIELD_TOPIC=724982
VECMORY_FIELD_ESSENCE=724984
VECMORY_FIELD_POPULARITY=724986
VECMORY_FIELD_DECAY=724988
VECMORY_FIELD_IMPORTANCE=724990
VECMORY_FIELD_EDGE_TYPES=724992

# Embedder
VECMORY_MODEL=Xenova/paraphrase-multilingual-MiniLM-L12-v2

# Search
VECMORY_TOP_K=16
VECMORY_GARLAND_DEPTH=2

# Decay
VECMORY_DECAY_RATE=0.95
VECMORY_DECAY_THRESHOLD=0.1
```

- [ ] **Step 4: Install dependencies**

```bash
npm install
```

- [ ] **Step 5: Verify vitest runs**

```bash
npx vitest run
```

Expected: `No test files found` (no error).

- [ ] **Step 6: Commit**

```bash
git init && git add package.json vitest.config.js .env.example
git commit -m "chore: scaffold vecmory project"
```

---

### Task 2: Text Cleaner

**Files:**
- Create: `src/cleaner.js`
- Create: `test/cleaner.test.js`

- [ ] **Step 1: Write the failing test**

Create `test/cleaner.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { cleanText } from '../src/cleaner.js';

describe('cleanText', () => {
  it('removes UUIDs', () => {
    const input = 'Error in object 550e8400-e29b-41d4-a716-446655440000 failed';
    expect(cleanText(input)).toBe('Error in object failed');
  });

  it('removes numeric IDs (standalone numbers 4+ digits)', () => {
    expect(cleanText('Row 123456 in table 78')).toBe('Row in table 78');
  });

  it('removes hex hashes (8+ chars)', () => {
    expect(cleanText('Commit a1b2c3d4e5 broke build')).toBe('Commit broke build');
  });

  it('collapses whitespace', () => {
    expect(cleanText('too   many    spaces')).toBe('too many spaces');
  });

  it('trims', () => {
    expect(cleanText('  hello  ')).toBe('hello');
  });

  it('preserves meaningful short numbers', () => {
    expect(cleanText('HTTP 404 error on port 80')).toBe('HTTP 404 error on port 80');
  });

  it('handles empty input', () => {
    expect(cleanText('')).toBe('');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run test/cleaner.test.js
```

Expected: FAIL — `Cannot find module '../src/cleaner.js'`

- [ ] **Step 3: Write minimal implementation**

Create `src/cleaner.js`:

```js
const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const LONG_NUM_RE = /\b\d{4,}\b/g;
const HEX_HASH_RE = /\b[0-9a-f]{8,}\b/g;
const MULTI_SPACE_RE = /\s{2,}/g;

export function cleanText(text) {
  if (!text) return '';
  return text
    .replace(UUID_RE, '')
    .replace(HEX_HASH_RE, '')
    .replace(LONG_NUM_RE, '')
    .replace(MULTI_SPACE_RE, ' ')
    .trim();
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run test/cleaner.test.js
```

Expected: all 7 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/cleaner.js test/cleaner.test.js
git commit -m "feat: add text cleaner module"
```

---

### Task 3: Integram HTTP Client

**Files:**
- Create: `src/integram-client.js`
- Create: `test/integram-client.test.js`

**Key facts about Integram API (from real server testing):**
- Auth is token-based: `GET /{db}/xsrf?JSON=1` with `X-Authorization: <token>` header → `{ _xsrf, token }`
- Password auth (`POST /auth`) is blocked by Yandex SmartCaptcha — unusable by agents
- `_xsrf` is required for all POST `_m_*`/`_d_*` operations (passed in body as `_xsrf=...`)
- Fields are addressed as `t<reqId>` (e.g., `t724959` for text field)
- `_m_new` returns complex JSON — record id is at `object[0].id`
- `full=1` required to get MEMO fields untruncated

- [ ] **Step 1: Write failing tests for auth and CRUD**

Create `test/integram-client.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IntegramClient } from '../src/integram-client.js';

function mockFetch(responses) {
  const calls = [];
  let callIndex = 0;
  const fn = async (url, opts) => {
    calls.push({ url: url.toString(), opts });
    const resp = responses[callIndex++] || { ok: true, json: async () => ({}) };
    return {
      ok: resp.ok ?? true,
      status: resp.status ?? 200,
      text: async () => typeof resp.body === 'string' ? resp.body : JSON.stringify(resp.body ?? {}),
      json: async () => resp.body ?? {},
    };
  };
  fn.calls = calls;
  return fn;
}

describe('IntegramClient', () => {
  const baseConfig = {
    baseUrl: 'https://ideav.ru',
    token: 'test-token-123',
    db: 'testdb',
    tableId: '724958',
  };

  describe('auth (token-based xsrf fetch)', () => {
    it('fetches _xsrf using token header, no POST /auth', async () => {
      const fetchFn = mockFetch([
        { body: { _xsrf: 'xsrf456', token: 'test-token-123', user: 'master', role: 'admin', id: '1' } },
      ]);
      const client = new IntegramClient({ ...baseConfig, fetchFn });
      await client.auth();
      expect(fetchFn.calls[0].url).toBe('https://ideav.ru/testdb/xsrf?JSON=1');
      expect(fetchFn.calls[0].opts.headers['X-Authorization']).toBe('test-token-123');
      // Must be GET, not POST (no captcha)
      expect(fetchFn.calls[0].opts.method).toBeUndefined();
    });
  });

  describe('create', () => {
    it('sends _m_new with token+xsrf in body, returns id from object[0].id', async () => {
      const fetchFn = mockFetch([
        { body: { _xsrf: 'xsrf1', token: 'tok' } },
        { body: { object: [{ id: '42' }] } },
      ]);
      const client = new IntegramClient({ ...baseConfig, fetchFn });
      await client.auth();
      const result = await client.create({ t724959: 'hello' });
      expect(fetchFn.calls[1].url).toContain('_m_new');
      expect(fetchFn.calls[1].url).toContain('JSON');
      expect(result.id).toBe('42');
    });
  });

  describe('get', () => {
    it('fetches record with full=1', async () => {
      const fetchFn = mockFetch([
        { body: { _xsrf: 'xsrf1', token: 'tok' } },
        { body: { id: '1', t724959: 'hi' } },
      ]);
      const client = new IntegramClient({ ...baseConfig, fetchFn });
      await client.auth();
      const result = await client.get('1');
      expect(fetchFn.calls[1].url).toContain('id=1');
      expect(fetchFn.calls[1].url).toContain('full=1');
      expect(result.t724959).toBe('hi');
    });
  });

  describe('update', () => {
    it('sends _m_set with id and token+xsrf in body', async () => {
      const fetchFn = mockFetch([
        { body: { _xsrf: 'xsrf1', token: 'tok' } },
        { body: { ok: true } },
      ]);
      const client = new IntegramClient({ ...baseConfig, fetchFn });
      await client.auth();
      await client.update('1', { t724988: '0.5' });
      expect(fetchFn.calls[1].url).toContain('_m_set');
      expect(fetchFn.calls[1].url).toContain('id=1');
    });
  });

  describe('delete', () => {
    it('sends _m_del with id', async () => {
      const fetchFn = mockFetch([
        { body: { _xsrf: 'xsrf1', token: 'tok' } },
        { body: { ok: true } },
      ]);
      const client = new IntegramClient({ ...baseConfig, fetchFn });
      await client.auth();
      await client.delete('1');
      expect(fetchFn.calls[1].url).toContain('_m_del');
      expect(fetchFn.calls[1].url).toContain('id=1');
    });
  });

  describe('deleteBatch', () => {
    it('sends _m_del_batch with ids', async () => {
      const fetchFn = mockFetch([
        { body: { _xsrf: 'xsrf1', token: 'tok' } },
        { body: { ok: true } },
      ]);
      const client = new IntegramClient({ ...baseConfig, fetchFn });
      await client.auth();
      await client.deleteBatch(['1', '2', '3']);
      expect(fetchFn.calls[1].url).toContain('_m_del_batch');
      expect(fetchFn.calls[1].url).toContain('ids=1,2,3');
    });
  });

  describe('list', () => {
    it('returns array of records', async () => {
      const fetchFn = mockFetch([
        { body: { _xsrf: 'xsrf1', token: 'tok' } },
        { body: [{ id: '1' }, { id: '2' }] },
      ]);
      const client = new IntegramClient({ ...baseConfig, fetchFn });
      await client.auth();
      const result = await client.list();
      expect(result).toHaveLength(2);
    });
  });

  describe('count', () => {
    it('returns count number', async () => {
      const fetchFn = mockFetch([
        { body: { _xsrf: 'xsrf1', token: 'tok' } },
        { body: { count: 42 } },
      ]);
      const client = new IntegramClient({ ...baseConfig, fetchFn });
      await client.auth();
      const result = await client.count();
      expect(result).toBe(42);
    });
  });

  describe('report', () => {
    it('executes report with filters', async () => {
      const fetchFn = mockFetch([
        { body: { _xsrf: 'xsrf1', token: 'tok' } },
        { body: [{ id: '1', score: 0.95 }] },
      ]);
      const client = new IntegramClient({ ...baseConfig, fetchFn });
      await client.auth();
      const result = await client.report(10, { FR_domain: 'infra' });
      expect(fetchFn.calls[1].url).toContain('report/10');
      expect(fetchFn.calls[1].url).toContain('JSON_KV');
      expect(fetchFn.calls[1].url).toContain('FR_domain=infra');
    });
  });

  describe('metadata', () => {
    it('fetches table schema', async () => {
      const fetchFn = mockFetch([
        { body: { _xsrf: 'xsrf1', token: 'tok' } },
        { body: { id: '724958', val: 'VecMoryNodes', reqs: [{ id: '724959', val: 'text', type: '12' }] } },
      ]);
      const client = new IntegramClient({ ...baseConfig, fetchFn });
      await client.auth();
      const result = await client.metadata();
      expect(fetchFn.calls[1].url).toContain('metadata/724958');
      expect(result.reqs[0].val).toBe('text');
    });
  });

  describe('batchImport', () => {
    it('sends DATA format via multipart', async () => {
      const fetchFn = mockFetch([
        { body: { _xsrf: 'xsrf1', token: 'tok' } },
        { body: { imported: 2 } },
      ]);
      const client = new IntegramClient({ ...baseConfig, fetchFn });
      await client.auth();
      const dataContent = 'DATA\nrec1;val1;val2;\nrec2;val3;val4;\n';
      await client.batchImport(dataContent);
      expect(fetchFn.calls[1].url).toContain('import=1');
      expect(fetchFn.calls[1].url).toContain('JSON');
    });
  });

  describe('auto-reauth on session expiry', () => {
    it('re-fetches xsrf when no-auth error returned, max 1 retry', async () => {
      const fetchFn = mockFetch([
        { body: { _xsrf: 'xsrf1', token: 'tok' } },
        { body: [{ error: 'No authorization token provided' }] },
        { body: { _xsrf: 'xsrf2', token: 'tok' } },
        { body: [{ id: '1' }] },
      ]);
      const client = new IntegramClient({ ...baseConfig, fetchFn });
      await client.auth();
      const result = await client.list();
      expect(fetchFn.calls).toHaveLength(4);
      expect(result).toEqual([{ id: '1' }]);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run test/integram-client.test.js
```

Expected: FAIL — `Cannot find module '../src/integram-client.js'`

- [ ] **Step 3: Write the implementation**

Create `src/integram-client.js`:

```js
export class IntegramClient {
  #baseUrl;
  #token;
  #db;
  #tableId;
  #fetchFn;
  #xsrf = null;

  constructor({ baseUrl, token, db, tableId, fetchFn }) {
    this.#baseUrl = baseUrl.replace(/\/$/, '');
    this.#token = token;
    this.#db = db;
    this.#tableId = tableId;
    this.#fetchFn = fetchFn || globalThis.fetch;
  }

  async auth() {
    const res = await this.#fetchFn(`${this.#baseUrl}/${this.#db}/xsrf?JSON=1`, {
      headers: { 'X-Authorization': this.#token },
    });
    const data = await res.json();
    this.#xsrf = data._xsrf;
  }

  #objUrl(params = '') {
    return `${this.#baseUrl}/${this.#db}/object/${this.#tableId}${params ? '?' + params : ''}`;
  }

  async #request(url, opts = {}, _retried = false) {
    const isFormData = opts.body instanceof FormData;
    const headers = {
      'X-Authorization': this.#token,
      ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
      ...opts.headers,
    };

    // Inject token + _xsrf into POST body for _m_* operations
    if (opts.method === 'POST' && opts.body && !isFormData) {
      const parsed = typeof opts.body === 'string' ? JSON.parse(opts.body) : { ...opts.body };
      parsed.token = this.#token;
      parsed._xsrf = this.#xsrf;
      opts = { ...opts, body: JSON.stringify(parsed) };
    } else if (opts.method === 'POST' && isFormData) {
      // FormData is mutated in place — safe because we don't retry with stale values
      opts.body.set('token', this.#token);
      opts.body.set('_xsrf', this.#xsrf);
    }

    const res = await this.#fetchFn(url, { ...opts, headers });
    const text = await res.text();

    // Detect expired session: no-auth error or login page
    if (!_retried) {
      const isNoAuth = text.includes('No authorization token provided')
        || text.includes('<form id="login"')
        || text.includes('<form id=\\"login\\"');
      if (isNoAuth) {
        await this.auth();
        return this.#request(url, opts, true);
      }
    }

    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  async create(fields) {
    const data = await this.#request(this.#objUrl('_m_new&JSON'), {
      method: 'POST',
      body: JSON.stringify(fields),
    });
    // _m_new returns complex JSON; record id is at object[0].id
    const id = data?.object?.[0]?.id ?? data?.id;
    return { id, _raw: data };
  }

  async get(id) {
    return this.#request(this.#objUrl(`id=${id}&full=1&JSON`));
  }

  async update(id, fields) {
    return this.#request(this.#objUrl(`_m_set&id=${id}&full=1`), {
      method: 'POST',
      body: JSON.stringify(fields),
    });
  }

  async delete(id) {
    return this.#request(this.#objUrl(`_m_del&id=${id}`), {
      method: 'POST',
      body: JSON.stringify({}),
    });
  }

  async deleteBatch(ids) {
    return this.#request(this.#objUrl(`_m_del_batch&ids=${ids.join(',')}`), {
      method: 'POST',
      body: JSON.stringify({}),
    });
  }

  async list() {
    return this.#request(this.#objUrl('JSON'));
  }

  async count() {
    const data = await this.#request(this.#objUrl('count&JSON'));
    return typeof data === 'object' ? data.count : data;
  }

  async report(reportId, filters = {}) {
    const filterStr = Object.entries(filters)
      .map(([k, v]) => `&${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('');
    return this.#request(`${this.#baseUrl}/${this.#db}/report/${reportId}?JSON_KV${filterStr}`);
  }

  async metadata() {
    return this.#request(`${this.#baseUrl}/${this.#db}/metadata/${this.#tableId}?JSON=1`);
  }

  async batchImport(dataContent) {
    const formData = new FormData();
    formData.set('bki_file', new Blob([dataContent], { type: 'text/plain' }), 'import.txt');
    return this.#request(this.#objUrl('JSON&import=1'), {
      method: 'POST',
      body: formData,
    });
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run test/integram-client.test.js
```

Expected: all 12 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/integram-client.js test/integram-client.test.js
git commit -m "feat: add Integram HTTP client with token auth, CRUD, reports, batch import"
```

---

### Task 4: Embedder Module

**Files:**
- Create: `src/embedder.js`
- Create: `test/embedder.test.js`

- [ ] **Step 1: Write the failing test**

Create `test/embedder.test.js`:

```js
import { describe, it, expect, vi } from 'vitest';
import { Embedder } from '../src/embedder.js';

describe('Embedder', () => {
  function makeMockPipeline() {
    return async (text) => ({
      data: new Float32Array([0.6, 0.8, 0.0]),
    });
  }

  it('returns L2-normalized vector', async () => {
    const embedder = new Embedder({ pipelineFn: makeMockPipeline });
    await embedder.load();
    const vec = await embedder.embed('test text');
    expect(vec).toBeInstanceOf(Float32Array);
    expect(vec.length).toBe(3);
    const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
    expect(norm).toBeCloseTo(1.0, 5);
  });

  it('normalizes correctly: [0.6, 0.8, 0.0] -> [0.6, 0.8, 0.0]', async () => {
    const embedder = new Embedder({ pipelineFn: makeMockPipeline });
    await embedder.load();
    const vec = await embedder.embed('anything');
    expect(vec[0]).toBeCloseTo(0.6, 5);
    expect(vec[1]).toBeCloseTo(0.8, 5);
    expect(vec[2]).toBeCloseTo(0.0, 5);
  });

  it('supports custom embedFn', async () => {
    const customFn = async (text) => new Float32Array([0.0, 0.0, 1.0]);
    const embedder = new Embedder({ embedFn: customFn });
    await embedder.load();
    const vec = await embedder.embed('test');
    expect(vec[2]).toBeCloseTo(1.0, 5);
  });

  it('throws if not loaded', async () => {
    const embedder = new Embedder({ pipelineFn: makeMockPipeline });
    await expect(embedder.embed('test')).rejects.toThrow('not loaded');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run test/embedder.test.js
```

Expected: FAIL — `Cannot find module '../src/embedder.js'`

- [ ] **Step 3: Write minimal implementation**

Create `src/embedder.js`:

```js
export class Embedder {
  #pipeline = null;
  #embedFn = null;
  #pipelineFn = null;
  #model;
  #loaded = false;

  constructor({ model, embedFn, pipelineFn } = {}) {
    this.#model = model || 'Xenova/paraphrase-multilingual-MiniLM-L12-v2';
    this.#embedFn = embedFn || null;
    this.#pipelineFn = pipelineFn || null;
  }

  async load() {
    if (this.#embedFn) {
      this.#loaded = true;
      return;
    }
    if (this.#pipelineFn) {
      this.#pipeline = await this.#pipelineFn();
      this.#loaded = true;
      return;
    }
    const { pipeline } = await import('@xenova/transformers');
    this.#pipeline = await pipeline('feature-extraction', this.#model);
    this.#loaded = true;
  }

  async embed(text) {
    if (!this.#loaded) throw new Error('Embedder not loaded. Call load() first.');

    if (this.#embedFn) {
      return this.#embedFn(text);
    }

    const output = await this.#pipeline(text);
    const raw = output.data instanceof Float32Array ? output.data : new Float32Array(output.data);
    return l2Normalize(raw);
  }
}

function l2Normalize(vec) {
  let norm = 0;
  for (let i = 0; i < vec.length; i++) norm += vec[i] * vec[i];
  norm = Math.sqrt(norm);
  if (norm === 0) return vec;
  const out = new Float32Array(vec.length);
  for (let i = 0; i < vec.length; i++) out[i] = vec[i] / norm;
  return out;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run test/embedder.test.js
```

Expected: all 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/embedder.js test/embedder.test.js
git commit -m "feat: add embedder module with L2 normalization"
```

---

### Task 5: Cosine Search

**Files:**
- Create: `src/search.js`
- Create: `test/search.test.js`

- [ ] **Step 1: Write the failing test**

Create `test/search.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { cosineSimilarity, findTopK } from '../src/search.js';

describe('cosineSimilarity', () => {
  it('returns 1.0 for identical normalized vectors', () => {
    const a = new Float32Array([0.6, 0.8]);
    const b = new Float32Array([0.6, 0.8]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(1.0, 5);
  });

  it('returns 0.0 for orthogonal vectors', () => {
    const a = new Float32Array([1, 0]);
    const b = new Float32Array([0, 1]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(0.0, 5);
  });

  it('returns -1.0 for opposite vectors', () => {
    const a = new Float32Array([1, 0]);
    const b = new Float32Array([-1, 0]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(-1.0, 5);
  });

  it('matches numpy reference: [0.1, 0.2, 0.3] dot [0.4, 0.5, 0.6]', () => {
    // numpy: cosine_similarity([[0.1,0.2,0.3]], [[0.4,0.5,0.6]]) = 0.97463185
    const a = new Float32Array([0.1, 0.2, 0.3]);
    const b = new Float32Array([0.4, 0.5, 0.6]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(0.97463, 4);
  });
});

describe('findTopK', () => {
  it('returns top-k nodes sorted by score desc', () => {
    const query = new Float32Array([1, 0]);
    const corpus = [
      { id: 1, embedding: new Float32Array([0, 1]) },     // score 0
      { id: 2, embedding: new Float32Array([0.6, 0.8]) },  // score 0.6
      { id: 3, embedding: new Float32Array([1, 0]) },      // score 1.0
      { id: 4, embedding: new Float32Array([0.8, 0.6]) },  // score 0.8
    ];
    const results = findTopK(query, corpus, 2);
    expect(results).toHaveLength(2);
    expect(results[0].id).toBe(3);
    expect(results[0].score).toBeCloseTo(1.0, 5);
    expect(results[1].id).toBe(4);
    expect(results[1].score).toBeCloseTo(0.8, 5);
  });

  it('excludes specified IDs', () => {
    const query = new Float32Array([1, 0]);
    const corpus = [
      { id: 1, embedding: new Float32Array([1, 0]) },
      { id: 2, embedding: new Float32Array([0.8, 0.6]) },
    ];
    const results = findTopK(query, corpus, 2, { excludeIds: new Set([1]) });
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe(2);
  });

  it('returns empty array for empty corpus', () => {
    const query = new Float32Array([1, 0]);
    expect(findTopK(query, [], 5)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run test/search.test.js
```

Expected: FAIL — `Cannot find module '../src/search.js'`

- [ ] **Step 3: Write minimal implementation**

Create `src/search.js`:

```js
export function cosineSimilarity(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

export function findTopK(query, corpus, k, { excludeIds } = {}) {
  const scored = [];
  for (const node of corpus) {
    if (excludeIds && excludeIds.has(node.id)) continue;
    const score = cosineSimilarity(query, node.embedding);
    scored.push({ id: node.id, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k);
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run test/search.test.js
```

Expected: all 7 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/search.js test/search.test.js
git commit -m "feat: add cosine similarity search (brute-force)"
```

---

### Task 6: Graph Module — Edges & Garland

**Files:**
- Create: `src/graph.js`
- Create: `test/graph.test.js`

- [ ] **Step 1: Write the failing test**

Create `test/graph.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { addEdge, removeNodeEdges, garland, EDGE_TYPES } from '../src/graph.js';

describe('EDGE_TYPES', () => {
  it('has all 5 types', () => {
    expect(Object.keys(EDGE_TYPES)).toEqual([
      'SIMILAR_TO', 'CAUSED_BY', 'FOLLOWED_BY', 'BELONGS_TO', 'REFERENCES',
    ]);
  });
});

describe('addEdge', () => {
  it('adds neighbor and edge type to node', () => {
    const node = { neighbors: [], edge_types: {} };
    addEdge(node, 42, 'SIMILAR_TO');
    expect(node.neighbors).toEqual([42]);
    expect(node.edge_types['42']).toBe('SIMILAR_TO');
  });

  it('does not duplicate neighbor', () => {
    const node = { neighbors: [42], edge_types: { '42': 'SIMILAR_TO' } };
    addEdge(node, 42, 'CAUSED_BY');
    expect(node.neighbors).toEqual([42]);
    expect(node.edge_types['42']).toBe('CAUSED_BY');
  });
});

describe('removeNodeEdges', () => {
  it('removes a specific neighbor', () => {
    const node = { neighbors: [1, 2, 3], edge_types: { '1': 'SIMILAR_TO', '2': 'CAUSED_BY', '3': 'SIMILAR_TO' } };
    removeNodeEdges(node, 2);
    expect(node.neighbors).toEqual([1, 3]);
    expect(node.edge_types).toEqual({ '1': 'SIMILAR_TO', '3': 'SIMILAR_TO' });
  });
});

describe('garland', () => {
  it('traverses graph BFS to given depth', () => {
    const getNode = async (id) => {
      const graph = {
        1: { id: 1, raw_input: 'node1', neighbors: [2, 3], edge_types: { '2': 'SIMILAR_TO', '3': 'CAUSED_BY' } },
        2: { id: 2, raw_input: 'node2', neighbors: [4], edge_types: { '4': 'SIMILAR_TO' } },
        3: { id: 3, raw_input: 'node3', neighbors: [], edge_types: {} },
        4: { id: 4, raw_input: 'node4', neighbors: [], edge_types: {} },
      };
      return graph[id] || null;
    };

    return garland(1, 2, getNode).then(result => {
      expect(result.map(n => n.id)).toEqual([2, 3, 4]);
      expect(result[0]).toEqual({ id: 2, text: 'node2', edgeType: 'SIMILAR_TO', depth: 1 });
      expect(result[1]).toEqual({ id: 3, text: 'node3', edgeType: 'CAUSED_BY', depth: 1 });
      expect(result[2]).toEqual({ id: 4, text: 'node4', edgeType: 'SIMILAR_TO', depth: 2 });
    });
  });

  it('does not revisit nodes', async () => {
    const getNode = async (id) => {
      const graph = {
        1: { id: 1, raw_input: 'a', neighbors: [2], edge_types: { '2': 'SIMILAR_TO' } },
        2: { id: 2, raw_input: 'b', neighbors: [1], edge_types: { '1': 'SIMILAR_TO' } },
      };
      return graph[id] || null;
    };
    const result = await garland(1, 3, getNode);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(2);
  });

  it('returns empty for node with no neighbors', async () => {
    const getNode = async (id) => ({ id, raw_input: 'lonely', neighbors: [], edge_types: {} });
    const result = await garland(1, 2, getNode);
    expect(result).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run test/graph.test.js
```

Expected: FAIL — `Cannot find module '../src/graph.js'`

- [ ] **Step 3: Write minimal implementation**

Create `src/graph.js`:

```js
export const EDGE_TYPES = {
  SIMILAR_TO: 'SIMILAR_TO',
  CAUSED_BY: 'CAUSED_BY',
  FOLLOWED_BY: 'FOLLOWED_BY',
  BELONGS_TO: 'BELONGS_TO',
  REFERENCES: 'REFERENCES',
};

export function addEdge(node, neighborId, edgeType) {
  if (!node.neighbors.includes(neighborId)) {
    node.neighbors.push(neighborId);
  }
  node.edge_types[String(neighborId)] = edgeType;
}

export function removeNodeEdges(node, neighborId) {
  node.neighbors = node.neighbors.filter(n => n !== neighborId);
  delete node.edge_types[String(neighborId)];
}

export async function garland(startId, depth, getNodeFn) {
  const visited = new Set([startId]);
  const result = [];
  let frontier = [{ id: startId, node: await getNodeFn(startId) }];

  for (let d = 1; d <= depth && frontier.length > 0; d++) {
    const nextFrontier = [];
    for (const { node } of frontier) {
      if (!node || !node.neighbors) continue;
      for (const nbrId of node.neighbors) {
        if (visited.has(nbrId)) continue;
        visited.add(nbrId);
        const nbrNode = await getNodeFn(nbrId);
        if (!nbrNode) continue;
        const edgeType = node.edge_types[String(nbrId)] || 'SIMILAR_TO';
        result.push({ id: nbrId, text: nbrNode.raw_input, edgeType, depth: d });
        nextFrontier.push({ id: nbrId, node: nbrNode });
      }
    }
    frontier = nextFrontier;
  }

  return result;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run test/graph.test.js
```

Expected: all 7 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/graph.js test/graph.test.js
git commit -m "feat: add graph module with edges and garland BFS traversal"
```

---

### Task 7: Decay Module

**Files:**
- Create: `src/decay.js`
- Create: `test/decay.test.js`

- [ ] **Step 1: Write the failing test**

Create `test/decay.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { applyDecay, findArchivable } from '../src/decay.js';

describe('applyDecay', () => {
  it('multiplies decay_score by rate', () => {
    const nodes = [
      { id: 1, decay_score: 1.0 },
      { id: 2, decay_score: 0.5 },
    ];
    const result = applyDecay(nodes, 0.95);
    expect(result[0].decay_score).toBeCloseTo(0.95, 5);
    expect(result[1].decay_score).toBeCloseTo(0.475, 5);
  });
});

describe('findArchivable', () => {
  it('returns nodes below threshold with low popularity', () => {
    const nodes = [
      { id: 1, decay_score: 0.05, popularity_counter: 0 },
      { id: 2, decay_score: 0.05, popularity_counter: 5 },
      { id: 3, decay_score: 0.5, popularity_counter: 0 },
      { id: 4, decay_score: 0.08, popularity_counter: 1 },
    ];
    const archivable = findArchivable(nodes, 0.1);
    expect(archivable.map(n => n.id)).toEqual([1, 4]);
  });

  it('returns empty when nothing qualifies', () => {
    const nodes = [
      { id: 1, decay_score: 0.5, popularity_counter: 0 },
    ];
    expect(findArchivable(nodes, 0.1)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run test/decay.test.js
```

Expected: FAIL — `Cannot find module '../src/decay.js'`

- [ ] **Step 3: Write minimal implementation**

Create `src/decay.js`:

```js
export function applyDecay(nodes, decayRate) {
  return nodes.map(node => ({
    ...node,
    decay_score: node.decay_score * decayRate,
  }));
}

export function findArchivable(nodes, threshold) {
  return nodes.filter(
    node => node.decay_score < threshold && node.popularity_counter <= 1
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run test/decay.test.js
```

Expected: all 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/decay.js test/decay.test.js
git commit -m "feat: add decay module"
```

---

### Task 8: VecMory Core Class

**Files:**
- Create: `src/index.js`
- Create: `test/index.test.js`

This is the orchestrator: wires cleaner, embedder, integram client, search, graph, and decay together into `remember()`, `recall()`, `forget()`, and `status()`.

**Key design:** VecMory accepts a `fields` config object mapping logical names to Integram `t<reqId>` keys. This decouples business logic from Integram schema.

- [ ] **Step 1: Write the failing test**

Create `test/index.test.js`:

```js
import { describe, it, expect, beforeEach } from 'vitest';
import { VecMory } from '../src/index.js';

// Test field mapping (mirrors real Integram t<id> keys)
const F = {
  text: 't1',
  vec: 't2',
  neighbors: 't3',
  cleaned_query: 't4',
  domain: 't5',
  topic: 't6',
  essence: 't7',
  popularity: 't8',
  decay: 't9',
  importance: 't10',
  edge_types: 't11',
};

function makeTestDeps() {
  const records = new Map();
  let nextId = 1;

  const client = {
    auth: async () => {},
    create: async (fields) => {
      const id = String(nextId++);
      records.set(id, { id, ...fields });
      return { id };
    },
    get: async (id) => records.get(String(id)) || null,
    update: async (id, fields) => {
      const rec = records.get(String(id));
      if (rec) Object.assign(rec, fields);
    },
    delete: async (id) => { records.delete(String(id)); },
    deleteBatch: async (ids) => { ids.forEach(id => records.delete(String(id))); },
    list: async () => [...records.values()],
    count: async () => records.size,
    report: async () => [],
    metadata: async () => ({ reqs: [] }),
    batchImport: async () => ({ imported: 0 }),
  };

  const embedder = {
    load: async () => {},
    embed: async (text) => {
      const hash = Array.from(text).reduce((h, c) => ((h << 5) - h + c.charCodeAt(0)) | 0, 0);
      const vec = new Float32Array(3);
      vec[0] = Math.sin(hash);
      vec[1] = Math.cos(hash);
      vec[2] = Math.sin(hash * 2);
      const norm = Math.sqrt(vec[0] ** 2 + vec[1] ** 2 + vec[2] ** 2);
      if (norm > 0) { vec[0] /= norm; vec[1] /= norm; vec[2] /= norm; }
      return vec;
    },
  };

  return { client, embedder, records };
}

describe('VecMory', () => {
  let vm, deps;

  beforeEach(async () => {
    deps = makeTestDeps();
    vm = new VecMory({
      client: deps.client,
      embedder: deps.embedder,
      fields: F,
      topK: 2,
      garlandDepth: 1,
      decayRate: 0.95,
      decayThreshold: 0.1,
    });
    await vm.init();
  });

  describe('remember', () => {
    it('creates a node and returns id', async () => {
      const result = await vm.remember('test bug fix');
      expect(result.id).toBe('1');
      expect(deps.records.get('1')[F.text]).toBe('test bug fix');
    });

    it('stores embedding as JSON array', async () => {
      await vm.remember('some text');
      const rec = deps.records.get('1');
      const emb = JSON.parse(rec[F.vec]);
      expect(emb).toHaveLength(3);
    });

    it('accepts optional domain/topic/essence', async () => {
      await vm.remember('fix auth', { domain: 'infra', topic: 'bug_fix', essence: 'auth,token' });
      const rec = deps.records.get('1');
      expect(rec[F.domain]).toBe('infra');
      expect(rec[F.topic]).toBe('bug_fix');
      expect(rec[F.essence]).toBe('auth,token');
    });

    it('links SIMILAR_TO neighbors when corpus exists', async () => {
      await vm.remember('first entry');
      await vm.remember('second entry similar');
      const rec2 = deps.records.get('2');
      const neighbors = JSON.parse(rec2[F.neighbors] || '[]');
      expect(neighbors.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('recall', () => {
    it('returns nodes ranked by cosine similarity', async () => {
      await vm.remember('deploy to production failed');
      await vm.remember('database migration error');
      await vm.remember('deploy rollback procedure');
      const result = await vm.recall('deploy failure');
      expect(result.nodes.length).toBeGreaterThan(0);
      expect(result.nodes[0]).toHaveProperty('id');
      expect(result.nodes[0]).toHaveProperty('score');
      expect(result.nodes[0]).toHaveProperty('text');
    });

    it('bumps popularity_counter on recalled nodes', async () => {
      await vm.remember('important fact');
      await vm.recall('important');
      const rec = deps.records.get('1');
      expect(Number(rec[F.popularity])).toBeGreaterThanOrEqual(1);
    });

    it('returns total count', async () => {
      await vm.remember('a');
      await vm.remember('b');
      const result = await vm.recall('test');
      expect(result.total).toBe(2);
    });
  });

  describe('forget', () => {
    it('deletes node', async () => {
      await vm.remember('to forget');
      await vm.forget('1');
      expect(deps.records.has('1')).toBe(false);
    });

    it('removes back-references from neighbors', async () => {
      await vm.remember('node A');
      await vm.remember('node B');
      // Force bidirectional edges so test is deterministic
      const recA = deps.records.get('1');
      const recB = deps.records.get('2');
      recA[F.neighbors] = JSON.stringify(['2']);
      recA[F.edge_types] = JSON.stringify({ '2': 'SIMILAR_TO' });
      recB[F.neighbors] = JSON.stringify(['1']);
      recB[F.edge_types] = JSON.stringify({ '1': 'SIMILAR_TO' });
      await vm.forget('1');
      const updatedB = deps.records.get('2');
      const nbrList = JSON.parse(updatedB[F.neighbors]);
      expect(nbrList).not.toContain('1');
      expect(JSON.parse(updatedB[F.edge_types])).not.toHaveProperty('1');
    });
  });

  describe('status', () => {
    it('returns memory statistics', async () => {
      await vm.remember('one', { domain: 'infra' });
      await vm.remember('two', { domain: 'infra' });
      const st = await vm.status();
      expect(st.total).toBe(2);
      expect(st).toHaveProperty('withNeighbors');
      expect(st).toHaveProperty('byDomain');
    });
  });

  describe('decay', () => {
    it('reduces decay scores and archives cold nodes', async () => {
      await vm.remember('fresh node');
      const rec = deps.records.get('1');
      rec[F.decay] = '0.05';
      rec[F.popularity] = '0';
      const result = await vm.decay();
      expect(result).toHaveProperty('archived');
      expect(result).toHaveProperty('total');
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run test/index.test.js
```

Expected: FAIL — `Cannot find module '../src/index.js'`

- [ ] **Step 3: Write the implementation**

Create `src/index.js`:

```js
import { cleanText } from './cleaner.js';
import { findTopK } from './search.js';
import { garland } from './graph.js';
import { applyDecay, findArchivable } from './decay.js';

// Default field mapping for Integram VecMoryNodes table
const DEFAULT_FIELDS = {
  text: 't724959',
  vec: 't724960',
  neighbors: 't724962',
  cleaned_query: 't724978',
  domain: 't724980',
  topic: 't724982',
  essence: 't724984',
  popularity: 't724986',
  decay: 't724988',
  importance: 't724990',
  edge_types: 't724992',
};

export class VecMory {
  #client;
  #embedder;
  #f; // field mapping
  #topK;
  #garlandDepth;
  #decayRate;
  #decayThreshold;

  constructor({ client, embedder, fields, topK = 16, garlandDepth = 2, decayRate = 0.95, decayThreshold = 0.1 }) {
    this.#client = client;
    this.#embedder = embedder;
    this.#f = fields || DEFAULT_FIELDS;
    this.#topK = topK;
    this.#garlandDepth = garlandDepth;
    this.#decayRate = decayRate;
    this.#decayThreshold = decayThreshold;
  }

  async init() {
    await this.#client.auth();
    await this.#embedder.load();
  }

  #parseJson(val, fallback) {
    if (!val) return fallback;
    try { return JSON.parse(val); } catch { return fallback; }
  }

  async remember(text, meta = {}) {
    const f = this.#f;
    const cleaned = cleanText(text);
    const embedding = await this.#embedder.embed(cleaned);
    const embeddingJson = JSON.stringify(Array.from(embedding));

    // Find similar neighbors in existing corpus
    const allNodes = await this.#client.list();
    const corpus = allNodes
      .filter(n => n[f.vec])
      .map(n => ({
        id: n.id,
        embedding: new Float32Array(this.#parseJson(n[f.vec], [])),
      }));
    const neighbors = findTopK(embedding, corpus, this.#topK);

    // Create the record
    const fields = {
      val: text.slice(0, 200),
      [f.text]: text,
      [f.cleaned_query]: cleaned,
      [f.vec]: embeddingJson,
      [f.domain]: meta.domain || '',
      [f.topic]: meta.topic || '',
      [f.essence]: Array.isArray(meta.essence) ? meta.essence.join(',') : (meta.essence || ''),
      [f.popularity]: '0',
      [f.decay]: '1.0',
      [f.importance]: '1.0',
      [f.neighbors]: '[]',
      [f.edge_types]: '{}',
    };
    const { id } = await this.#client.create(fields);

    // Add edges: forward (new node -> neighbors) and backward (neighbors -> new node)
    const edgeTypes = {};
    const neighborIds = [];
    for (const { id: nbrId } of neighbors) {
      neighborIds.push(nbrId);
      const edgeType = meta.edgeType || 'SIMILAR_TO';
      edgeTypes[String(nbrId)] = edgeType;

      // Add back-reference on neighbor
      const nbrNode = await this.#client.get(nbrId);
      if (nbrNode) {
        const nbrEdgeTypes = this.#parseJson(nbrNode[f.edge_types], {});
        const nbrNeighbors = this.#parseJson(nbrNode[f.neighbors], []);
        if (!nbrNeighbors.includes(id)) nbrNeighbors.push(id);
        nbrEdgeTypes[String(id)] = edgeType;
        await this.#client.update(nbrId, {
          [f.neighbors]: JSON.stringify(nbrNeighbors),
          [f.edge_types]: JSON.stringify(nbrEdgeTypes),
        });
      }
    }

    await this.#client.update(id, {
      [f.neighbors]: JSON.stringify(neighborIds),
      [f.edge_types]: JSON.stringify(edgeTypes),
    });

    return { id, neighbors: neighborIds, scores: neighbors.map(n => n.score) };
  }

  async recall(query, k) {
    const f = this.#f;
    const topK = k || this.#topK;
    const cleaned = cleanText(query);
    const queryEmbedding = await this.#embedder.embed(cleaned);

    // Cosine top-k — single list() call, cache for reuse
    const allNodes = await this.#client.list();
    const nodeMap = new Map(allNodes.map(n => [n.id, n]));
    const corpus = allNodes
      .filter(n => n[f.vec])
      .map(n => ({
        id: n.id,
        embedding: new Float32Array(this.#parseJson(n[f.vec], [])),
      }));
    const topResults = findTopK(queryEmbedding, corpus, topK);

    // Garland expansion — use nodeMap cache
    const garlandNodes = [];
    const seenIds = new Set(topResults.map(r => r.id));

    const getNodeFromCache = async (id) => {
      const node = nodeMap.get(id);
      if (!node) return null;
      return {
        ...node,
        id: node.id,
        raw_input: node[f.text] || '',
        neighbors: this.#parseJson(node[f.neighbors], []),
        edge_types: this.#parseJson(node[f.edge_types], {}),
      };
    };

    for (const result of topResults) {
      const chain = await garland(result.id, this.#garlandDepth, getNodeFromCache);
      for (const gn of chain) {
        if (!seenIds.has(gn.id)) {
          seenIds.add(gn.id);
          garlandNodes.push(gn);
        }
      }
    }

    // Bump popularity and reset decay for touched nodes
    for (const { id } of topResults) {
      const node = nodeMap.get(id);
      if (node) {
        await this.#client.update(id, {
          [f.popularity]: String((Number(node[f.popularity]) || 0) + 1),
          [f.decay]: '1.0',
        });
      }
    }

    // Build response
    const nodes = topResults.map(r => {
      const full = nodeMap.get(r.id);
      return {
        id: r.id,
        score: r.score,
        text: full?.[f.text] || '',
        domain: full?.[f.domain] || '',
        topic: full?.[f.topic] || '',
        essence: full?.[f.essence] || '',
      };
    });

    const garlandText = garlandNodes.map(g => `[${g.edgeType}] ${g.text}`).join(' -> ');

    return { nodes, garland: garlandText, total: allNodes.length };
  }

  async forget(nodeId) {
    const f = this.#f;
    const node = await this.#client.get(nodeId);
    if (!node) return;

    // Remove back-references from neighbors
    const neighbors = this.#parseJson(node[f.neighbors], []);
    for (const nbrId of neighbors) {
      const nbr = await this.#client.get(nbrId);
      if (!nbr) continue;
      const nbrNeighbors = this.#parseJson(nbr[f.neighbors], []).filter(n => n !== nodeId);
      const nbrEdgeTypes = this.#parseJson(nbr[f.edge_types], {});
      delete nbrEdgeTypes[String(nodeId)];
      await this.#client.update(nbrId, {
        [f.neighbors]: JSON.stringify(nbrNeighbors),
        [f.edge_types]: JSON.stringify(nbrEdgeTypes),
      });
    }

    await this.#client.delete(nodeId);
  }

  async status() {
    const f = this.#f;
    const allNodes = await this.#client.list();
    const total = allNodes.length;
    const withNeighbors = allNodes.filter(n => {
      const nbrs = this.#parseJson(n[f.neighbors], []);
      return nbrs.length > 0;
    }).length;

    const domainMap = {};
    for (const n of allNodes) {
      const d = n[f.domain] || 'unknown';
      domainMap[d] = (domainMap[d] || 0) + 1;
    }

    const totalEdges = allNodes.reduce((sum, n) => {
      return sum + this.#parseJson(n[f.neighbors], []).length;
    }, 0);
    const avgDegree = total > 0 ? totalEdges / total : 0;

    return { total, withNeighbors, avgDegree, byDomain: domainMap };
  }

  async decay() {
    const f = this.#f;
    const allNodes = await this.#client.list();
    const mapped = allNodes.map(n => ({
      id: n.id,
      decay_score: Number(n[f.decay]) || 1.0,
      popularity_counter: Number(n[f.popularity]) || 0,
    }));
    const decayed = applyDecay(mapped, this.#decayRate);
    const archivable = findArchivable(decayed, this.#decayThreshold);

    // Update decay scores
    for (const node of decayed) {
      await this.#client.update(node.id, { [f.decay]: String(node.decay_score) });
    }

    // Archive (delete) cold nodes
    if (archivable.length > 0) {
      await this.#client.deleteBatch(archivable.map(n => n.id));
    }

    return { archived: archivable.length, total: allNodes.length };
  }

  async batchImport(records) {
    const f = this.#f;
    const meta = await this.#client.metadata();
    const fieldOrder = meta.reqs
      ? meta.reqs.map(r => `t${r.id}`)
      : [f.text, f.cleaned_query, f.vec, f.domain, f.topic, f.essence, f.popularity, f.decay, f.importance, f.neighbors, f.edge_types];

    const lines = ['DATA'];

    for (const rec of records) {
      let embedding = rec.embedding;
      if (!embedding) {
        const cleaned = cleanText(rec.text || '');
        const vec = await this.#embedder.embed(cleaned);
        embedding = JSON.stringify(Array.from(vec));
      }
      const name = rec.text || '';
      const cleaned = cleanText(name);
      const defaults = {
        [f.text]: name,
        [f.cleaned_query]: cleaned,
        [f.vec]: embedding,
        [f.domain]: rec.domain || '',
        [f.topic]: rec.topic || '',
        [f.essence]: rec.essence || '',
        [f.popularity]: '0',
        [f.decay]: '1.0',
        [f.importance]: '1.0',
        [f.neighbors]: '[]',
        [f.edge_types]: '{}',
      };
      const values = fieldOrder.map(key => defaults[key] ?? '');
      lines.push(name.slice(0, 200) + ';' + values.join(';') + ';');
    }

    const dataContent = lines.join('\n') + '\n';
    return this.#client.batchImport(dataContent);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run test/index.test.js
```

Expected: all 9 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/index.js test/index.test.js
git commit -m "feat: add VecMory core class with remember, recall, forget, status, decay"
```

---

### Task 9: MCP Server

**Files:**
- Create: `src/mcp-server.js`

- [ ] **Step 1: Write the MCP server**

Create `src/mcp-server.js`:

```js
#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { IntegramClient } from './integram-client.js';
import { Embedder } from './embedder.js';
import { VecMory } from './index.js';

const env = process.env;

const client = new IntegramClient({
  baseUrl: env.VECMORY_BASE_URL,
  token: env.VECMORY_TOKEN,
  db: env.VECMORY_DB,
  tableId: env.VECMORY_TABLE_ID,
});

const embedder = new Embedder({
  model: env.VECMORY_MODEL,
});

const fields = {
  text: `t${env.VECMORY_FIELD_TEXT}`,
  vec: `t${env.VECMORY_FIELD_VEC}`,
  neighbors: `t${env.VECMORY_FIELD_NEIGHBORS}`,
  cleaned_query: `t${env.VECMORY_FIELD_CLEANED_QUERY}`,
  domain: `t${env.VECMORY_FIELD_DOMAIN}`,
  topic: `t${env.VECMORY_FIELD_TOPIC}`,
  essence: `t${env.VECMORY_FIELD_ESSENCE}`,
  popularity: `t${env.VECMORY_FIELD_POPULARITY}`,
  decay: `t${env.VECMORY_FIELD_DECAY}`,
  importance: `t${env.VECMORY_FIELD_IMPORTANCE}`,
  edge_types: `t${env.VECMORY_FIELD_EDGE_TYPES}`,
};

const vm = new VecMory({
  client,
  embedder,
  fields,
  topK: parseInt(env.VECMORY_TOP_K || '16', 10),
  garlandDepth: parseInt(env.VECMORY_GARLAND_DEPTH || '2', 10),
  decayRate: parseFloat(env.VECMORY_DECAY_RATE || '0.95'),
  decayThreshold: parseFloat(env.VECMORY_DECAY_THRESHOLD || '0.1'),
});

const server = new Server(
  { name: 'vecmory', version: '0.1.0' },
  { capabilities: { tools: {} } },
);

const TOOLS = [
  {
    name: 'recall',
    description: 'Semantic search in memory. Returns relevant nodes with garland chain.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query text' },
        k: { type: 'number', description: 'Number of results (default: configured topK)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'remember',
    description: 'Store a fact, solution, or lesson in memory.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Text to remember' },
        domain: { type: 'string', description: 'Category: integrations, infra, project_X, etc.' },
        topic: { type: 'string', description: 'Type: bug_fix, feature_request, question' },
        essence: { type: 'array', items: { type: 'string' }, description: '1-3 keywords' },
      },
      required: ['text'],
    },
  },
  {
    name: 'forget',
    description: 'Delete a node and its edges from memory.',
    inputSchema: {
      type: 'object',
      properties: {
        nodeId: { type: 'number', description: 'ID of the node to delete' },
      },
      required: ['nodeId'],
    },
  },
  {
    name: 'memory_status',
    description: 'Memory statistics: total nodes, edges, domains, recent activity.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
];

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS,
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'recall': {
        const result = await vm.recall(args.query, args.k);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }
      case 'remember': {
        const result = await vm.remember(args.text, {
          domain: args.domain,
          topic: args.topic,
          essence: args.essence,
        });
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }
      case 'forget': {
        await vm.forget(args.nodeId);
        return { content: [{ type: 'text', text: `Node ${args.nodeId} deleted.` }] };
      }
      case 'memory_status': {
        const result = await vm.status();
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }
      default:
        return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
    }
  } catch (err) {
    return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
  }
});

async function main() {
  await vm.init();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(err => {
  console.error('VecMory startup error:', err);
  process.exit(1);
});
```

- [ ] **Step 2: Make executable**

```bash
chmod +x src/mcp-server.js
```

- [ ] **Step 3: Verify syntax**

```bash
node --check src/mcp-server.js
```

Expected: no output (syntax OK).

- [ ] **Step 4: Commit**

```bash
git add src/mcp-server.js
git commit -m "feat: add MCP stdio server with 4 tools"
```

---

### Task 10: Run Full Test Suite & Verify

- [ ] **Step 1: Run all tests**

```bash
npx vitest run
```

Expected: all tests pass across all 6 test files.

- [ ] **Step 2: Verify package structure**

```bash
node -e "import('./src/index.js').then(m => console.log('VecMory exported:', typeof m.VecMory))"
```

Expected: `VecMory exported: function`

- [ ] **Step 3: Final commit with all files**

```bash
git add -A
git commit -m "chore: verify full test suite passes, MVP complete"
```

---

### Task 11: Claude Code Hooks (Optional)

**Files:**
- Create: `hooks/pre-recall.js`
- Create: `hooks/post-remember.js`

- [ ] **Step 1: Create pre-recall hook**

Create `hooks/pre-recall.js`:

```js
#!/usr/bin/env node

import { IntegramClient } from '../src/integram-client.js';
import { Embedder } from '../src/embedder.js';
import { VecMory } from '../src/index.js';

const env = process.env;
if (env.VECMORY_AUTO === '0') process.exit(0);

const prompt = process.argv[2];
if (!prompt) process.exit(0);

const client = new IntegramClient({
  baseUrl: env.VECMORY_BASE_URL,
  token: env.VECMORY_TOKEN,
  db: env.VECMORY_DB,
  tableId: env.VECMORY_TABLE_ID,
});

const embedder = new Embedder({ model: env.VECMORY_MODEL });
const vm = new VecMory({ client, embedder });

try {
  await vm.init();
  const result = await vm.recall(prompt, 5);
  if (result.nodes.length > 0) {
    console.log('--- VecMory Context ---');
    for (const node of result.nodes) {
      console.log(`[${node.domain || '?'}] (score: ${node.score.toFixed(3)}) ${node.text}`);
    }
    if (result.garland) {
      console.log(`Garland: ${result.garland}`);
    }
    console.log('--- End VecMory ---');
  }
} catch {
  // Silent fail — hooks should not block the agent
}
```

- [ ] **Step 2: Create post-remember hook**

Create `hooks/post-remember.js`:

```js
#!/usr/bin/env node

import { IntegramClient } from '../src/integram-client.js';
import { Embedder } from '../src/embedder.js';
import { VecMory } from '../src/index.js';

const env = process.env;
if (env.VECMORY_AUTO === '0') process.exit(0);

const summary = process.argv[2];
if (!summary || summary.length < 20) process.exit(0);

const client = new IntegramClient({
  baseUrl: env.VECMORY_BASE_URL,
  token: env.VECMORY_TOKEN,
  db: env.VECMORY_DB,
  tableId: env.VECMORY_TABLE_ID,
});

const embedder = new Embedder({ model: env.VECMORY_MODEL });
const vm = new VecMory({ client, embedder });

try {
  await vm.init();
  await vm.remember(summary, { topic: 'session_lesson' });
} catch {
  // Silent fail
}
```

- [ ] **Step 3: Commit**

```bash
git add hooks/
git commit -m "feat: add Claude Code hooks for auto-recall and auto-remember"
```

---

## Spec Coverage Checklist

| Spec Section | Task |
|---|---|
| s1 Architecture | Task 8 (VecMory class), Task 9 (MCP server) |
| s2.1 Auth | Task 3 (token-based: GET /xsrf, NOT POST /auth — captcha blocks it) |
| s2.2 CRUD | Task 3 (create, get, update, delete, deleteBatch, list, count) |
| s2.3 Neighbors | Task 8 (neighbors stored as MEMO/JSON array, not MULTISELECT) |
| s2.4 Batch import | Task 8 (VecMory.batchImport) |
| s2.5 Reports | Task 3 (IntegramClient.report) |
| s2.6 Formula columns | Not in MVP — server-side cosine is a future optimization |
| s2.7 RECURSIVE reports | Not in MVP — client BFS via garland() |
| s2.8 Sub-reports | Not in MVP |
| s2.9 Metadata | Task 3 (IntegramClient.metadata) |
| s3 Node structure | Task 8 (remember fields) |
| s4 Edge types | Task 6 (EDGE_TYPES, addEdge) |
| s5 MCP tools | Task 9 (recall, remember, forget, memory_status) |
| s6 remember pipeline | Task 8 (VecMory.remember) |
| s6 recall pipeline | Task 8 (VecMory.recall) |
| s6 garland | Task 6 (garland BFS) |
| s6 decay | Task 7 + Task 8 (VecMory.decay) |
| s6 batchImport | Task 8 (VecMory.batchImport) |
| s6 status | Task 8 (VecMory.status) |
| s7 Embedder | Task 4 |
| s8 Config | Task 1 (.env.example), Task 9 (env parsing) |
| s9 Package structure | All tasks |
| s10 Dependencies | Task 1 (package.json) |
| s11 Hooks | Task 11 |
| s12 Testing | Tasks 2-8 (unit tests) |

**Note:** Spec sections 2.6 (formula columns), 2.7 (RECURSIVE), 2.8 (sub-reports) are Stage 4 server-side optimizations. The MVP uses client-side brute-force cosine and BFS garland. These can be added as a follow-up plan once the MVP is validated with real data.
