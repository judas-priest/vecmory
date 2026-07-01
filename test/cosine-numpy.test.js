/**
 * Cosine similarity tests against numpy reference values.
 *
 * Reference computed with:
 *   import numpy as np
 *   from numpy.linalg import norm
 *   def cosine(a, b): return float(np.dot(a,b) / (norm(a)*norm(b)))
 *
 * Vectors (float32):
 *   a = [1, 2, 3, 4, 5, 6, 7, 8]
 *   b = [8, 7, 6, 5, 4, 3, 2, 1]
 *   c = [1, 0, 1, 0, 1, 0, 1, 0]
 *   d = [0, 1, 0, 1, 0, 1, 0, 1]
 *
 * Reference values (10 decimal places):
 *   cosine(a, b) = 0.5882352941  (dot=120, norm²=204 each)
 *   cosine(a, c) = 0.5601120336
 *   cosine(a, d) = 0.7001400420
 *   cosine(a, a) = 1.0000000000
 *   cosine(c, d) = 0.0000000000  (orthogonal)
 *   cosine(b, c) = 0.7001400420
 *   cosine(b, d) = 0.5601120336
 */

import { describe, it, expect } from 'vitest';
import { cosineSimilarity, findTopK } from '../src/search.js';

// 8-dimensional test vectors
const a = new Float32Array([1, 2, 3, 4, 5, 6, 7, 8]);
const b = new Float32Array([8, 7, 6, 5, 4, 3, 2, 1]);
const c = new Float32Array([1, 0, 1, 0, 1, 0, 1, 0]);
const d = new Float32Array([0, 1, 0, 1, 0, 1, 0, 1]);

describe('cosineSimilarity — numpy reference values (5 decimal places)', () => {
  it('cosine(a, b) = 0.58824  [partially reversed vector]', () => {
    expect(cosineSimilarity(a, b)).toBeCloseTo(0.5882352941, 5);
  });

  it('cosine(a, c) = 0.56011  [odd-indexed overlap only]', () => {
    expect(cosineSimilarity(a, c)).toBeCloseTo(0.5601120336, 5);
  });

  it('cosine(a, d) = 0.70014  [even-indexed overlap only]', () => {
    expect(cosineSimilarity(a, d)).toBeCloseTo(0.7001400420, 5);
  });

  it('cosine(a, a) = 1.0  [identical vectors]', () => {
    expect(cosineSimilarity(a, a)).toBeCloseTo(1.0, 5);
  });

  it('cosine(b, b) = 1.0  [identical vectors]', () => {
    expect(cosineSimilarity(b, b)).toBeCloseTo(1.0, 5);
  });

  it('cosine(c, d) = 0.0  [orthogonal vectors — no shared non-zero positions]', () => {
    expect(cosineSimilarity(c, d)).toBeCloseTo(0.0, 5);
  });

  it('cosine(b, c) = 0.70014  [symmetric: same as cosine(a, d)]', () => {
    expect(cosineSimilarity(b, c)).toBeCloseTo(0.7001400420, 5);
  });

  it('cosine(b, d) = 0.56011  [symmetric: same as cosine(a, c)]', () => {
    expect(cosineSimilarity(b, d)).toBeCloseTo(0.5601120336, 5);
  });
});

describe('cosineSimilarity — edge cases', () => {
  it('returns 1.0 for identical vectors (score = 1)', () => {
    const v = new Float32Array([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(cosineSimilarity(v, v)).toBeCloseTo(1.0, 5);
  });

  it('returns 0.0 for orthogonal vectors (score = 0)', () => {
    expect(cosineSimilarity(c, d)).toBeCloseTo(0.0, 5);
  });

  it('returns -1.0 for opposite vectors (score = -1)', () => {
    const pos = new Float32Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const neg = new Float32Array([-1, -2, -3, -4, -5, -6, -7, -8]);
    expect(cosineSimilarity(pos, neg)).toBeCloseTo(-1.0, 5);
  });

  it('returns 0.0 for zero vector (denom = 0 guard)', () => {
    const zero = new Float32Array([0, 0, 0, 0, 0, 0, 0, 0]);
    expect(cosineSimilarity(a, zero)).toBe(0);
  });

  it('is commutative: cosine(a, b) === cosine(b, a)', () => {
    expect(cosineSimilarity(a, b)).toBeCloseTo(cosineSimilarity(b, a), 10);
  });
});

describe('findTopK — ranking matches numpy-derived expected order', () => {
  // Query = a. Expected descending order by cosine score:
  //   a (score 1.0) > d (0.70014) > c (0.56011) > b (0.58824)?
  // Actual order: a=1.0, d=0.70014, b=0.58824, c=0.56011
  const corpus = [
    { id: 'vec-b', embedding: b },
    { id: 'vec-c', embedding: c },
    { id: 'vec-d', embedding: d },
    { id: 'vec-a', embedding: a },
  ];

  it('top-1 result is the identical vector (score = 1.0)', () => {
    const results = findTopK(a, corpus, 1);
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('vec-a');
    expect(results[0].score).toBeCloseTo(1.0, 5);
  });

  it('top-2 result is vec-d with score 0.70014', () => {
    const results = findTopK(a, corpus, 2);
    expect(results).toHaveLength(2);
    expect(results[1].id).toBe('vec-d');
    expect(results[1].score).toBeCloseTo(0.7001400420, 5);
  });

  it('top-3 order: vec-a, vec-d, vec-b', () => {
    const results = findTopK(a, corpus, 3);
    expect(results).toHaveLength(3);
    expect(results[0].id).toBe('vec-a');
    expect(results[1].id).toBe('vec-d');
    expect(results[2].id).toBe('vec-b');
  });

  it('top-4 full ranking: a > d > b > c', () => {
    const results = findTopK(a, corpus, 4);
    expect(results).toHaveLength(4);
    expect(results[0].id).toBe('vec-a');
    expect(results[0].score).toBeCloseTo(1.0000000000, 5);
    expect(results[1].id).toBe('vec-d');
    expect(results[1].score).toBeCloseTo(0.7001400420, 5);
    expect(results[2].id).toBe('vec-b');
    expect(results[2].score).toBeCloseTo(0.5882352941, 5);
    expect(results[3].id).toBe('vec-c');
    expect(results[3].score).toBeCloseTo(0.5601120336, 5);
  });

  it('scores are in strictly descending order', () => {
    const results = findTopK(a, corpus, 4);
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
    }
  });

  it('k larger than corpus returns all nodes', () => {
    const results = findTopK(a, corpus, 100);
    expect(results).toHaveLength(4);
  });
});
