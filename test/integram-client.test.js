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
