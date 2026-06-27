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
