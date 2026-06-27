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
    const a = new Float32Array([0.1, 0.2, 0.3]);
    const b = new Float32Array([0.4, 0.5, 0.6]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(0.97463, 4);
  });
});

describe('findTopK', () => {
  it('returns top-k nodes sorted by score desc', () => {
    const query = new Float32Array([1, 0]);
    const corpus = [
      { id: 1, embedding: new Float32Array([0, 1]) },
      { id: 2, embedding: new Float32Array([0.6, 0.8]) },
      { id: 3, embedding: new Float32Array([1, 0]) },
      { id: 4, embedding: new Float32Array([0.8, 0.6]) },
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
