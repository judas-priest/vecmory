import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IntegramClient } from '../src/integram-client.js';

function mockFetch(responses) {
  const calls = [];
  let callIndex = 0;
  const fn = async (url, opts) => {
    calls.push({ url: url.toString(), opts });
    const resp = responses[callIndex++] || { ok: true, body: {} };
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
      expect(fetchFn.calls[0].opts.method).toBeUndefined();
    });
  });

  describe('create', () => {
    it('POSTs to _m_new/{tableId} with FormData, returns id', async () => {
      const fetchFn = mockFetch([
        { body: { _xsrf: 'xsrf1' } },
        { body: { id: 42, obj: 42, val: 'hello' } },
      ]);
      const client = new IntegramClient({ ...baseConfig, fetchFn });
      await client.auth();
      const result = await client.create({ t724959: 'hello' });
      expect(fetchFn.calls[1].url).toBe('https://ideav.ru/testdb/_m_new/724958?JSON=1');
      expect(fetchFn.calls[1].opts.method).toBe('POST');
      expect(result.id).toBe('42');
    });
  });

  describe('get', () => {
    it('fetches record with F_I filter, merges reqs into object', async () => {
      const fetchFn = mockFetch([
        { body: { _xsrf: 'xsrf1' } },
        { body: { object: [{ id: '1', val: 'rec1', up: '1', base: '724958' }], reqs: { '1': { '724959': 'hi', '724980': 'test' } } } },
      ]);
      const client = new IntegramClient({ ...baseConfig, fetchFn });
      await client.auth();
      const result = await client.get('1');
      expect(fetchFn.calls[1].url).toContain('F_I=1');
      expect(fetchFn.calls[1].url).toContain('JSON_KV');
      expect(result.t724959).toBe('hi');
      expect(result.t724980).toBe('test');
      expect(result.val).toBe('rec1');
    });

    it('returns null when record not found', async () => {
      const fetchFn = mockFetch([
        { body: { _xsrf: 'xsrf1' } },
        { body: { object: [] } },
      ]);
      const client = new IntegramClient({ ...baseConfig, fetchFn });
      await client.auth();
      const result = await client.get('999');
      expect(result).toBeNull();
    });
  });

  describe('update', () => {
    it('POSTs to _m_set/{id} with FormData', async () => {
      const fetchFn = mockFetch([
        { body: { _xsrf: 'xsrf1' } },
        { body: { id: '100', obj: 1 } },
      ]);
      const client = new IntegramClient({ ...baseConfig, fetchFn });
      await client.auth();
      await client.update('1', { t724988: '0.5' });
      expect(fetchFn.calls[1].url).toBe('https://ideav.ru/testdb/_m_set/1?JSON=1');
      expect(fetchFn.calls[1].opts.method).toBe('POST');
    });
  });

  describe('delete', () => {
    it('POSTs to _m_del/{id}', async () => {
      const fetchFn = mockFetch([
        { body: { _xsrf: 'xsrf1' } },
        { body: { id: '724958', obj: 1 } },
      ]);
      const client = new IntegramClient({ ...baseConfig, fetchFn });
      await client.auth();
      await client.delete('1');
      expect(fetchFn.calls[1].url).toBe('https://ideav.ru/testdb/_m_del/1?JSON=1');
      expect(fetchFn.calls[1].opts.method).toBe('POST');
    });
  });

  describe('deleteBatch', () => {
    it('deletes each id individually', async () => {
      const fetchFn = mockFetch([
        { body: { _xsrf: 'xsrf1' } },
        { body: { obj: 1 } },
        { body: { obj: 2 } },
        { body: { obj: 3 } },
      ]);
      const client = new IntegramClient({ ...baseConfig, fetchFn });
      await client.auth();
      await client.deleteBatch(['1', '2', '3']);
      expect(fetchFn.calls[1].url).toContain('_m_del/1');
      expect(fetchFn.calls[2].url).toContain('_m_del/2');
      expect(fetchFn.calls[3].url).toContain('_m_del/3');
    });
  });

  describe('list', () => {
    it('returns array of records with reqs merged', async () => {
      const fetchFn = mockFetch([
        { body: { _xsrf: 'xsrf1' } },
        { body: { object: [{ id: '1', val: 'a' }, { id: '2', val: 'b' }], reqs: { '1': { '724959': 'text1' }, '2': { '724959': 'text2' } } } },
        { body: { object: [], reqs: {} } },
      ]);
      const client = new IntegramClient({ ...baseConfig, fetchFn });
      await client.auth();
      const result = await client.list();
      expect(result).toHaveLength(2);
      expect(result[0].t724959).toBe('text1');
      expect(result[1].t724959).toBe('text2');
      expect(fetchFn.calls[1].url).toContain('LIMIT=200');
      expect(fetchFn.calls[1].url).toContain('pg=1');
    });

    it('paginates until empty page, deduplicates by id', async () => {
      const fetchFn = mockFetch([
        { body: { _xsrf: 'xsrf1' } },
        // page 1: 2 records
        { body: { object: [{ id: '1', val: 'a' }, { id: '2', val: 'b' }], reqs: { '1': { '724959': 'text1' }, '2': { '724959': 'text2' } } } },
        // page 2: 1 record + duplicate of id '2' from page 1
        { body: { object: [{ id: '2', val: 'b' }, { id: '3', val: 'c' }], reqs: { '2': { '724959': 'text2' }, '3': { '724959': 'text3' } } } },
        // page 3: empty — signals end
        { body: { object: [], reqs: {} } },
      ]);
      const client = new IntegramClient({ ...baseConfig, fetchFn });
      await client.auth();
      const result = await client.list();
      // 3 unique records despite duplicate id '2' on page 2
      expect(result).toHaveLength(3);
      expect(result.map(r => r.id)).toEqual(['1', '2', '3']);
      expect(result[2].t724959).toBe('text3');
      // should have fetched pg=1, pg=2, pg=3
      expect(fetchFn.calls[1].url).toContain('pg=1');
      expect(fetchFn.calls[2].url).toContain('pg=2');
      expect(fetchFn.calls[3].url).toContain('pg=3');
    });
  });

  describe('count', () => {
    it('returns count number', async () => {
      const fetchFn = mockFetch([
        { body: { _xsrf: 'xsrf1' } },
        { body: { count: '42' } },
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
        { body: { _xsrf: 'xsrf1' } },
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
        { body: { _xsrf: 'xsrf1' } },
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
    it('sends DATA format via multipart FormData', async () => {
      const fetchFn = mockFetch([
        { body: { _xsrf: 'xsrf1' } },
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
        { body: { _xsrf: 'xsrf1' } },
        { body: 'No authorization token provided' },
        { body: { _xsrf: 'xsrf2' } },
        { body: { object: [{ id: '1', val: 'a' }], reqs: {} } },
        { body: { object: [], reqs: {} } },
      ]);
      const client = new IntegramClient({ ...baseConfig, fetchFn });
      await client.auth();
      const result = await client.list();
      expect(fetchFn.calls).toHaveLength(5);
      expect(result).toHaveLength(1);
    });
  });
});
