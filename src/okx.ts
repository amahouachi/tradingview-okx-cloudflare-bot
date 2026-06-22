export interface OKXEnv {
  OKX_API_KEY: string;
  OKX_API_SECRET: string;
  OKX_PASSPHRASE: string;
  OKX_API_URL?: string;
}

function uint8ToBase64(u8: Uint8Array) {
  let binary = '';
  const len = u8.byteLength;
  for (let i = 0; i < len; i++) binary += String.fromCharCode(u8[i]);
  return btoa(binary);
}

export class OKXClient {
  apiKey: string;
  apiSecret: string;
  passphrase: string;
  baseUrl: string;

  constructor(env: OKXEnv) {
    this.apiKey = env.OKX_API_KEY;
    this.apiSecret = env.OKX_API_SECRET;
    this.passphrase = env.OKX_PASSPHRASE;
    this.baseUrl = env.OKX_API_URL || 'https://openapi.okx.com';
  }

  async sign(method: string, requestPath: string, body = '') {
    const ts = (Date.now() / 1000).toString();
    const message = ts + method.toUpperCase() + requestPath + (body || '');
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey('raw', enc.encode(this.apiSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
    return { ts, sign: uint8ToBase64(new Uint8Array(sig)) };
  }

  async request(method: string, path: string, params?: Record<string, string>, data?: any) {
    const query = params ? '?' + new URLSearchParams(params).toString() : '';
    const requestPath = (path.startsWith('/') ? path : '/' + path) + query;
    const body = data ? JSON.stringify(data) : '';
    const { ts, sign } = await this.sign(method, requestPath, body);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'OK-ACCESS-KEY': this.apiKey,
      'OK-ACCESS-SIGN': sign,
      'OK-ACCESS-TIMESTAMP': ts,
      'OK-ACCESS-PASSPHRASE': this.passphrase,
    };

    const url = this.baseUrl.replace(/\/$/, '') + requestPath;
    const res = await fetch(url, { method, headers, body: body || undefined });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`OKX error ${res.status}: ${txt}`);
    }
    return res.json();
  }

  getBalance() {
    return this.request('GET', '/api/v5/account/balance');
  }

  getOpenOrders(instId?: string) {
    const params: Record<string, string> = { instType: 'SPOT' };
    if (instId) params.instId = instId;
    return this.request('GET', '/api/v5/trade/orders-pending', params);
  }

  cancelOrder(instId: string, ordId?: string, clOrdId?: string) {
    const data: any = { instId };
    if (ordId) data.ordId = ordId;
    if (clOrdId) data.clOrdId = clOrdId;
    return this.request('POST', '/api/v5/trade/cancel-order', undefined, data);
  }

  placeLimitOrder(instId: string, side: 'buy' | 'sell', price: string | number, size: string | number, clientOid?: string) {
    const data: any = {
      instId,
      tdMode: 'cash',
      side,
      ordType: 'limit',
      px: String(price),
      sz: String(size),
    };
    if (clientOid) data.clOrdId = clientOid;
    return this.request('POST', '/api/v5/trade/order', undefined, data);
  }

  // Returns filled orders (one entry per filled order) using the orders-history endpoint.
  getFilledOrders(instId?: string, limit = '100') {
    const params: Record<string, string> = { instType: 'SPOT', state: 'filled', limit };
    if (instId) params.instId = instId;
    return this.request('GET', '/api/v5/trade/orders-history', params);
  }

  // If you need per-order fill details (multiple fills per order), use this.
  getFills(instId?: string) {
    const params: Record<string, string> = {};
    if (instId) params.instId = instId;
    return this.request('GET', '/api/v5/trade/fills', params);
  }
}
