# Implementation status — 8 October 2026

## Current local review build (supersedes older HUD/auth notes below)

- The launcher uses `icon/DewClient.ico` as its only DewClient logo source. Website and server dashboard image marks plus browser favicons are copies of that exact ICO; old PNG/SVG brand marks were removed from source.
- Removed the custom DewClient HUD menu/widgets and its pause/title screen entry points from the 26.3 Fabric mod. Kept DewCosmetics rendering/selection. The canonical ICO is converted at build time to a 16px transparent Minecraft font glyph for the DewClient badge beside names, and the local player's name tag is made visible in third person.
- Removed email signup/login UI and client IPC methods. Microsoft, Discord OAuth, and offline profiles remain. Discord profile creation uses a chosen Minecraft name and server-side one-calendar-month rename enforcement; Discord accounts count against the three Dew account device limit.
- Discord OAuth uses `DISCORD_APPLICATION_ID` plus a separate `DISCORD_OAUTH_CLIENT_SECRET`; the bot token cannot be used as the OAuth client secret. Register `https://server.dewclient.fun/api/v1/auth/discord/callback` in the Discord Developer Portal and configure the secret privately on the server. Migration `012_discord_accounts_and_names.sql` must be applied before Discord profile creation can work in the deployed backend.
- Source typecheck and current 26.3 Fabric build pass. Local server and website bundles have been rebuilt. The 26.3 mod remains the only version artifact and `supportVerified` remains false; no cross-version runtime claim is made.
- The Windows x64 installer is published as DewClient `1.0.0` from `server.dewclient.fun`; the marketing site remains a separate static site and does not host the client installer.

## Completed in this source update

The bullets in this section describe an earlier source update and are retained as project history. The current local state is summarized above and in the 8 October manual-test rebuild below.

- Supabase Auth email sign-in is enabled and signup remains open; email auto-confirm is disabled. The existing verified Resend SMTP configuration was preserved. Confirmation now sends an 8-digit OTP with a 60-minute expiry; the email template and Site URL use `dewclient.fun`.
- Dew account signup now has an 8-digit code entry and resend flow in the client, with new server routes for verification and resend. The UI source is not released until the client installer is published.
- Supabase migration `009_free_cape_discord_claims.sql` has been applied. The three new Discord/cape-claim tables were verified after migration.
- The admin cosmetic library now lets administrators list uploaded capes as free or unlist them. Only cape items can be listed.
- The launcher shows free cape offers in Cosmetics and routes Claim to Settings → Account & Claims. It creates a ten-minute, one-use code made of 16 distinct words and checks claim status without sending tokens or code words to logs.
- The backend verifies Microsoft Minecraft tokens or linked Dew-account sessions, verifies signed Discord interactions, links one Discord user to one Minecraft UUID, and atomically records a claim and adds the cape to the player's cape collection.
- The Discord bot message publishing script and private server configuration instructions are included.
- The Fabric 26.3 HUD has Minecraft and DewClient visual styles, a mandatory DewClient brand mark, Right Shift access, and a button on the in-game pause screen so the menu is reachable in multiplayer. Widget toggles stay off by default; cape selection remains in the HUD menu.
- Account-list and active-player sharing are always on for connected DewClient services and no longer have opt-out controls. The Privacy settings and website policy describe the exact profile fields sent; Microsoft tokens and passwords are not shared.

## Deployment state

- The API/admin server is deployed on `server.dewclient.fun`; PM2 is online and `/api/v1/health` reports Supabase healthy. Static website files were deployed to the VPS web root and match the build when requested directly from the VPS. The public `dewclient.fun` response differs from those files, so its Cloudflare origin/hosting route is not serving this VPS web root. The published favicon on the VPS is the canonical `icon/DewClient.ico`.
- The Supabase manifest advertises client `1.0.0`, minimum `1.0.0`, with the installer SHA-256 and exact byte size. The website remains in Coming Soon state. Builds numbered above `1.0.0` will not be offered this reset version by the semantic-version updater; use the installer link directly for those builds.
- Pre-update site/server folders and protected backups are retained under `/var/backups/dewclient/20261007T140628Z`, with rollback copies beside the live roots. The live `.env` was preserved with mode `600`; prior release installers were left in place.

## Build and release state

- Client and server package versions are reset to `1.0.0`. `npm run typecheck`, `npm run dist`, `npm run build:server`, `npm run build:website:prod`, the Fabric build, and `npm run build:source` succeeded. The live installer is `DewClient-1.0.0-08479ddeb6be.exe` (85,643,134 bytes; SHA-256 `08479ddeb6be3f098a9ac2ea440fd80abc4a2fc6f4fb261800a31f0ee30a62ea`).
- The current Minecraft 26.3 Fabric artifact is DewCosmetics `0.3.1`; the custom HUD has been removed. In-game nametag/cosmetic visuals still require manual verification, so `supportVerified` stays false in `DewCosmeticsLoader/versions.json`.

## 8 October 2026 local manual-test rebuild

- Fixed the nametag component so the custom bitmap font applies only to the DewClient badge glyph. The player's name now keeps Minecraft's normal font instead of inheriting the logo-only font.
- The badge texture is generated from the canonical ICO with its black matte converted to transparency and its proportions preserved. The packaged font and glyph are both present in the DewCosmetics JAR.
- Consolidated client-facing error cleanup for sign-in, account naming/linking, cosmetics, and update actions so Electron IPC, Supabase, and raw HTTP details are replaced with short actionable messages.
- Replaced the Discord callback page's text-only “D” mark with the server's canonical ICO favicon.
- Built a fresh Windows x64 installer at version `1.0.0` with the updated Minecraft 26.3 mod. It is 85,645,123 bytes; installer SHA-256: `e6b115e7cbcb8fbd8d6b9d0e75d132d233a93cc19896ed58d8506e07513720bf`.
- This is a local manual-test build; it has not been published to the VPS. `supportVerified` remains false until the user checks it in Minecraft.
- Verification completed: Fabric build, client packaging, TypeScript typecheck, server production build, website production build, installer PE/version metadata, and packaged mod/font resources. No automated test suite or in-game runtime session was run.

## Discord account linking deployment status

The owner supplied a replacement bot token, which was configured only in the VPS private `.env` (file mode 600). The bot authenticated successfully against Discord, the Link Account button was published and updated in the configured channel, and the server restarted with Supabase still connected. The published message ID is saved in the private `.env` and is intentionally not copied into this source package.

One external setting remains: verify/set the Discord Developer Portal **Interactions Endpoint URL** to `https://server.dewclient.fun/api/v1/discord/interactions`. The local server endpoint is deployed and responds publicly, but the portal value could not be verified in the open browser session. Until Discord's Developer Portal points to this URL, button/modal interactions may not reach the server. See `server/DISCORD-LINKING.md` for the exact setting and full flow.

## Texture confidentiality limit

Cosmetic files remain encrypted at rest in Supabase. Once an assigned cape reaches a game client, that client must receive the decoded texture to render it; an owner can extract those bytes. The code does not claim DRM or copy-proof delivery.
