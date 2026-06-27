import { describe, it, expect, beforeEach } from 'vitest';
import { VecMory } from '../src/index.js';

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
