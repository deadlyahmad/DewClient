# Discord cape claims setup

Free capes are available only when the server can verify a Microsoft Minecraft profile or a signed-in Dew account that already has a verified Minecraft identity linked. Offline profiles cannot create claim codes.

## 1. Apply the database migration

For an existing project that already applied migration 009, run `migrations/010_persistent_discord_links_and_instant_claims.sql` in the Supabase SQL Editor. Fresh projects should apply `schema.sql`, which includes both migrations.

## 2. Configure the Discord application

In the Discord Developer Portal, open the existing DewClient application and copy its **Application ID** and **Public Key**. Add the bot to the DewClient server with permission to view and send messages in the account-link channel. No gateway connection is needed for button/modal interactions.

Set these values only in the server's private `server/.env` file:

```dotenv
DISCORD_APPLICATION_ID=1554555504410370149
DISCORD_APPLICATION_PUBLIC_KEY=6ed63e1814074f5e4a801d99ff0138b8083fa5a5917918f38523949c40b81501
DISCORD_BOT_TOKEN=bot-token
DISCORD_LINK_GUILD_ID=1540800566303662254
DISCORD_LINK_CHANNEL_ID=1557123638501576805
DISCORD_INVITE_URL=https://discord.gg/uXs2YD4D6H
```

Never put the bot token in the launcher, website, source zip, Discord message, or chat. The API verifies Discord's Ed25519 interaction signature with the public key; the bot token is used only for Discord's configuration and message publishing API.

## 3. Configure the Interactions Endpoint URL

The deployment script sets the application's **Interactions Endpoint URL** from `PUBLIC_DOMAIN`:

```text
https://server.dewclient.fun/api/v1/discord/interactions
```

Run `npm run discord:set-endpoint` from the server folder after the updated server is reachable. The server answers Discord's signed PING validation and handles button and modal submissions. Keep the endpoint publicly reachable over HTTPS through Nginx.

## 4. Publish the Link Account button

From the server folder, run:

```sh
npm run discord:publish-link-button
```

The command creates an embedded Link Account message in the configured channel. Set the printed message ID as `DISCORD_LINK_MESSAGE_ID` in the server `.env`; later runs update that same embed instead of creating duplicates. The bot needs View Channel and Send Messages permissions in that channel.

## Claim flow and safeguards

1. An administrator uploads a cape and chooses **List free** in Cosmetic Library.
2. A player selects the cape in DewClient Cosmetics and chooses **Claim**. If Discord is already linked, the claim is immediate; otherwise this first claim is carried through the link step.
3. DewClient verifies the selected Microsoft token on the server, or verifies the Dew access token and its already-linked Minecraft identity.
4. The server displays 16 distinct random words once, stores only their SHA-256 hash, and expires the code after 10 minutes. Linking can also be started from Settings without claiming a cape.
5. The player submits the words through the Discord Link Account button's private modal. The server verifies Discord's request signature and accepts the code once.
6. A database transaction links that Discord user to one Minecraft UUID and, if selected, records the initial cape claim. Future claims run directly from DewClient and update the player's cape collection without another Discord round-trip.

Unlisting a cape stops new claims and invalidates outstanding codes. Previously claimed capes remain in players' collections. The raw texture stays encrypted at rest in Supabase; after assignment, the game client must receive texture bytes to render it, so encryption at rest cannot stop an assigned player from extracting those bytes.
