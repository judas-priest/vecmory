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

  async #request(url, opts = {}, _retried = false) {
    const headers = {
      'X-Authorization': this.#token,
      ...opts.headers,
    };

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

  #postForm(fields) {
    const form = new FormData();
    form.set('token', this.#token);
    form.set('_xsrf', this.#xsrf);
    for (const [k, v] of Object.entries(fields)) {
      form.set(k, v);
    }
    return form;
  }

  async create(fields) {
    const body = this.#postForm({ up: '1', ...fields });
    const data = await this.#request(
      `${this.#baseUrl}/${this.#db}/_m_new/${this.#tableId}?JSON=1`,
      { method: 'POST', body },
    );
    const id = data?.id ?? data?.obj ?? data?.object?.[0]?.id;
    return { id: String(id), _raw: data };
  }

  async get(id) {
    const data = await this.#request(
      `${this.#baseUrl}/${this.#db}/object/${this.#tableId}/?JSON_KV&F_I=${id}`,
    );
    const obj = data?.object?.[0];
    if (!obj) return null;
    const reqs = data?.reqs?.[String(id)] || {};
    return { ...obj, ...this.#prefixReqs(reqs) };
  }

  #prefixReqs(reqs) {
    const result = {};
    for (const [k, v] of Object.entries(reqs)) {
      result[`t${k}`] = v;
    }
    return result;
  }

  async update(id, fields) {
    const body = this.#postForm(fields);
    return this.#request(
      `${this.#baseUrl}/${this.#db}/_m_set/${id}?JSON=1`,
      { method: 'POST', body },
    );
  }

  async delete(id) {
    const body = this.#postForm({});
    return this.#request(
      `${this.#baseUrl}/${this.#db}/_m_del/${id}?JSON=1`,
      { method: 'POST', body },
    );
  }

  async deleteBatch(ids) {
    const results = [];
    for (const id of ids) {
      results.push(await this.delete(id));
    }
    return results;
  }

  async list() {
    const data = await this.#request(
      `${this.#baseUrl}/${this.#db}/object/${this.#tableId}/?JSON_KV`,
    );
    const objects = data?.object || [];
    const reqs = data?.reqs || {};
    return objects.map(obj => ({
      ...obj,
      ...this.#prefixReqs(reqs[obj.id] || {}),
    }));
  }

  async count() {
    const data = await this.#request(
      `${this.#baseUrl}/${this.#db}/object/${this.#tableId}/?JSON_KV&_count=`,
    );
    return typeof data === 'object' ? Number(data.count) : data;
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
    const form = this.#postForm({});
    form.set('bki_file', new Blob([dataContent], { type: 'text/plain' }), 'import.txt');
    return this.#request(
      `${this.#baseUrl}/${this.#db}/object/${this.#tableId}/?JSON&import=1`,
      { method: 'POST', body: form },
    );
  }
}
