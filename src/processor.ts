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
        try {
          const cancelRes = await okx.cancelOrder(o.instId, o.ordId);
          if (cancelRes.code && cancelRes.code !== '0') {
            console.error(`Failed to cancel order ${o.ordId}: ${cancelRes.msg || cancelRes.code}`);
          }
        } catch (e) {
          console.error(`Failed to cancel order ${o.ordId} for ${o.instId}:`, e);
        }
      }
    }
    return { success: true, symbol: instId, action: 'cancel' };
  }

  // Cancel existing orders
  try {
    const existing = await okx.getOpenOrders(instId);
    if (existing && existing.data) {
      for (const o of existing.data) {
        try {
          const cancelRes = await okx.cancelOrder(o.instId, o.ordId);
          if (cancelRes.code && cancelRes.code !== '0') {
            debug(env, `Failed to cancel existing order ${o.ordId}: ${cancelRes.msg}`);
          }
        } catch (e) {
          console.error(`Failed to cancel existing order ${o.ordId} for ${o.instId}:`, e);
        }
      }
    }
  } catch (e) {
    console.warn(`Failed to fetch or cancel existing orders for ${instId}:`, e);
  }

  // Determine quote currency from instId (e.g. BTC-USDT -> USDT)
  const parts = String(instId).includes('-') ? String(instId).split('-') : String(instId).split('/');
  const baseCcy = parts[0];
  const quoteCcy = parts.length > 1 ? parts[1] : parts[0];
  debug(env, 'Currencies extracted', { baseCcy, quoteCcy, parts });

  // For buy: use quote currency; for sell: use base currency
  const targetCcy = action === 'buy' ? quoteCcy : baseCcy;
  debug(env, 'Target currency for balance check', { action, targetCcy });

  const allocationPercent = allocation[instId] || allocation[baseCcy] || 0;
  debug(env, 'Allocation lookup', { instId, baseCcy, allocationPercent, available_keys: Object.keys(allocation) });
  if (!allocationPercent) {
    debug(env, 'No allocation configured for', { instId, baseCcy });
    return { success: false, symbol: instId, action, error: 'No allocation configured' };
  }

  if (!price || price <= 0) {
    debug(env, 'Invalid price', { price });
    return { success: false, symbol: instId, action, error: 'Invalid price: must be positive' };
  }

  // Determine balance for the target currency
  let balance = 0;
  try {
    debug(env, 'Fetching balance from OKX for', { targetCcy });
    const balRes = await okx.getBalance();
    debug(env, 'Balance response', { balRes });
    if (balRes && balRes.data) {
      for (const entry of balRes.data) {
        if (entry.ccy && String(entry.ccy).toUpperCase() === String(targetCcy).toUpperCase()) {
          balance = parseFloat(entry.availBal || entry.available || entry.availEq || 0) || 0;
          debug(env, `Found balance for ${targetCcy}`, { balance, entry });
          break;
        }
        if (entry.details) {
          for (const d of entry.details) {
            if (d.ccy && String(d.ccy).toUpperCase() === String(targetCcy).toUpperCase()) {
              balance = parseFloat(d.availBal || d.availEq || 0) || 0;
              debug(env, `Found balance for ${targetCcy} in details`, { balance, detail: d });
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

  // Calculate quantity based on action
  let qty: number;
  if (action === 'buy') {
    // For buy: qty = (USDT balance * allocation%) / 100 / price
    qty = (balance * allocationPercent) / 100 / price;
    debug(env, 'Buy quantity calculation', { balance, allocationPercent, price, qty });
  } else {
    // For sell: use entire available balance (100%)
    qty = balance;
    debug(env, 'Sell quantity calculation - using full balance', { balance, qty });
  }
  if (qty <= 0) {
    debug(env, 'Insufficient balance', { qty, balance, allocationPercent });
    return { success: false, symbol: instId, action, error: 'Insufficient balance' };
  }

  // Fetch instrument specs to get proper precision
  let instSpecs: any = null;
  try {
    debug(env, 'Fetching instrument specs');
    const specRes = await okx.getInstruments(instId);
    if (specRes && specRes.data && specRes.data.length > 0) {
      instSpecs = specRes.data[0];
      debug(env, 'Instrument specs', { minSz: instSpecs.minSz, lotSz: instSpecs.lotSz, tickSz: instSpecs.tickSz });
    }
  } catch (e) {
    console.warn(`Failed to fetch instrument specs for ${instId}:`, e);
  }

  // Round qty to lot size precision (if available)
  let roundedQty = qty;
  if (instSpecs && instSpecs.lotSz) {
    const lotSize = parseFloat(instSpecs.lotSz);
    roundedQty = Math.floor(qty / lotSize) * lotSize;
    debug(env, 'Qty rounded to lot size', { original: qty, lotSz: instSpecs.lotSz, rounded: roundedQty });
  }

  if (roundedQty <= 0) {
    debug(env, 'Rounded quantity too small', { roundedQty, minSz: instSpecs?.minSz });
    return { success: false, symbol: instId, action, error: `Order size below minimum (minimum: ${instSpecs?.minSz})` };
  }

  try {
    debug(env, 'Placing order', { instId, action, price, qty: roundedQty });
    const order = await okx.placeLimitOrder(instId, action === 'buy' ? 'buy' : 'sell', price, roundedQty);
    debug(env, 'Order response', { order });
    
    // Check if OKX returned an error (code !== '0')
    if (order.code && order.code !== '0') {
      console.error(`OKX API error for ${action} order: ${order.msg || order.code}`);
      return { success: false, symbol: instId, action, error: `OKX error: ${order.msg || order.code}` };
    }
    
    debug(env, 'Order placed successfully');
    return { success: true, ...order };
  } catch (e) {
    console.error(`Failed to place ${action} order for ${instId} @ ${price} qty ${qty}:`, e);
    return { success: false, symbol: instId, action, error: String(e) };
  }
}
