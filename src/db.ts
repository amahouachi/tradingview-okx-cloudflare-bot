export type DbFill = {
  id: string;
  symbol: string;
  action: string;
  qty: number;
  limit_price: number;
  filled_price: number;
  filled_at: string;
  polled_at: string;
};

export type DbTrade = {
  id: string;
  symbol: string;
  buy_order_id: string;
  sell_order_id: string | null;
  buy_qty: number;
  buy_price: number;
  buy_filled_at: string;
  sell_qty: number | null;
  sell_price: number | null;
  sell_filled_at: string | null;
  status: 'open' | 'closed';
  pnl: number | null;
  pnl_percent: number | null;
  created_at: string;
  closed_at: string | null;
};

export class Database {
  constructor(private db: any) {}

  async insertFill(fill: any, action: string): Promise<void> {
    const id = fill.ordId;
    const symbol = fill.instId;
    const qty = parseFloat(fill.fillSz) || 0;
    const filledPrice = parseFloat(fill.fillPx) || 0;
    const limitPrice = parseFloat(fill.px) || null;
    const filledAt = fill.fillTime || new Date().toISOString();

    await this.db.prepare(`
      INSERT OR IGNORE INTO fills (id, symbol, action, qty, limit_price, filled_price, filled_at, polled_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(id, symbol, action, qty, limitPrice, filledPrice, filledAt, new Date().toISOString()).run();
  }

  async getUnmatchedFills(): Promise<{ buys: DbFill[]; sells: DbFill[] }> {
    const buyResult = await this.db.prepare(`
      SELECT f.* FROM fills f
      LEFT JOIN trades t ON f.id = t.buy_order_id
      WHERE f.action = 'buy' AND t.buy_order_id IS NULL
      ORDER BY f.filled_at ASC
    `).all();
    const buys = buyResult.results || [];

    const sellResult = await this.db.prepare(`
      SELECT f.* FROM fills f
      LEFT JOIN trades t ON f.id = t.sell_order_id
      WHERE f.action = 'sell' AND t.sell_order_id IS NULL
      ORDER BY f.filled_at ASC
    `).all();
    const sells = sellResult.results || [];

    return { buys, sells };
  }

  async getOpenTradeBySymbol(symbol: string): Promise<DbTrade | null> {
    const result = await this.db.prepare(`
      SELECT * FROM trades
      WHERE symbol = ? AND status = 'open'
      ORDER BY created_at ASC
      LIMIT 1
    `).bind(symbol).first();

    return result || null;
  }

  async createTrade(buyFill: DbFill): Promise<void> {
    const tradeId = `${buyFill.symbol}_${Date.now()}`;

    await this.db.prepare(`
      INSERT INTO trades (
        id, symbol, buy_order_id, buy_qty, buy_price, buy_filled_at, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'open', CURRENT_TIMESTAMP)
    `).bind(tradeId, buyFill.symbol, buyFill.id, buyFill.qty, buyFill.filled_price, buyFill.filled_at).run();
  }

  async closeTrade(tradeId: string, sellFill: DbFill): Promise<void> {
    const trade = await this.getTrade(tradeId);
    if (!trade) return;
    const pnl = (sellFill.filled_price - trade.buy_price) * sellFill.qty;
    const investedCapital = trade.buy_price * sellFill.qty;
    const pnlPercent = investedCapital ? (pnl / investedCapital) * 100 : 0;

    await this.db.prepare(`
      UPDATE trades
      SET sell_order_id = ?, sell_qty = ?, sell_price = ?, sell_filled_at = ?,
          status = 'closed', pnl = ?, pnl_percent = ?, closed_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(sellFill.id, sellFill.qty, sellFill.filled_price, sellFill.filled_at, pnl, pnlPercent, tradeId).run();
  }

  async getTrade(tradeId: string): Promise<DbTrade | null> {
    const result = await this.db.prepare(`
      SELECT * FROM trades WHERE id = ?
    `).bind(tradeId).first();

    return result || null;
  }

  async fillExists(orderId: string): Promise<boolean> {
    const result = await this.db.prepare(`
      SELECT id FROM fills WHERE id = ? LIMIT 1
    `).bind(orderId).first();

    return !!result;
  }
}

export interface Env {
  DB: any;
  OKX_API_KEY: string;
  OKX_API_SECRET: string;
  OKX_PASSPHRASE: string;
  WEBHOOK_ENDPOINT?: string;
  WEBHOOK_SECRET?: string;
  ALLOCATION_CONFIG?: string;
}
