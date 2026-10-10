> **Archived server source — 10 October 2026.** Maintainer: Fateh. Official DewClient updates and legacy downloads have been retired/disconnected. This documentation describes the historical service; do not assume official API hosts or cloud features are available. Independent forks must configure and secure their own infrastructure and must not publish the official DewClient branding. See [`../RETIREMENT.md`](../RETIREMENT.md), [`../COPYING.md`](../COPYING.md), and [`../FORKING.md`](../FORKING.md).

# DewClient Central Server

Node.js HTTP server, Supabase PostgREST adapter, staff dashboard, SQL schema/migration, and installer storage for the DewClient launcher. The server uses Node built-ins and has no server runtime npm dependencies. Use Node.js 20.12 or newer.

## Database

For a new Supabase PostgreSQL project, apply [`schema.sql`](./schema.sql) in the SQL editor. For an existing project, apply all unapplied migrations from `001` and `002`, both files numbered `003` (they modify independent objects), then `004` through `020` in order. Migration `003_admin_only.sql` enforces the single administrator tier. Migration `003_remove_placeholder_defaults.sql` removes legacy defaults. Migration `004_signup_availability.sql` adds a legacy service-role-only RPC; the current launcher no longer uses email/password Dew account sign-in. Migration `007_multi_cosmetic_assignments.sql` protects all assigned cosmetic collection items from deletion. Migration `008_bug_reports.sql` creates the private administrator-only bug report queue. Migration `009_free_cape_discord_claims.sql` adds free-cape listing and Discord links. Migration `010_persistent_discord_links_and_instant_claims.sql` adds one-time account linking, optional claim-on-link, and direct future claims. Migration `011_remove_admin_only_auth_signup_trigger.sql` removes an obsolete hard-coded Auth allowlist trigger. Migration `012_discord_accounts_and_names.sql` creates Discord-backed player profiles and enforces their one-month name-change cooldown. Migration `013_discord_link_display_names.sql` stores the linked Discord name for the account settings UI. Migration `014_separate_discord_login_from_server_link.sql` keeps Discord OAuth profiles separate from guild-verified profile links while allowing one Discord user to verify multiple independent profiles. Migration `015_atomic_cosmetic_deletion.sql` makes admin cosmetic deletion atomic: it clears the cosmetic from player selections and collections, bumps affected profile versions for client resync, removes assignment and library rows, and deletes the unreferenced binary asset. Migration `016_transactional_client_account_sync.sql` upserts launcher account metadata with required Dew identity fields and stable Dew account IDs. Migration `017_fix_discord_profile_uuid_validation.sql` aligns Discord profile creation with Minecraft offline UUIDv3 and reports actual username conflicts distinctly. Migration `018_claimed_cape_collection_and_equipping.sql` repairs collections for already-claimed free capes and adds an ownership-checked equip action that updates the active cape selection. Migration `019_publish_windows_1_0_0_release.sql` publishes the Windows 1.0.0 download metadata while preserving other manifest fields. Migration `020_clear_selected_cape.sql` allows a player to switch from an equipped DewClient cape back to a Microsoft cape without removing any claimed cosmetics. Supabase HTTP requests use bounded timeouts and retries for safe reads; writes are not retried. The server verifies access to `dew_manifest` and `dew_admins` before listening.

The schema contains `dew_clients`, `dew_accounts`, `dew_player_presence`, `dew_manifest`, `dew_cosmetics`, `dew_cosmetic_assets`, `dew_cosmetic_library`, and `dew_admins`. Manifest, staff, player presence, cosmetics, and asset rows are service-role-only under RLS. The public API selectively returns enabled manifest records, opted-in online profiles, and assigned cosmetic data/assets. This source implements one staff tier: every active staff account is an administrator, and the schema constrains `dew_admins.role` to `admin`.

The schema also installs `dew_bootstrap_admin` for race-safe first-admin creation, `dew_is_cosmetic_asset_assigned` for public asset authorization, and a trigger that preserves at least one active admin and increments session versions after credential/role/status changes.

## Configuration

Copy [`.env.example`](./.env.example) to `.env` and replace placeholders. Never commit the real file or expose a Supabase secret/service-role key to the desktop client.

| Variable | Requirement and behavior |
|---|---|
| `SUPABASE_URL` | Required HTTPS Supabase project URL. |
| `SUPABASE_SECRET_KEY` | Required backend-only key; legacy `SUPABASE_KEY` and `SUPABASE_SERVICE_ROLE_KEY` aliases remain accepted. Never ship this key to the desktop client. |
| `SUPABASE_PUBLISHABLE_KEY` | Required for launcher Dew user signup/login; used only by the server to call Supabase Auth. Legacy `SUPABASE_ANON_KEY` remains accepted. It is never shipped to the desktop client. |
| `ADMIN_SESSION_SECRET` | Required stable secret, minimum 32 bytes. |
| `COSMETIC_ASSET_ENCRYPTION_KEY` | Required stable 32-byte key encoded as 64 hexadecimal characters (`openssl rand -hex 32`). Encrypts cosmetic asset rows at rest with AES-256-GCM. Back it up securely and do not rotate it without a planned asset re-encryption. |
| `PUBLIC_DOMAIN` | Required public API host used for HTTPS installer links. |
| `PORT` | Optional, default `8787`, valid range 1-65535. |
| `HOST` | Optional, default `127.0.0.1`. |
| `NODE_ENV` | Optional, default `production`; only `development` allows HTTP CORS origins. |
| `ADMIN_SESSION_TTL_MS` | Optional, default 28,800,000 ms; range 60,000 ms to 30 days. |
| `CORS_ORIGINS` | Optional comma-separated exact origins, default `null`; no wildcard. |
| `TRUST_PROXY` | Optional; literal `true` trusts one forwarded IP only from a loopback peer. |
| `DEWCLIENT_RELEASE_DIR` | Optional persistent release directory; defaults to `releases` under the server root. |
| `DISCORD_APPLICATION_PUBLIC_KEY`, `DISCORD_APPLICATION_ID`, `DISCORD_BOT_TOKEN`, `DISCORD_LINK_GUILD_ID`, `DISCORD_LINK_CHANNEL_ID` | Optional as a complete group until Discord linking is enabled. Keep the bot token private in `server/.env`; see [`DISCORD-LINKING.md`](./DISCORD-LINKING.md). |
| `DISCORD_OAUTH_CLIENT_SECRET` | Optional until Discord sign-in is configured. This is the OAuth2 client secret from the Discord application, not the bot token. Register `https://server.dewclient.fun/api/v1/auth/discord/callback` as an OAuth2 redirect URI. |
| `DISCORD_LINK_MESSAGE_ID` | Optional existing channel message ID; the publish script edits that message into the updated embed. |

Node 20.12+ loads `.env` through `process.loadEnvFile`. Bootstrap-only variables `BOOTSTRAP_ADMIN_EMAIL`, `BOOTSTRAP_ADMIN_PASSWORD`, and `BOOTSTRAP_ADMIN_PASSWORD_CONFIRM` may be used for non-interactive secret injection; they are not read by the long-running server.

## Run and bootstrap

From the repository root, install dependencies, configure the server, apply SQL, and bootstrap the first admin:

```sh
npm install
npm run bootstrap-admin
npm run server
```

The bootstrap command prompts for email/display name and a hidden password. It refuses to create the first admin if an active admin already exists. From this directory, the equivalent package scripts are `npm start`, `npm run dev`, and `npm run bootstrap-admin`. The dashboard is at `/admin` on the configured host/port, usually `http://127.0.0.1:8787/admin` locally.

After deploy, `npm run discord:set-endpoint` configures Discord to send button and modal interactions to the HTTPS endpoint derived from `PUBLIC_DOMAIN`; `npm run discord:publish-link-button` creates or updates the account-link embed.

The root package also provides `npm run build:server`, which emits `dist-server/` and `dist-server.zip`; the production bundle includes the SQL, migration, `.env.example`, README, and reverse-proxy template. The ZIP stores those files at its root, so extracting with `unzip dist-server.zip -d /var/www/dewclient-server` places `package.json` and `src/` directly in the destination directory.

## Authentication and authorization

`POST /api/v1/admin/login` accepts `{ "email": "...", "password": "..." }`. Database staff passwords use per-password salts and `scrypt` (`N=16384`, `r=8`, `p=1`). A successful login receives an HMAC-SHA256 bearer token with an expiry and `session_version`. Each protected request reloads the active staff row and session version; disabled staff, expired/tampered tokens, and stale session versions are rejected. Legacy 64-character SHA-256 hashes are upgraded after a successful login. All active staff have full administrator access in this release. The **Staff** dashboard tab creates and disables administrator accounts. Database protection prevents disabling/deleting the last active administrator. Credential/status changes revoke current sessions. Staff creation enforces a 12-character minimum password length.


## API and publication

- `GET /api/v1/health` checks database readiness; `GET /api/v1/ping` reports process information.
- `POST /api/v1/admin/login`, `GET /api/v1/auth/verify-admin`, and `GET /api/v1/auth/config` serve dashboard authentication.
- `GET /api/v1/auth/discord/start` and `/callback` perform OAuth2 identity verification; `/exchange` creates or loads the Discord player profile, and `/change-username` enforces the database cooldown. Register the callback URL above and configure the Discord OAuth client secret on the server. The bot token is not an OAuth secret.
- Legacy email/password Dew-account endpoints are not part of the current client authentication flow. Administrator dashboard email/password login remains separate.
- `GET /api/v1/manifest` returns persisted manifest data; news, announcements, and servers are public only when `enabled === true`. Missing manifest rows return empty lists/release metadata. Database errors do not trigger sample data.
- `POST /api/v1/client/register` and `/api/v1/client/heartbeat` manage Ed25519 client identity/presence. Heartbeats sync account metadata and active-player presence only when the client user opts in; a signed empty account list or null active player revokes that client's prior sharing. `POST /api/v1/cosmetics/publish` accepts signed cosmetic updates. Heartbeat and publish timestamps must be within five minutes of server time.
- Public cosmetic routes are `GET /api/v1/cosmetics/assigned`, `/player/:uuid`, `/players?uuids=<comma-separated UUIDs>`, and `/assets/:sha256`; the batch route accepts at most 128 canonical Minecraft UUIDs and returns only enabled cosmetic selections. Authenticated mod sessions can publish their active skin, cape, and wings for the bound player UUID through `POST /api/v1/client/cosmetics/presence`; admin-assigned types cannot be overwritten. The asset route returns bytes only if the hash is actively assigned. Player-published PNG/JPEG images must match Minecraft skin/cape/elytra dimensions; the admin library accepts validated PNG images.
- `GET /api/v1/players/online` returns active Microsoft profiles received from connected launchers within the previous two minutes; `GET /downloads/:filename` serves uploaded installers.
- Protected dashboard routes cover stats, accounts, clients, staff, cosmetics, servers, news, announcements, maintenance, and release metadata. Every protected operation requires a valid active administrator session.

The dashboard supports server, news, and announcement publishing; maintenance settings; installer release upload/publication; cosmetics library/assignment; and administrator management. Installer uploads are capped at 2 GiB, check the `MZ` header, and receive a server-computed SHA-256 digest; this is not Authenticode signature verification. The launcher updater does not silently install releases; a publisher-signature check is not implemented yet. Connected DewClient services require account-profile sharing and active Microsoft player presence. The launcher explains these data fields in Privacy settings; Reset Launcher Data sends a signed request to clear saved profile records. Online presence expires after two minutes.

## Deployment and limitations

[`nginx.conf.example`](./nginx.conf.example) and [`dewclient.service.example`](./dewclient.service.example) are templates, not active deployment configuration. Replace paths/certificate names, install valid TLS certificates, keep Node bound to loopback, persist/backup the release directory, and permit up to 2,050 MiB installer uploads with request buffering disabled. Set `TRUST_PROXY=true` only with a same-host proxy configuration that overwrites `X-Forwarded-For` with `$remote_addr`. Use an exact CORS allowlist; same-origin dashboard traffic needs no CORS entry and Electron file origins use `null`.

Cosmetic PNG/JPEG bytes are stored as authenticated AES-256-GCM ciphertext in Supabase. Legacy plaintext assets are integrity-checked and upgraded the first time an assigned asset is served. The API decrypts only after checking that an asset is currently assigned and responds with `private, no-store`; clients need the decoded texture to render it, so encryption at rest cannot stop a recipient from extracting or reselling a cosmetic after it reaches their game. Do not promise DRM or copy-proof delivery.

This source repository does not contain Supabase credentials or the VPS configuration; the production deployment is managed separately from these source files. Monitoring still needs an external uptime check. The tests use local storage fakes and mocked Supabase responses, not a live database. The in-memory rate limiter is per process and resets on restart; use an edge/WAF limit for multi-instance public deployment. The browser stores bearer tokens in `localStorage`, and there is no MFA. Back up the database before migration, review migrated admins, and set a short session lifetime appropriate to operations.

Before release, run the root test, typecheck, and build commands. Tests use local storage fakes and mocked Supabase responses; migrations and anonymous/authenticated/service-role RLS behavior still require validation against a disposable PostgreSQL/Supabase project.
