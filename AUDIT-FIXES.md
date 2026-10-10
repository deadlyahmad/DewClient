# Audit fixes in this source snapshot

This file records changes made after the static source audit.

## Implemented

- Aligned staff documentation and the fresh database schema with the single administrator tier already described by the dashboard and existing tests. The schema normalizes legacy roles and constrains staff rows to `admin`.
- Added launcher Privacy controls, enabled by default as requested, for account metadata sharing and online presence. Account sharing excludes emails, OAuth tokens, passwords, and local cosmetic files. Signed heartbeat updates support opt-in, revocation, and reset-time deletion.
- Added validated account/presence heartbeat handling, Supabase persistence, a privacy-scoped online-player API, and a two-minute presence expiry.
- Added server-side account search and pagination with exact counts, plus dashboard page controls.
- Corrected documentation about the dashboard, API, staff access model, migrations, tests, and verification status.
- Kept update installation user-confirmed and added a complete updater flow: visible byte/percent progress, size/PE/SHA-256 verification, safe cached-download reuse, a single shared in-flight download, actionable error reporting, and an explicit install/restart step.
- Made the Windows app resolve its DewCosmetics manifest from packaged resources, included the manifest/available mod JARs in packaged builds, and consistently applied the supplied icon to the executable, installer, uninstaller, and Windows taskbar identity.
- New Fabric instances now attempt DewCosmetics installation immediately and report unavailable versions/artifacts in the client log. The installer rejects artifacts without a valid SHA-256 value instead of silently trusting them.
- Corrected the mod manifest/docs to identify Minecraft 26.3 as the only packaged Fabric target; the current source archive contains its built JAR, while legacy-version compatibility has not been verified.
- Updated the source-archive builder to include a built DewCosmetics JAR when one exists, while continuing to exclude unrelated JARs and generated dependency folders.
- Reworked admin cosmetic assignment into searchable checkbox collections for multiple skins, capes, and wings. Unchanged assignments are preserved unless the administrator edits that category; clearing a category is explicit.
- Fixed the cosmetic assignment modal crash: the global open handler referenced a form variable scoped only inside modal initialization, so both the table Assign buttons and username/UUID picker failed before opening. Assignment actions now use delegated data-attribute listeners and the correct form instance.
- Added assigned skin collections to the public manifest, retained cape/wing collections in player slots, and added verified previews and selectable active items beside Microsoft-owned capes.
- Preserved uploaded PNG bytes and expanded client/server/Fabric validation through the 64×32 minimum and 2048×1024 maximum. Cosmetic uploads/downloads are limited to 50 MiB, with bounded base64 request allowance for JSON.
- Bumped DewClient and the server to 1.0.1; built the x64 Windows installer and 26.3 Fabric JAR; deployed server/admin updates, applied migration 007, and published the installer URL, SHA-256, and size to the server manifest. The marketing website was not released.
- Rebuilt the same 1.0.1 installer with updater progress and verified install/restart UX, fixed admin assignment click handling, refreshed server/admin assets with cache-busted URLs, and republished installer integrity metadata. Detected Cloudflare serving the prior same-version executable from its immutable cache and switched the manifest to a unique `1.0.1-r2` installer URL; public Content-Length and the first `MZ` bytes now match the release.

## 1.0.2 release completion

- Updated the client, server, dashboard, and release metadata to 1.0.2. The official Microsoft profile cape refresh runs independently of the remote cosmetic-library fetch so locally owned Microsoft capes remain visible when the central API is unavailable.
- Canonicalized legacy `dewclient.site` links to `dewclient.fun`, set the current Discord invite, and persistently cache news/featured-server manifests with a five-minute refresh interval and stale-while-revalidate behavior.
- Added protected admin-manifest access so existing disabled news and featured-server records can be edited, improved public Dew-account error messages, and kept cached/current manifests available offline.
- Fixed Fabric 26.3 installation: the official loader profile omits a checksum and size for one generated library. The client now obtains the official Maven SHA-1 sidecar and HEAD content length and continues to reject untrusted hosts, invalid coordinates, bad checksums, oversized artifacts, and conflicting metadata.
- Packaged DewClient 1.0.2 for Windows x64, generated the complete source archive and production server ZIP, uploaded the installer and API/admin server to the VPS, restarted the existing PM2 process, and published 1.0.2 metadata in Supabase. The marketing website was not published.
- Verified TypeScript type-check, server JavaScript syntax, Fabric 26.3 profile resolution against the live Fabric Meta API (7 libraries resolved), Windows installer build/version metadata, VPS health/version, public release URL/size/PE header, server/admin assets, and release SHA-256 matching the VPS copy.

## 1.0.3 release completion

- Enabled Supabase email registration for Dew accounts while leaving email confirmation enabled. New-account confirmation delivery still depends on a correctly configured Supabase SMTP sender.
- Added a player-facing support form and protected administrator bug-report queue with pending, under-review, and resolved states. Reports do not include account IDs, device fingerprints, or launcher/game logs.
- Restricted persistent diagnostics to a size-capped, redacted Minecraft launch history. Detailed launch output stays in session memory, is passed to the UI in short batches, and is scrubbed for tokens, chat, usernames, home paths, and hardware details. Added a privacy-safe error view.
- Changed Minecraft asset validation to yield between bounded verification batches and display file progress; this addresses the long synchronous verification phase associated with the reported Windows “Not Responding” state. Actual game startup still depends on local Java, graphics drivers, and game runtime behavior.
- Added lazy texture thumbnails to client cosmetic slots, Microsoft cape slots, and the admin library/assignment picker. Admin thumbnails are delivered only after admin-session verification, integrity-checked, and reduced to small previews in the browser.
- Updated the locally stored marketing website source to a layered monochrome design with focus-visible and reduced-motion states. The website was not uploaded or published.
- Applied Supabase migration 008, rebuilt and deployed the updated API/dashboard, and published the Windows x64 1.0.3 installer with immutable URL, size, and SHA-256 metadata. PM2 process state is saved and the public API reports 1.0.3.
- The user reported that Minecraft 26.3 launched and displayed skins/capes. This environment did not run a separate interactive game regression session. The included Fabric mod target remains 26.3 only.

## Current compatibility limits

- The included DewCosmetics Fabric mod targets 26.3 only; its `supportVerified` flag remains false because an in-game visual/runtime session was not available here. No 1.8.9 Fabric artifact is included. Fabric's compatibility API is version-specific, and its request for 1.8.9 currently returns HTTP 400 with no loader entries. ViaVersion translation does not run a missing client-side mod.
- No automated test suite or live account signup was run. Registration is enabled in Supabase, but actual verification email delivery depends on the production project's email-confirmation and SMTP settings.
- The installer downloader verifies executable `MZ` header, expected size, and SHA-256, but Windows Authenticode publisher signing remains unavailable because no signing certificate was provided.

## Database update

For a new database, apply `server/schema.sql`. For an existing database, apply every unapplied migration through `008_bug_reports.sql`. Both files numbered `003` modify independent data and must be applied; the single-tier role migration is `003_admin_only.sql`. Migration 007 is applied to the production Supabase project.

## Not verified or still limited

- Typecheck, client/Electron/server production builds, Windows installer creation, Fabric 26.3 Gradle build, server syntax checks, public health/version, admin dashboard delivery, release manifest, installer URL status, and local/VPS SHA-256 were verified. The full automated test suite and in-game Minecraft runtime/visual checks were not run.
- The current cosmetic mod source/JAR target is Minecraft 26.3 only. Fabric does not support Minecraft 1.8.9; ViaVersion/ViaProxy protocol translation does not execute a Fabric client mod on legacy clients.
- The marketing website source now includes the requested theme work, but its live hosting was left unchanged. A dated rollback archive for the previous server files is on the VPS; its `.env` was kept in place and excluded from that archive.
- The updater still does not validate an Authenticode publisher signature. Installer execution requires the user to choose **Install & restart**, but the NSIS installer then runs in silent mode; a signing certificate/publisher identity is still needed for Windows publisher validation.
