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
