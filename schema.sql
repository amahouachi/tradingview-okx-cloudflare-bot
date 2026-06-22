-- Create fills table (individual order fills from Alpaca)
CREATE TABLE IF NOT EXISTS fills (
  id TEXT PRIMARY KEY,
  symbol TEXT NOT NULL,
  action TEXT NOT NULL,
  qty REAL NOT NULL,
  limit_price REAL,
  filled_price REAL,
  filled_at DATETIME,
  polled_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Create trades table (buy-sell pairs)
CREATE TABLE IF NOT EXISTS trades (
  id TEXT PRIMARY KEY,
  symbol TEXT NOT NULL,
  buy_order_id TEXT NOT NULL UNIQUE,
  sell_order_id TEXT,
  
  buy_qty REAL NOT NULL,
  buy_price REAL NOT NULL,
  buy_filled_at DATETIME NOT NULL,
  
  sell_qty REAL,
  sell_price REAL,
  sell_filled_at DATETIME,
  
  status TEXT DEFAULT 'open',
  pnl REAL,
  pnl_percent REAL,
  
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  closed_at DATETIME
);

-- Index for faster queries
CREATE INDEX IF NOT EXISTS idx_symbol ON trades(symbol);
CREATE INDEX IF NOT EXISTS idx_status ON trades(status);
CREATE INDEX IF NOT EXISTS idx_created_at ON trades(created_at);
