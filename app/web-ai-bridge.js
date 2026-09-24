const crypto = require('crypto');
const http = require('http');

class WebAiBridge {
  constructor(handler) {
    this.handler = handler;
    this.server = null;
    this.port = null;
    this.token = crypto.randomBytes(32).toString('base64url');
  }

  async start() {
    if (this.server) return this.status();
    this.server = http.createServer((request, response) => this.handle(request, response));
    await new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(0, '127.0.0.1', resolve);
    });
    const address = this.server.address();
    this.port = typeof address === 'object' && address ? address.port : null;
    return this.status();
  }

  status() {
    return {
      state: this.server?.listening && this.port ? 'ready' : 'stopped',
      url: this.port ? `http://127.0.0.1:${this.port}` : null,
    };
  }

  environment() {
    const status = this.status();
    return status.url ? {
      TASKHIVE_WEB_AI_BRIDGE_URL: status.url,
      TASKHIVE_WEB_AI_BRIDGE_TOKEN: this.token,
    } : {};
  }

  async stop() {
    const server = this.server;
    this.server = null;
    this.port = null;
    if (!server) return;
    await new Promise((resolve) => server.close(() => resolve()));
  }

  authorize(request) {
    const authorization = String(request.headers.authorization || '');
    const supplied = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
    const expected = Buffer.from(this.token);
    const actual = Buffer.from(supplied);
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  }

  send(response, statusCode, body) {
    if (response.destroyed || response.writableEnded) return;
    response.writeHead(statusCode, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    });
    response.end(JSON.stringify(body));
  }

  async readBody(request) {
    const chunks = [];
    let size = 0;
    for await (const chunk of request) {
      size += chunk.length;
      if (size > 1024 * 1024) throw Object.assign(new Error('请求内容过大'), { code: 'PAYLOAD_TOO_LARGE', statusCode: 413 });
      chunks.push(chunk);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  }

  async handle(request, response) {
    if (request.socket.remoteAddress !== '127.0.0.1' && request.socket.remoteAddress !== '::ffff:127.0.0.1') {
      this.send(response, 403, { ok: false, code: 'LOOPBACK_ONLY', message: '仅允许本机访问' });
      return;
    }
    if (!this.authorize(request)) {
      this.send(response, 401, { ok: false, code: 'UNAUTHORIZED', message: '网页模型桥认证失败' });
      return;
    }
    if (request.method === 'GET' && request.url === '/health') {
      this.send(response, 200, { ok: true, state: 'ready' });
      return;
    }
    if (request.method !== 'POST' || request.url !== '/chat') {
      this.send(response, 404, { ok: false, code: 'NOT_FOUND', message: '接口不存在' });
      return;
    }
    const controller = new AbortController();
    const abort = () => controller.abort();
    request.once('aborted', abort);
    response.once('close', () => {
      if (!response.writableEnded) abort();
    });
    try {
      const input = await this.readBody(request);
      const model = String(input.model || '').trim();
      const prompt = String(input.prompt || '');
      const timeoutMs = Math.min(900000, Math.max(30000, Number(input.timeoutMs) || 600000));
      if (!model || !prompt.trim()) throw Object.assign(new Error('网页模型请求缺少模型或提示词'), { code: 'INVALID_REQUEST', statusCode: 400 });
      const result = await this.handler({ model, prompt, timeoutMs, signal: controller.signal });
      const text = String(result?.text || '');
      if (!text.trim()) throw Object.assign(new Error('网页模型没有返回可用文本'), { code: 'EMPTY_RESPONSE', statusCode: 502 });
      this.send(response, 200, { ok: true, text });
    } catch (error) {
      const code = String(error?.code || 'WEB_AI_FAILED');
      const statusCode = Number(error?.statusCode) || (code === 'ABORTED' ? 499 : 502);
      this.send(response, statusCode, { ok: false, code, message: String(error?.message || '网页模型请求失败') });
    } finally {
      request.removeListener('aborted', abort);
    }
  }
}

module.exports = { WebAiBridge };
