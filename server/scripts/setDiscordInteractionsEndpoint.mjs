import { CONFIG } from '../src/config.mjs';

if (!CONFIG.DISCORD_BOT_TOKEN || !CONFIG.DISCORD_APPLICATION_ID || !CONFIG.DISCORD_APPLICATION_PUBLIC_KEY || !CONFIG.PUBLIC_DOMAIN) {
  throw new Error('Set the Discord application values, bot token, and PUBLIC_DOMAIN in server/.env first.');
}

const endpoint = new URL('/api/v1/discord/interactions', `https://${CONFIG.PUBLIC_DOMAIN}`).toString();
const response = await fetch('https://discord.com/api/v10/applications/@me', {
  method: 'PATCH',
  headers: {
    Authorization: `Bot ${CONFIG.DISCORD_BOT_TOKEN}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ interactions_endpoint_url: endpoint }),
  signal: AbortSignal.timeout(15_000)
});

const result = await response.json().catch(() => ({}));
if (!response.ok) {
  throw new Error(`Discord rejected the interactions endpoint configuration (HTTP ${response.status}).`);
}
if (result.interactions_endpoint_url !== endpoint) {
  throw new Error('Discord did not confirm the expected DewClient interactions endpoint.');
}
console.log(`Discord interactions endpoint configured: ${endpoint}`);
