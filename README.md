# TradingView OKX Cloudflare Bot

A Cloudflare Worker that executes trading signals from TradingView webhooks on OKX exchange, with automatic trade reconciliation via D1 database.

## Features

- **Webhook Signal Execution**: Receive buy/sell/cancel signals from TradingView and execute on OKX Spot
- **Allocation-Based Position Sizing**: Configure percentage allocation per symbol
- **Automatic Order Cancellation**: Cancels existing orders before placing new ones
- **Trade Reconciliation**: Hourly cron job matches filled buy/sell orders and calculates P&L
- **Secure**: Token-based webhook authentication, secrets stored in Cloudflare

## Setup

### Prerequisites
- Cloudflare account
- OKX API credentials (API Key, Secret, Passphrase)
- Node.js + npm

### 1. Install Dependencies
```bash
npm install
```

### 2. Create D1 Database
```bash
wrangler d1 create okx-trading-bot
```
Copy the `database_id` output and update `wrangler.toml`.

### 3. Initialize Schema
```bash
wrangler d1 execute okx-trading-bot --file schema.sql
```

### 4. Set Secrets
```bash
wrangler secret put OKX_API_KEY
wrangler secret put OKX_API_SECRET
wrangler secret put OKX_PASSPHRASE
wrangler secret put WEBHOOK_SECRET
```

### 5. Deploy
```bash
npm run build
wrangler deploy
```

## Configuration

Edit `wrangler.toml`:
- `WEBHOOK_ENDPOINT`: Webhook path (default: `/tradingview-webhook`)
- `ALLOCATION_CONFIG`: JSON object with symbol → percentage allocation
  ```json
  {"SOL-USDT": 33, "ETH-USDT": 33, "ZEC-USDT": 33}
  ```
- `crons`: Schedule for reconciliation (default: `55 * * * *` = 55 minutes every hour)

## Usage

### Send Signals
```bash
curl -X POST "https://your-worker.workers.dev/tradingview-webhook?token=YOUR_WEBHOOK_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "buy",
    "symbol": "SOL-USDT",
    "price": 150.50
  }'
```

**Actions**: `buy`, `sell`, `cancel`

### Database Schema

**fills** table: Individual order executions
**trades** table: Matched buy-sell pairs with P&L tracking

## How It Works

1. **Webhook Handler** (`index.ts`):
   - Validates token
   - Receives signal from TradingView
   - Queues signal processing

2. **Signal Processor** (`processor.ts`):
   - Cancels existing orders
   - Fetches account balance
   - Calculates position size based on allocation %
   - Places limit order on OKX

3. **Cron Job** (`cron.ts`):
   - Polls filled orders from OKX
   - Records fills in database
   - Matches buy/sell pairs into trades
   - Calculates P&L per trade

## Error Handling

- Invalid signals → `200 OK` (silent, logged)
- Auth failure → `401 Unauthorized`
- Config error → `500 Internal Server Error`
- Processing errors → Logged, gracefully handled

## License

Private
