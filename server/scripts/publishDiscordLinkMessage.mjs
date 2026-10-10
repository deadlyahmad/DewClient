import { CONFIG } from '../src/config.mjs';

if (!CONFIG.DISCORD_BOT_TOKEN || !CONFIG.DISCORD_LINK_CHANNEL_ID) {
  throw new Error('Set DISCORD_BOT_TOKEN and DISCORD_LINK_CHANNEL_ID in server/.env first.');
}

const message = {
  content: null,
  embeds: [{
    title: 'Link your DewClient account',
    description: 'Link your Microsoft Minecraft profile to this Discord account with the one-time code. This confirms you joined the DewClient community; it never gives Discord sign-in access to your Microsoft profile, or Microsoft sign-in access to a separate Discord profile.',
    color: 0x171717,
    fields: [
      { name: '1 · Get your one-time code', value: 'In DewClient, open **Settings → Account → Link Discord** and copy the 16 words. The code expires after 10 minutes.', inline: false },
      { name: '2 · Link privately', value: 'Press **Link Account** and paste the code into the private form. Your code is never posted in this channel.', inline: false },
      { name: 'After linking', value: 'Choose **Claim** on a free cape in DewClient. Future claims use this verified server link. Signing in with Discord remains a separate DewClient profile.', inline: false }
    ],
    footer: { text: 'DewClient · Account linking and free cape claims' }
  }],
  components: [{
    type: 1,
    components: [{
      type: 2,
      style: 1,
      label: 'Link Account',
      custom_id: 'dewclient:link-account'
    }]
  }],
  allowed_mentions: { parse: [] }
};

const base = `https://discord.com/api/v10/channels/${CONFIG.DISCORD_LINK_CHANNEL_ID}/messages`;
const isUpdate = Boolean(CONFIG.DISCORD_LINK_MESSAGE_ID);
const response = await fetch(isUpdate ? `${base}/${CONFIG.DISCORD_LINK_MESSAGE_ID}` : base, {
  method: isUpdate ? 'PATCH' : 'POST',
  headers: {
    Authorization: `Bot ${CONFIG.DISCORD_BOT_TOKEN}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify(message),
  signal: AbortSignal.timeout(15_000)
});
if (!response.ok) {
  const details = await response.text();
  throw new Error(`Discord could not publish the Link Account message (HTTP ${response.status}): ${details.slice(0, 500)}`);
}
const result = await response.json();
console.log(`Link Account message ${isUpdate ? 'updated' : 'created'}: ${result.id}`);
if (!isUpdate) console.log('Add this to server/.env as DISCORD_LINK_MESSAGE_ID to let future runs update this same message.');
