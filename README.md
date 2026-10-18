# TONY ALPHA — live Hyperliquid dashboard (static, read-only)

Light "OceanView"-style admin layout (sidebar, status bar, equity hero chart, info cards, positions/orders/history/evolution/journal/alerts).
Plain HTML/CSS/JS + inline SVG charts, no build step, no backend, no keys. Reads the public
`https://api.hyperliquid.xyz/info` (POST) and `wss://api.hyperliquid.xyz/ws`.
All times are shown in UTC; daily PnL uses UTC midnight as the day boundary.

- `index.html`, `style.css`, `app.js` — the dashboard
- `config.js` — account, baseline, default coin, `BOT_JSON_URL` (default `./data/bot.json`)
- `data/bot.example.json` — schema for the bot status file; the box bot publishes `data/bot.json`
- `.github/workflows/pages.yml` — deploys the repo root to GitHub Pages on every push to `main`

URL overrides: `?coin=ETH`, `?user=0x...`, `?bot=https://.../bot.json`

`data/bot.json` is PUBLIC — never put keys or secrets in it.

Run locally: `python3 -m http.server 8080` and open http://localhost:8080

`data/bot.json` extra fields used by the dashboard: `version`, `pnl` (today/7d/total), `equity_history`, `trades`,
`position_details`, `margin_used`, `margin_cap_pct`, `session_utc`, `kill_level_usd` — all derived from the bot's local files.
