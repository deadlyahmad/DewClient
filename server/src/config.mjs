/**
 * DewClient Central Server - Configuration & Environment Constants
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import fs from 'node:fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Detect server root directory (supports both server/src/ dev and dist-server/ bundle)
const candidateDirs = [
  __dirname,
  path.resolve(__dirname, '..'),
  process.cwd()
];

let serverRoot = __dirname;
for (const dir of candidateDirs) {
  if (fs.existsSync(path.join(dir, 'public'))) {
    serverRoot = dir;
    break;
  }
}

// Load .env automatically if it exists (Node 20+)
for (const dir of candidateDirs) {
  const envPath = path.join(dir, '.env');
  if (fs.existsSync(envPath)) {
    try {
      process.loadEnvFile(envPath);
      break;
    } catch {}
  }
}

export const CONFIG = {
  PORT: Number(process.env.PORT || '8787'),
  HOST: process.env.HOST || '127.0.0.1',
  ENV: process.env.NODE_ENV || 'production',

  SUPABASE_URL: (process.env.SUPABASE_URL || '').replace(/\/+$/, ''),
  SUPABASE_HTTP_TIMEOUT_MS: Number(process.env.SUPABASE_HTTP_TIMEOUT_MS || '15000'),
  SUPABASE_HTTP_RETRIES: Number(process.env.SUPABASE_HTTP_RETRIES || '2'),
  // Prefer Supabase's current key names, while retaining legacy aliases for
  // existing deployments during the platform's API-key transition.
  SUPABASE_KEY: process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  SUPABASE_ANON_KEY: process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || '',

  ADMIN_SESSION_SECRET: process.env.ADMIN_SESSION_SECRET || '',
  ADMIN_SESSION_TTL_MS: Number(process.env.ADMIN_SESSION_TTL_MS || 8 * 60 * 60 * 1000),
  COSMETIC_ASSET_ENCRYPTION_KEY: process.env.COSMETIC_ASSET_ENCRYPTION_KEY || '',
  TRUST_PROXY: process.env.TRUST_PROXY === 'true',
  CORS_ORIGINS: (process.env.CORS_ORIGINS || 'null').split(',').map((origin) => origin.trim()).filter(Boolean),
  PUBLIC_DIR: path.join(serverRoot, 'public'),
  RELEASE_DIR: path.resolve(process.env.DEWCLIENT_RELEASE_DIR || path.join(serverRoot, 'releases')),

  PUBLIC_DOMAIN: (process.env.PUBLIC_DOMAIN || '').replace(/^https?:\/\//i, '').replace(/\/+$/, ''),

  // Optional until the Discord linking workflow is enabled in production.
  DISCORD_APPLICATION_PUBLIC_KEY: process.env.DISCORD_APPLICATION_PUBLIC_KEY || '',
  DISCORD_APPLICATION_ID: process.env.DISCORD_APPLICATION_ID || '',
  DISCORD_OAUTH_CLIENT_SECRET: process.env.DISCORD_OAUTH_CLIENT_SECRET || '',
  DISCORD_BOT_TOKEN: process.env.DISCORD_BOT_TOKEN || '',
  DISCORD_LINK_GUILD_ID: process.env.DISCORD_LINK_GUILD_ID || '',
  DISCORD_LINK_CHANNEL_ID: process.env.DISCORD_LINK_CHANNEL_ID || '',
  DISCORD_LINK_MESSAGE_ID: process.env.DISCORD_LINK_MESSAGE_ID || '',
  DISCORD_INVITE_URL: process.env.DISCORD_INVITE_URL || 'https://discord.gg/uXs2YD4D6H',
};

export function validateServerConfig() {
  const problems = [];
  if (!Number.isInteger(CONFIG.PORT) || CONFIG.PORT < 1 || CONFIG.PORT > 65535) problems.push('PORT must be an integer from 1 to 65535');
  if (!CONFIG.SUPABASE_URL || !/^https:\/\//i.test(CONFIG.SUPABASE_URL)) problems.push('SUPABASE_URL must be a valid HTTPS URL');
  if (!Number.isInteger(CONFIG.SUPABASE_HTTP_TIMEOUT_MS) || CONFIG.SUPABASE_HTTP_TIMEOUT_MS < 1000 || CONFIG.SUPABASE_HTTP_TIMEOUT_MS > 120000) problems.push('SUPABASE_HTTP_TIMEOUT_MS must be between 1000 and 120000');
  if (!Number.isInteger(CONFIG.SUPABASE_HTTP_RETRIES) || CONFIG.SUPABASE_HTTP_RETRIES < 0 || CONFIG.SUPABASE_HTTP_RETRIES > 5) problems.push('SUPABASE_HTTP_RETRIES must be between 0 and 5');
  if (!CONFIG.SUPABASE_KEY) problems.push('SUPABASE_SECRET_KEY (or the legacy SUPABASE_KEY/SUPABASE_SERVICE_ROLE_KEY) is required');
  if (Buffer.byteLength(CONFIG.ADMIN_SESSION_SECRET, 'utf8') < 32) problems.push('ADMIN_SESSION_SECRET must contain at least 32 bytes');
  if (!/^[a-f0-9]{64}$/i.test(CONFIG.COSMETIC_ASSET_ENCRYPTION_KEY)) problems.push('COSMETIC_ASSET_ENCRYPTION_KEY must be a 32-byte (64 hexadecimal character) key');
  if (!Number.isSafeInteger(CONFIG.ADMIN_SESSION_TTL_MS) || CONFIG.ADMIN_SESSION_TTL_MS < 60_000 || CONFIG.ADMIN_SESSION_TTL_MS > 30 * 24 * 60 * 60 * 1000) {
    problems.push('ADMIN_SESSION_TTL_MS must be between 60000 and 2592000000');
  }
  if (!CONFIG.PUBLIC_DOMAIN) problems.push('PUBLIC_DOMAIN is required for release URLs');
  else {
    try {
      const parsed = new URL(`https://${CONFIG.PUBLIC_DOMAIN}`);
      if (parsed.host !== CONFIG.PUBLIC_DOMAIN || parsed.username || parsed.password) problems.push('PUBLIC_DOMAIN must contain only a public hostname and optional port');
    } catch {
      problems.push('PUBLIC_DOMAIN must contain only a public hostname and optional port');
    }
  }
  if (CONFIG.CORS_ORIGINS.includes('*')) problems.push('CORS_ORIGINS must not contain a wildcard');
  const discordInteractionValues = [CONFIG.DISCORD_APPLICATION_PUBLIC_KEY, CONFIG.DISCORD_BOT_TOKEN, CONFIG.DISCORD_LINK_CHANNEL_ID];
  if (discordInteractionValues.some(Boolean) && (discordInteractionValues.some((value) => !value) || !CONFIG.DISCORD_APPLICATION_ID || !CONFIG.DISCORD_LINK_GUILD_ID)) {
    problems.push('Discord cape linking requires DISCORD_APPLICATION_PUBLIC_KEY, DISCORD_APPLICATION_ID, DISCORD_BOT_TOKEN, DISCORD_LINK_GUILD_ID, and DISCORD_LINK_CHANNEL_ID together');
  }
  if (CONFIG.DISCORD_APPLICATION_PUBLIC_KEY && !/^[a-f0-9]{64}$/i.test(CONFIG.DISCORD_APPLICATION_PUBLIC_KEY)) problems.push('DISCORD_APPLICATION_PUBLIC_KEY must be 32-byte hexadecimal');
  if (CONFIG.DISCORD_OAUTH_CLIENT_SECRET && !CONFIG.DISCORD_APPLICATION_ID) problems.push('DISCORD_APPLICATION_ID is required when Discord OAuth sign-in is configured');
  if (CONFIG.DISCORD_OAUTH_CLIENT_SECRET && !CONFIG.DISCORD_LINK_GUILD_ID) problems.push('DISCORD_LINK_GUILD_ID is required so Discord sign-in can activate cape claims');
  for (const id of [CONFIG.DISCORD_APPLICATION_ID, CONFIG.DISCORD_LINK_GUILD_ID, CONFIG.DISCORD_LINK_CHANNEL_ID, CONFIG.DISCORD_LINK_MESSAGE_ID].filter(Boolean)) {
    if (!/^\d{17,20}$/.test(id)) problems.push('Discord application, guild, channel, and message IDs must be numeric snowflakes');
  }
  for (const origin of CONFIG.CORS_ORIGINS) {
    if (origin === 'null') continue;
    try {
      const parsed = new URL(origin);
      if (!['https:', ...(CONFIG.ENV === 'development' ? ['http:'] : [])].includes(parsed.protocol) || parsed.origin !== origin) {
        problems.push(`CORS origin is not allowed: ${origin}`);
      }
    } catch {
      problems.push(`CORS origin is invalid: ${origin}`);
    }
  }
  if (problems.length) throw new Error(`Invalid server configuration: ${problems.join('; ')}.`);
}
