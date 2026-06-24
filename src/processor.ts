import { OKXClient } from './okx';
import { Database, Env } from './db';
import { AllocationConfig } from './types';
import { debug } from './debug';

export async function processSignal(env: Env, signal: any, allocation: AllocationConfig) {
  debug(env, 'Signal received', { signal, allocation });
  const okx = new OKXClient({ OKX_API_KEY: env.OKX_API_KEY, OKX_API_SECRET: env.OKX_API_SECRET, OKX_PASSPHRASE: env.OKX_PASSPHRASE });
  const instId = signal.symbol;
  const action = signal.action; // 'buy' | 'sell' | 'cancel'
  const price = signal.price;
  debug(env, 'Parsed signal', { instId, action, price });

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
  debug(env, 'Quote currency extracted', { quoteCcy, parts });

  const allocationPercent = allocation[instId] || allocation[parts[0]] || 0;
  debug(env, 'Allocation lookup', { instId, baseCcy: parts[0], allocationPercent, available_keys: Object.keys(allocation) });
  if (!allocationPercent) {
    debug(env, 'No allocation configured for', { instId, parts });
    return { success: false, symbol: instId, action, error: 'No allocation configured' };
  }

  if (!price || price <= 0) {
    debug(env, 'Invalid price', { price });
    return { success: false, symbol: instId, action, error: 'Invalid price: must be positive' };
  }

  // Determine quote balance for that currency
  let quoteBalance = 0;
  try {
    debug(env, 'Fetching balance from OKX');
    const balRes = await okx.getBalance();
    debug(env, 'Balance response', { balRes });
    if (balRes && balRes.data) {
      // OKX returns array of balances; search for matching currency code
      for (const entry of balRes.data) {
        // entry may represent a currency bucket or have nested details
        if (entry.ccy && String(entry.ccy).toUpperCase() === String(quoteCcy).toUpperCase()) {
          quoteBalance = parseFloat(entry.availBal || entry.available || entry.availEq || 0) || 0;
          debug(env, `Found balance for ${quoteCcy}`, { quoteBalance, entry });
          break;
        }
        if (entry.details) {
          for (const d of entry.details) {
            if (d.ccy && String(d.ccy).toUpperCase() === String(quoteCcy).toUpperCase()) {
              quoteBalance = parseFloat(d.availBal || d.availEq || 0) || 0;
              debug(env, `Found balance for ${quoteCcy} in details`, { quoteBalance, detail: d });
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

  debug(env, 'Balance calculation', { quoteCcy, quoteBalance, allocationPercent, price });
  const qty = (quoteBalance * allocationPercent) / 100 / price;
  debug(env, 'Calculated quantity', { qty });
  if (qty <= 0) {
    debug(env, 'Insufficient capital', { qty, quoteBalance, allocationPercent });
    return { success: false, symbol: instId, action, error: 'Insufficient capital' };
  }

  try {
    debug(env, 'Placing order', { instId, action, price, qty });
    const order = await okx.placeLimitOrder(instId, action === 'buy' ? 'buy' : 'sell', price, qty, `${instId}_${action}_${Date.now()}`);
    debug(env, 'Order placed', { order });
    return order;
  } catch (e) {
    console.error(`Failed to place ${action} order for ${instId} @ ${price} qty ${qty}:`, e);
    return { success: false, symbol: instId, action, error: String(e) };
  }
}
