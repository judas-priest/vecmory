import { cleanText } from './cleaner.js';
import { findTopK } from './search.js';
import { garland } from './graph.js';
import { applyDecay, findArchivable } from './decay.js';

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
  #f;
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
    try {
      const parsed = JSON.parse(val);
      if (Array.isArray(fallback) && !Array.isArray(parsed)) return fallback;
      if (typeof fallback === 'object' && fallback !== null && !Array.isArray(fallback) && typeof parsed !== 'object') return fallback;
      return parsed;
    } catch { return fallback; }
  }

  async remember(text, meta = {}) {
    const f = this.#f;
    const cleaned = cleanText(text);
    const embedding = await this.#embedder.embed(cleaned);
    const embeddingJson = JSON.stringify(Array.from(embedding));

    const allNodes = await this.#client.list();
    const corpus = allNodes
      .filter(n => n[f.vec])
      .map(n => ({ id: n.id, embedding: new Float32Array(this.#parseJson(n[f.vec], [])) }));
    const neighbors = findTopK(embedding, corpus, this.#topK);

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

    const edgeTypes = {};
    const neighborIds = [];
    for (const { id: nbrId } of neighbors) {
      neighborIds.push(nbrId);
      const edgeType = meta.edgeType || 'SIMILAR_TO';
      edgeTypes[String(nbrId)] = edgeType;

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

    const allNodes = await this.#client.list();
    const nodeMap = new Map(allNodes.map(n => [n.id, n]));
    const corpus = allNodes
      .filter(n => n[f.vec])
      .map(n => ({ id: n.id, embedding: new Float32Array(this.#parseJson(n[f.vec], [])) }));
    const topResults = findTopK(queryEmbedding, corpus, topK);

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

    for (const { id } of topResults) {
      const node = nodeMap.get(id);
      if (node) {
        await this.#client.update(id, {
          [f.popularity]: String((Number(node[f.popularity]) || 0) + 1),
          [f.decay]: '1.0',
        });
      }
    }

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
      return this.#parseJson(n[f.neighbors], []).length > 0;
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

    for (const node of decayed) {
      await this.#client.update(node.id, { [f.decay]: String(node.decay_score) });
    }

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
