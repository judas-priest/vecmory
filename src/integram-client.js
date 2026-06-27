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

  #objUrl(params = '') {
    return `${this.#baseUrl}/${this.#db}/object/${this.#tableId}${params ? '?' + params : ''}`;
  }

  async #request(url, opts = {}, _retried = false) {
    const isFormData = opts.body instanceof FormData;
    const headers = {
      'X-Authorization': this.#token,
      ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
      ...opts.headers,
    };

    // Inject token + _xsrf into POST body for _m_* operations
    if (opts.method === 'POST' && opts.body && !isFormData) {
      const parsed = typeof opts.body === 'string' ? JSON.parse(opts.body) : { ...opts.body };
      parsed.token = this.#token;
      parsed._xsrf = this.#xsrf;
      opts = { ...opts, body: JSON.stringify(parsed) };
    } else if (opts.method === 'POST' && isFormData) {
      opts.body.set('token', this.#token);
      opts.body.set('_xsrf', this.#xsrf);
    }

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

  async create(fields) {
    const data = await this.#request(this.#objUrl('_m_new&JSON'), {
      method: 'POST',
      body: JSON.stringify(fields),
    });
    const id = data?.object?.[0]?.id ?? data?.id;
    return { id, _raw: data };
  }

  async get(id) {
    return this.#request(this.#objUrl(`id=${id}&full=1&JSON=1`));
  }

  async update(id, fields) {
    return this.#request(this.#objUrl(`_m_set&id=${id}&full=1`), {
      method: 'POST',
      body: JSON.stringify(fields),
    });
  }

  async delete(id) {
    return this.#request(this.#objUrl(`_m_del&id=${id}`), {
      method: 'POST',
      body: JSON.stringify({}),
    });
  }

  async deleteBatch(ids) {
    return this.#request(this.#objUrl(`_m_del_batch&ids=${ids.join(',')}`), {
      method: 'POST',
      body: JSON.stringify({}),
    });
  }

  async list() {
    return this.#request(this.#objUrl('full=1&JSON'));
  }

  async count() {
    const data = await this.#request(this.#objUrl('count&JSON'));
    return typeof data === 'object' ? data.count : data;
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
    const formData = new FormData();
    formData.set('bki_file', new Blob([dataContent], { type: 'text/plain' }), 'import.txt');
    return this.#request(this.#objUrl('JSON&import=1'), {
      method: 'POST',
      body: formData,
    });
  }
}
