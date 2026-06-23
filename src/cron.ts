import { OKXClient } from './okx';
import { Database, Env } from './db';

export async function handleCron(env: Env): Promise<void> {
  try {
    const okx = new OKXClient({ OKX_API_KEY: env.OKX_API_KEY, OKX_API_SECRET: env.OKX_API_SECRET, OKX_PASSPHRASE: env.OKX_PASSPHRASE });
    const db = new Database(env.DB);

    console.log('[CRON] Starting trade reconciliation...');
    const allOrdersRes = await okx.getFilledOrders();
    console.log(`[CRON] Fetched ${allOrdersRes && allOrdersRes.data ? allOrdersRes.data.length : 0} filled orders from OKX`);
    const orders = (allOrdersRes && allOrdersRes.data) ? allOrdersRes.data : [];

    for (const o of orders) {
      const orderId = o.ordId;
      if (await db.fillExists(orderId)) continue;

      const action = String(o.side).toLowerCase() === 'buy' ? 'buy' : 'sell';
      await db.insertFill({
        ordId: orderId,
        instId: o.instId,
        fillSz: o.accFillSz,
        fillPx: o.avgPx,
        side: o.side,
        px: o.px,
        fillTime: o.uTime
      }, action);

      console.log(`[CRON] Recorded ${action.toUpperCase()} filled order: ${o.instId} x ${o.accFillSz} @ ${o.avgPx}`);
    }

    const { buys, sells } = await db.getUnmatchedFills();

    for (const buyFill of buys) {
      await db.createTrade(buyFill);
      console.log(`[CRON] Created trade: ${buyFill.symbol} BUY x ${buyFill.qty} @ ${buyFill.filled_price}`);
    }

    for (const sellFill of sells) {
      const openTrade = await db.getOpenTradeBySymbol(sellFill.symbol);
      if (openTrade) {
        await db.closeTrade(openTrade.id, sellFill);
        const pnl = (sellFill.filled_price - openTrade.buy_price) * sellFill.qty;
        const pnlPercent = ((pnl / (openTrade.buy_price * sellFill.qty)) * 100).toFixed(2);
        console.log(`[CRON] Closed trade: ${sellFill.symbol} SELL x ${sellFill.qty} @ ${sellFill.filled_price} | P&L: $${pnl.toFixed(2)} (${pnlPercent}%)`);
      }
    }
  } catch (error) {
    console.error('[CRON] Error during trade reconciliation:', error);
    throw error;
  }
}
