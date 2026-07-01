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

  get tableId() { return this.#tableId; }

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
    const PAGE_SIZE = 200;
    const seenIds = new Set();
    const allObjects = [];
    const allReqs = {};

    for (let pg = 1; ; pg++) {
      const data = await this.#request(
        `${this.#baseUrl}/${this.#db}/object/${this.#tableId}/?JSON_KV&LIMIT=${PAGE_SIZE}&pg=${pg}`,
      );
      const objects = data?.object || [];
      const reqs = data?.reqs || {};

      // Merge reqs from this page
      Object.assign(allReqs, reqs);

      // Deduplicate by id and collect objects
      let newCount = 0;
      for (const obj of objects) {
        if (!seenIds.has(obj.id)) {
          seenIds.add(obj.id);
          allObjects.push(obj);
          newCount++;
        }
      }

      // Stop when page is empty
      if (objects.length === 0) break;
    }

    return allObjects.map(obj => ({
      ...obj,
      ...this.#prefixReqs(allReqs[obj.id] || {}),
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

  async createRecord(typeId, fields) {
    const body = this.#postForm({ up: '1', ...fields });
    const data = await this.#request(
      `${this.#baseUrl}/${this.#db}/_m_new/${typeId}?JSON=1`,
      { method: 'POST', body },
    );
    return { id: String(data?.id ?? data?.obj), _raw: data };
  }

  async createReport({ name, fromTableId, vecFieldId, textFieldId }) {
    const REPORT_TYPE = 22;
    const COLUMN_TYPE = 28;
    const FROM_TYPE = 44;

    const rep = await this.createRecord(REPORT_TYPE, { [`t${REPORT_TYPE}`]: name });
    const reportId = rep.id;

    await this.createRecord(FROM_TYPE, { [`t${FROM_TYPE}`]: String(fromTableId), up: reportId });

    const idCol = await this.createRecord(COLUMN_TYPE, { [`t${COLUMN_TYPE}`]: String(textFieldId), up: reportId });
    await this.update(idCol.id, { t100: 'node_id', t104: '85' });

    const vecCol = await this.createRecord(COLUMN_TYPE, { [`t${COLUMN_TYPE}`]: String(vecFieldId), up: reportId });
    await this.update(vecCol.id, { t100: 'vec_raw', t107: '1' });

    const scoreCol = await this.createRecord(COLUMN_TYPE, { [`t${COLUMN_TYPE}`]: '0', up: reportId });
    await this.update(scoreCol.id, { t100: 'score', t101: '0' });

    const textCol = await this.createRecord(COLUMN_TYPE, { [`t${COLUMN_TYPE}`]: String(textFieldId), up: reportId });
    await this.update(textCol.id, { t100: 'text' });

    await this.update(reportId, { t264: 'score DESC', t134: '16' });

    return { reportId, scoreColId: scoreCol.id };
  }

  async cosineSearch(reportId, scoreColId, queryVec, topK, vecFieldId) {
    const vecAlias = `a${vecFieldId || this.#tableId + 2}`;
    const q = "'";
    const parts = [];
    for (let i = 0; i < queryVec.length; i++) {
      const v = queryVec[i].toFixed(4);
      if (v === '0.0000' || v === '-0.0000') continue;
      parts.push(`CAST(JSON_EXTRACT(${vecAlias}.val,${q}$[${i}]${q}) AS DOUBLE)*${v}`);
    }
    const formula = parts.join('+') || '0';

    // Integram MEMO fields can hold large formulas but SQL has practical limits (~30KB)
    if (formula.length > 30000) return null;

    await this.update(scoreColId, { t101: formula });
    if (topK) await this.update(reportId, { t134: String(topK) });

    const result = await this.report(reportId);
    if (!Array.isArray(result) || result[0]?.error) return null;

    return result.map(r => ({
      id: String(r.node_id),
      score: parseFloat(r.score) || 0,
      text: r.text || '',
    }));
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
