import { OKXClient } from './okx';
import { Database, Env } from './db';
import { AllocationConfig } from './types';

export async function processSignal(env: Env, signal: any, allocation: AllocationConfig) {
  const okx = new OKXClient({ OKX_API_KEY: env.OKX_API_KEY, OKX_API_SECRET: env.OKX_API_SECRET, OKX_PASSPHRASE: env.OKX_PASSPHRASE });
  const instId = signal.symbol;
  const action = signal.action; // 'buy' | 'sell' | 'cancel'
  const price = signal.price;

  if (action === 'cancel') {
    const openOrders = await okx.getOpenOrders(instId);
    if (openOrders && openOrders.data) {
      for (const o of openOrders.data) {
        try { await okx.cancelOrder(o.instId, o.ordId); } catch (e) { console.error(`Failed to cancel order ${o.ordId} for ${o.instId}:`, e); }
      }
    }
    return { success: true, symbol: instId, action: 'cancel' };
  }

  // Cancel existing orders
  try {
    const existing = await okx.getOpenOrders(instId);
    if (existing && existing.data) {
      for (const o of existing.data) {
        try { await okx.cancelOrder(o.instId, o.ordId); } catch (e) { console.error(`Failed to cancel existing order ${o.ordId} for ${o.instId}:`, e); }
      }
    }
  } catch (e) {
    console.warn(`Failed to fetch or cancel existing orders for ${instId}:`, e);
  }

  // Determine quote currency from instId (e.g. BTC-USDT -> USDT)
  const parts = String(instId).includes('-') ? String(instId).split('-') : String(instId).split('/');
  const quoteCcy = parts.length > 1 ? parts[1] : parts[0];

  // Determine quote balance for that currency
  let quoteBalance = 0;
  try {
    const balRes = await okx.getBalance();
    if (balRes && balRes.data) {
      // OKX returns array of balances; search for matching currency code
      for (const entry of balRes.data) {
        // entry may represent a currency bucket or have nested details
        if (entry.ccy && String(entry.ccy).toUpperCase() === String(quoteCcy).toUpperCase()) {
          quoteBalance = parseFloat(entry.availBal || entry.available || entry.availEq || 0) || 0;
          break;
        }
        if (entry.details) {
          for (const d of entry.details) {
            if (d.ccy && String(d.ccy).toUpperCase() === String(quoteCcy).toUpperCase()) {
              quoteBalance = parseFloat(d.availBal || d.availEq || 0) || 0;
              break;
            }
          }
        }
      }
    }
  } catch (e) {
    console.error('Failed to fetch balance from OKX:', e);
    return { success: false, symbol: instId, action, error: `Failed to fetch balance: ${e}` };
  }

  const allocationPercent = allocation[instId] || allocation[parts[0]] || 0;
  if (!allocationPercent) {
    return { success: false, symbol: instId, action, error: 'No allocation configured' };
  }

  if (!price || price <= 0) {
    return { success: false, symbol: instId, action, error: 'Invalid price: must be positive' };
  }

  const qty = (quoteBalance * allocationPercent) / 100 / price;
  if (qty <= 0) return { success: false, symbol: instId, action, error: 'Insufficient capital' };

  try {
    const order = await okx.placeLimitOrder(instId, action === 'buy' ? 'buy' : 'sell', price, qty, `${instId}_${action}_${Date.now()}`);
    return order;
  } catch (e) {
    console.error(`Failed to place ${action} order for ${instId} @ ${price} qty ${qty}:`, e);
    return { success: false, symbol: instId, action, error: String(e) };
  }
}
