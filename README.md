# DewClient

> **Archived source release — 10 October 2026**  
> **Developer:** Fateh  
> DewClient will receive no further official updates. The maintainer has disconnected legacy update downloads from the official server. Features dependent on official hosted services may no longer work. The source is available for independent forks, but the official DewClient name, logo, icons, and product identity are reserved and must not be reused as the identity of a fork. Read [`RETIREMENT.md`](./RETIREMENT.md), [`COPYING.md`](./COPYING.md), [`LICENSE`](./LICENSE), and [`FORKING.md`](./FORKING.md) before reusing or redistributing the project.


DewClient is a Windows-focused Minecraft Java Edition launcher built with Electron, React, TypeScript, and Vite. This repository also contains the central HTTP server, Supabase schema, browser-based admin dashboard, and static DewClient website.

## Architecture

- `src/` contains the React launcher interface.
- `electron/` contains the Electron main process, preload/IPC boundary, Minecraft account and instance services, remote manifest, cosmetics synchronization, and updater.
- `shared/` contains types, DTOs, and validation shared by the Electron application and UI.
- `server/src/` contains a Node.js HTTP server, Supabase REST storage adapter, authentication, client heartbeat, public manifest, cosmetics, release-download, and admin API routes.
- `server/public/` contains the browser-based admin dashboard served by the server at `/admin`.
- `server/schema.sql` is the Supabase PostgreSQL schema.
- `website/` contains the separate static website.
- `tests/` contains the Node.js test files used by the root `test` script.

The server has no runtime npm dependencies of its own; it uses Node.js built-ins and Supabase's PostgREST API. The launcher has its dependencies in the root `package.json`. See [`DEPLOYMENT.md`](./DEPLOYMENT.md) for the Windows build and owner-operated deployment handoff.

## Identity model and auth

The launcher uses a stable Dew account identity separate from the player’s Minecraft identity:

- `dewAccountId` is the canonical Dew account identity used for ownership, entitlement checks, and cosmetic assignment.
- `uuid` remains the player’s current Minecraft UUID for premium accounts and the local offline-player UUID for free accounts.
- `minecraftUuid` is stored explicitly for premium verification/tracking when the external identity differs from the canonical Dew record.
- `username` remains display metadata and may change without changing the canonically owned Dew account.

The launcher supports Microsoft accounts, Discord-linked DewClient profiles, and local offline profiles. Microsoft sign-in uses the official Microsoft account flow and Minecraft UUID verification. Discord sign-in uses OAuth2 `identify`; first-time users choose a Minecraft-compatible name, and the server enforces a one-calendar-month name-change cooldown. Discord profiles use offline-mode Minecraft identity and unlock cloud cosmetics and cape claims. Offline profiles remain local and do not receive account-linked cloud entitlements. Email/password DewClient sign-in has been removed from the launcher.

Admin authentication uses active rows in `dew_admins`; environment passwords are not accepted. Passwords use salted Node.js `scrypt` hashes. Existing SHA-256 hashes are verified once and upgraded after a successful login. Sessions are HMAC-signed, expire after a configurable lifetime, and are checked against the current active staff row and `session_version` on every protected request. All active staff accounts have full administrator access in this release; the database normalizes legacy role values to `admin`. The browser dashboard stores the bearer token in `localStorage`, so serve it only over HTTPS and protect the browser session.

Staff accounts can be created, disabled, or re-enabled by an administrator. A staff member cannot disable their own account. The API and a database trigger prevent removing the last active administrator.

## First admin and staff management

Apply the database schema or all unapplied migrations, configure the server-side Supabase service key, then run `npm run bootstrap-admin` from the repository root. The command prompts for the first admin email and display name and reads the password without echoing it. It uses a database-serialized RPC and refuses to create another first admin once an active admin exists. The dashboard's **Staff** tab manages administrator accounts and active status after bootstrap.

Existing `dew_admins` rows are normalized to role `admin` by the administrator-only migration. Every active staff account therefore has administrator access. New staff passwords must be at least 12 characters.

## Public API and manifest

The server exposes:

- `GET /api/v1/manifest` for the remote launcher snapshot.
- `POST /api/v1/client/register` and `POST /api/v1/client/heartbeat` for client identity/presence; heartbeats are signed with the registered Ed25519 key.
- Public cosmetics lookup, assigned cosmetics, and asset endpoints under `/api/v1/cosmetics`.
- `GET /api/v1/players/online` for active Microsoft profiles sent by connected DewClient launchers; presence expires within two minutes.
- Admin login at `POST /api/v1/admin/login` and current-session details at `GET /api/v1/auth/verify-admin`.
- Protected statistics, account, client, staff, release, content, and cosmetic operations; protected routes require a valid active administrator session.

The launcher **Privacy** settings disclose the account sharing required by DewClient connected services; they do not provide an opt-out toggle. Account sharing sends up to 100 Minecraft usernames, UUIDs, account types, and last-used times. It does not send Microsoft tokens or passwords. Online presence sends the active Microsoft profile's username and Minecraft UUID while the launcher is running and expires after two minutes without a heartbeat. Reset Launcher Data sends a signed request to remove saved profile records.

Manifest data is a persisted JSON snapshot in `dew_manifest`. A missing row produces empty news, announcements, and featured-server lists with no published release; there is no built-in production content. The public manifest returns only entries whose `enabled` field is exactly `true`. Database read/write failures are reported instead of replaced by demo data, and `/api/v1/health` checks database readiness.

Client installers uploaded through the dashboard are stored in `DEWCLIENT_RELEASE_DIR`; the server checks the `MZ` header, computes SHA-256, then publishes URL, size, digest, and version metadata into the manifest. Cosmetic library records and bytes are private to the service role; public asset delivery requires an active assignment.

## Historical client release and source state (not maintained)

The last documented Windows x64 client release is labeled `1.0.1`. Its former installer and update channel are retired; this archive does not imply that the historical download URL or official server remains available.

The code includes offline launcher features and integrations with the former official API. Actual behavior depends on the state of the user's local installation and hosted services; official account validation, shared cosmetics, telemetry, manifests, downloads, and administration may no longer function.

The archived source includes DewCosmetics 0.4.0 build configurations for Minecraft 1.21.4, 1.21.8, 1.21.11, 26.2, and 26.3. Connected cosmetics behavior depends on a compatible service endpoint and has no official service/support guarantee. Live multiplayer behavior was not fully verified in this source archive.

Admin-uploaded skin, cape, and wing PNGs preserve their original bytes and are encrypted in server storage. PNG dimensions are bounded from 64×32 through 2048×1024 (with the appropriate skin/cape/wing layouts), and each original upload is limited to 50 MiB. Microsoft-owned capes are fetched from the signed-in Minecraft profile and appear alongside assigned DewClient capes in their own selectable slots. Wing textures are provided as Elytra textures and display when Minecraft renders the Elytra model.

The Modrinth application and UI source were reviewed for layout patterns. DewClient uses its own implementation and assets; Modrinth application code and assets were not copied into this repository.

Client diagnostics persist only a bounded, redacted Minecraft launch history. Raw launcher and game output stays in memory for the active session and is sanitized before it appears in the UI. The Support page submits only player-entered report text and public client/game version fields; it does not attach logs, account identifiers, or device details. Administrators can review and resolve submitted reports in the dashboard.

## Database

For a new Supabase PostgreSQL project, apply [`server/schema.sql`](./server/schema.sql). For an existing database, apply every unapplied migration from `001` and `002`, both files numbered `003` (they modify independent objects), then `004`, `005`, `006`, `007`, and `008`. Back up existing data and review existing policies before applying SQL. The schema defines:

- `dew_clients`, `dew_accounts`, `dew_player_presence`, and `dew_manifest`
- `dew_cosmetics`, `dew_cosmetic_assets`, and `dew_cosmetic_library`
- `dew_admins`

The schema enables row-level security. Manifest, staff, cosmetics, presence, and asset tables are service-role-only; public API routes selectively expose published manifest entries, opted-in online profiles, and assigned cosmetics. It includes an administrator-only staff constraint, session-version tracking, a first-admin bootstrap RPC, and a last-active-admin trigger. Keep the Supabase service-role key on the server only. This repository has forward SQL migrations, not an automated migration runner. Apply both files numbered `003` (they change independent objects), then migrations `004` through `008` in order. Migration `007_multi_cosmetic_assignments.sql` protects every assigned skin, cape, and wing asset from deletion while it is in the player's assigned collection. Migration `008_bug_reports.sql` stores player-submitted reports for administrator review.

## Environment configuration

The server reads `.env` files from the server root or current working directory when running Node 20.12 or newer. Copy [`server/.env.example`](./server/.env.example) to `server/.env` and replace the placeholders. `.env` files are ignored by Git; never commit real credentials.

| Variable | Current behavior |
|---|---|
| `SUPABASE_URL` | Required HTTPS Supabase project URL. |
| `SUPABASE_SECRET_KEY` | Required backend-only Supabase key; the legacy `SUPABASE_KEY` and `SUPABASE_SERVICE_ROLE_KEY` aliases remain accepted. Never ship this key to the desktop client. |
| `SUPABASE_PUBLISHABLE_KEY` | Optional client-facing Supabase key retained for server-side compatibility; it is not used for launcher email/password sign-in. The legacy `SUPABASE_ANON_KEY` alias remains accepted. |
| `DISCORD_APPLICATION_ID` | Discord application ID used by OAuth and cape-linking integrations. |
| `DISCORD_OAUTH_CLIENT_SECRET` | OAuth2 client secret from Discord Developer Portal. This is different from the bot token. Add `https://server.dewclient.fun/api/v1/auth/discord/callback` as a redirect URI and keep the secret only in the server `.env`. |
| `ADMIN_SESSION_SECRET` | Required stable secret with at least 32 bytes. There is no ephemeral fallback. |
| `PUBLIC_DOMAIN` | Required public hostname (and optional port) used to construct HTTPS release URLs. |
| `PORT` | Optional HTTP port, default `8787`; must be 1-65535. |
| `HOST` | Optional bind address, default `127.0.0.1`. |
| `NODE_ENV` | Optional mode, default `production`; `development` permits HTTP CORS origins. |
| `ADMIN_SESSION_TTL_MS` | Optional session lifetime, default eight hours; allowed range is 60,000 ms to 30 days. |
| `CORS_ORIGINS` | Optional comma-separated exact browser origin allowlist, default `null` for file-based Electron. Wildcards are rejected. |
| `TRUST_PROXY` | Optional; only literal `true` trusts a single forwarded IP from a loopback proxy. The proxy must overwrite, not append, `X-Forwarded-For`. |
| `DEWCLIENT_RELEASE_DIR` | Optional persistent installer directory; defaults to `releases` under the server root. |

Startup validates required values and verifies Supabase access to the manifest and staff schema before opening the HTTP listener. The health route repeats that readiness check. `BOOTSTRAP_ADMIN_EMAIL`, `BOOTSTRAP_ADMIN_PASSWORD`, and `BOOTSTRAP_ADMIN_PASSWORD_CONFIRM` are optional one-command bootstrap inputs for non-interactive secret injection; they are not server runtime settings.

## Local development

Use Node.js 20.12+ and install dependencies from the repository root:

```sh
npm install
npm run dev
```

`npm run dev` builds the Electron main/preload bundles and starts Vite plus Electron; it does not start the central server. Configure `server/.env`, apply the Supabase SQL, and bootstrap an admin first. Start the server separately:

```sh
npm run server
```

The server package also provides `npm start`, `npm run dev`, and `npm run bootstrap-admin` when run from `server/`. The dashboard is served at `http://127.0.0.1:8787/admin` with the default bind configuration.

## Build and verification commands

Commands available in the root `package.json`:

```sh
npm run build
npm run build:frontend
npm run build:electron
npm run build:server
npm run build:website
npm run build:website:prod
npm run typecheck
npm test
npm run dist
npm run bootstrap-admin
```

The `npm test` script runs the client, cosmetics sync, admin auth, Dew account auth, cosmetics session and bridge, launcher reset, navigation policy, and shared protocol tests. `npm run typecheck` runs TypeScript's no-emit check. No lint script is defined. `npm run build:server` creates `dist-server/` and `dist-server.zip`, including the schema, migrations, config example, and proxy template. `npm run build:website:prod` creates the static website bundle. `npm run dist` builds the Windows x64 installer.

## Production deployment requirements and security

The API and website have been deployed on the owner’s VPS. [`server/nginx.conf.example`](./server/nginx.conf.example) remains a template; the live reverse proxy is configured separately. Keep the Node port private, set `PUBLIC_DOMAIN` to the API hostname, persist and back up `DEWCLIENT_RELEASE_DIR`, and allow proxy uploads up to 2,050 MiB with request buffering disabled. Leave `TRUST_PROXY` false unless the proxy overwrites the forwarded client IP as documented. `CORS_ORIGINS` must match browser origins exactly. Protect and rotate the Supabase service key. The updater checks HTTPS, size, and SHA-256 but does not verify an Authenticode publisher signature; automatic silent installation is disabled until publisher verification is available.

## Publishing content

The dashboard can create featured servers, news, and announcements, manage maintenance mode, upload and publish client releases, manage the private cosmetic library and assignments, and manage administrator accounts. Manifest content is stored in the `dew_manifest` snapshot. Only enabled entries are public. Cosmetic library uploads remain private until assigned.

## Security and verification limits

Verification results depend on the source snapshot and environment. Run `npm test`, `npm run typecheck`, `npm run build`, and `npm run build:server` before release. The migration and RLS behavior require validation against a disposable PostgreSQL/Supabase project.

- The deployed website and API were live-checked; the API health endpoint reports healthy. The Supabase email settings and confirmation template were verified through the Management API. No new account was created and no confirmation email was sent as a deployment test; actual delivery to a user inbox still depends on the Resend/Supabase configuration.
- The Node process rate limiter is in-memory and per process; use an edge/WAF limit if running multiple instances or exposing login publicly.
- The dashboard stores bearer tokens in `localStorage` and has no MFA. Restrict access, use HTTPS, and apply short session lifetimes appropriate to your operations.
- All active staff have administrator privileges; restrict access to the dashboard accordingly.
- The test suite uses local in-memory server adapters for HTTP behavior; it does not test against a live Supabase project.
- No `read.md` status file exists. This README and [`server/README.md`](./server/README.md) describe the current source; [`server/nginx.conf.example`](./server/nginx.conf.example) is only a deployment template.


## Community Maintenance and Bug Fixes

DewClient is a retired open-source project and may contain bugs, incomplete features, compatibility issues, or security vulnerabilities.

Community developers are welcome to inspect the source code, report bugs, fix issues, improve existing features, and submit pull requests.

This source release is provided as-is, without any guarantee that every feature works correctly. Developers should test their changes before distributing their own builds.

Original Developer: Fateh
Discord Username: caesaroftheromans_
