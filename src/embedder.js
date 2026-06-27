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
