// Runtime config — edit without rebuilding.
// You can also override via URL: ?user=0x...&coin=ETH&bot=https://.../bot.json
window.HYPER_CONFIG = {
  USER: "0xC3576527E94ea81f2e2b2d55ef0d5d455a9D43C8",
  BASELINE: 37.93,
  DEFAULT_COIN: "BTC",
  INFO_URL: "https://api.hyperliquid.xyz/info",
  WS_URL: "wss://api.hyperliquid.xyz/ws",
  // Where the bot status JSON lives. Relative path = bundled in the deploy.
  // Could be a public raw URL (gist / R2 / S3 / jsonbin) with CORS enabled.
  BOT_JSON_URL: "./data/bot.json",
  BOT_POLL_MS: 30000,
  STATE_POLL_MS: 5000,
};
