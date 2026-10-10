> **Historical deployment notes — archived source release (10 October 2026).** Official DewClient updates and legacy downloads have been disconnected by the maintainer. Do not assume the former hosts, domains, API, credentials, or deployment remain live. For a fork, use infrastructure and secrets you control; preserve existing unrelated services and never copy credentials from an old deployment. See [`RETIREMENT.md`](./RETIREMENT.md) and [`FORKING.md`](./FORKING.md).

# DewClient production handoff (historical)

Current client release: DewClient `1.0.1` (Windows x64), served from `server.dewclient.fun`. The API/admin server and static website are deployed on `server.dewclient.fun` and `dewclient.fun`. The VPS `.env` remains private and is not included in source archives.

## Before building

1. Rotate any VPS password and Supabase management token that was shared in chat. A Supabase management token is not an application database key.
2. Obtain the project HTTPS URL, server-only Supabase secret/service-role key, and publishable/anon key from Supabase's project settings. Put them only in a protected server environment file or secret manager. Never put a service-role key or management token in the client, website, Git, or this archive.
3. Inventory the active DewClient site and API paths before deployment. Preserve the live `.env`, persistent release directory, and unrelated services; do not delete account or cosmetic data.
4. For a new database, apply `server/schema.sql`. For an existing database, follow `server/README.md`; migration `018_claimed_cape_collection_and_equipping.sql` is applied to the configured Supabase project.

## Windows client build

On Windows 10/11, install Node.js 20.12+ and use the repository lockfile. Then run:

```powershell
npm ci
npm run typecheck
npm run dist
```

`npm run dist` builds DewCosmetics 0.4.0 and the matching Fabric API dependency for Minecraft 1.21.4, 1.21.8, 1.21.11, 26.2, and 26.3, records their SHA-256 values in `DewCosmeticsLoader/versions.json`, builds the UI/Electron app, and creates the x64 Windows installer. Publish the installer with SHA-256 and file-size metadata in the server manifest.

Do not distribute a build unless every target build succeeds and the generated artifact and manifest checksums are present. The installer bundles the five listed targets; each uses the same cosmetics protocol.

## Website build

Build the marketing site locally with:

```powershell
npm ci
npm run build:website:prod
```

The static site output is `dist-website/`. The published site at `dewclient.fun` includes the Windows 1.0.1 download, DewCosmetics 0.4.0 release news, updated terms and privacy pages, and the DewClient ICO throughout. The website does not include the removed HUD section.

## Server configuration and service

Use Node.js 20.12+ on the VPS. Build the server bundle locally with `npm run build:server`; upload `dist-server/` to a dedicated path such as `/opt/dewclient/server/`. Create a protected environment file outside the web root using `server/.env.example` as a checklist. Set at minimum:

- `HOST=127.0.0.1` and `PORT=8787` so Node is reachable only through the local reverse proxy.
- `NODE_ENV=production`, `PUBLIC_DOMAIN=server.dewclient.fun`, and an exact `CORS_ORIGINS` allowlist appropriate for the deployed client/site.
- `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, and `SUPABASE_PUBLISHABLE_KEY` from the project settings.
- A unique `ADMIN_SESSION_SECRET` with at least 32 random bytes.
- `DEWCLIENT_RELEASE_DIR=/var/lib/dewclient/releases` on persistent storage.

Restrict the environment file to the service account and root. Bootstrap the first administrator interactively from the server bundle with `npm run bootstrap-admin`. Do not pass passwords or secrets as command-line arguments.

An example systemd unit is in `server/dewclient.service.example`. Install it only after adjusting its paths and service account. Keep Nginx in front of the API and overwrite forwarded client IP headers at the trusted local proxy. Set `TRUST_PROXY=true` only when that condition is met. Preserve the existing VPS firewall and proxy configuration; expose only the ports your existing Cloudflare/Nginx setup needs.

For Cloudflare, route `dewclient.fun` to the reviewed static site and `server.dewclient.fun` to the API reverse proxy. Use Full (strict) TLS to the origin with a valid certificate, then check `/api/v1/health` and `/api/v1/ping` through the public hostname. Do not change DNS records as part of a source build.

## Current compatibility and release boundaries

- Fabric cosmetics source and compiled JARs exist for Minecraft 1.21.4, 1.21.8, 1.21.11, 26.2, and 26.3. The builds complete; live multiplayer verification is still needed.
- Fabric does not support Minecraft 1.8.9. ViaVersion/ViaProxy protocol translation does not execute a Fabric client mod on vanilla legacy clients. Supporting 1.8.9 cosmetics would need a separate client or server/proxy rendering design.
- The app installs or updates DewCosmetics automatically when a supported Fabric instance is created, imported, or launched, and only when the packaged artifact metadata and SHA-256 match. Unsupported Minecraft versions continue without this mod.
- Cross-player cosmetics uses canonical Minecraft UUIDs, a bounded public lookup, HTTPS-only same-host API requests, content type and SHA-256 validation, supported UV dimensions, bounded cache/download memory, and render-thread texture registration. The mod compiled, but was not tested against a live Minecraft server session.
- Cosmetic uploads accept up to 50 MiB and require Minecraft skin, cape, or wing UV layouts between 64×32 and 2048×1024. Uploaded PNG bytes are preserved and stored assets are encrypted on the server.
- The updater is user-confirmed end to end: starting a download shows byte-based percentage progress, then validates executable signature bytes, published size, and SHA-256. After verification, the user explicitly chooses **Install & restart**; the installer is not launched automatically in the background. The `1.0.1` release keeps `1.0.0` as the minimum supported version. Use a new immutable URL for every binary so Cloudflare cannot return stale bytes with mismatched integrity metadata.

## Checks required before calling it production-ready

The Windows client release is 1.0.1. TypeScript typecheck, frontend/Electron packaging, server bundle, website bundle, and all five DewCosmetics builds should complete before publication. Manual verification inside Minecraft is still needed to confirm visible cosmetics and nearby-player sync end to end.
