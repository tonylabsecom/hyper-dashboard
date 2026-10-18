# HYPER // QUANTBOT — live Hyperliquid dashboard (static, read-only)

Plain HTML/CSS/JS, no build step, no backend, no keys. Reads the public
`https://api.hyperliquid.xyz/info` (POST) and `wss://api.hyperliquid.xyz/ws`.
All times are shown in Vietnam time (Asia/Saigon, UTC+7).

- `index.html`, `style.css`, `app.js` — the dashboard
- `config.js` — account, baseline, default coin, `BOT_JSON_URL` (default `./data/bot.json`)
- `data/bot.example.json` — schema for the bot status file; the box bot publishes `data/bot.json`
- `.github/workflows/pages.yml` — deploys the repo root to GitHub Pages on every push to `main`

URL overrides: `?coin=ETH`, `?user=0x...`, `?bot=https://.../bot.json`

`data/bot.json` is PUBLIC — never put keys or secrets in it.

Run locally: `python3 -m http.server 8080` and open http://localhost:8080
