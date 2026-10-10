# Cosmetics Implementation Log

This file tracks cosmetics-related changes made for the dedicated client cosmetics studio.

## Research Findings

- Minecraft Services profile lookup returns the active skin and cape texture URLs. The client already reads those URLs at Microsoft login, but did not download or publish their texture bytes.
- The existing DewClient server supports authenticated skin, cape, and elytra uploads, admin assignments, and a public assigned-cosmetics feed.
- Fabric instances install CustomSkinLoader and sync assigned textures for other players before launch. Vanilla and non-Fabric instances do not get this custom-cosmetics rendering path.
- `skinview3d` 3.4.2 is Three.js-powered and supports draggable Minecraft player previews, name tags, skins, capes, and elytra textures.
- Standalone decorative wings are not supported by the current in-game loader; elytra textures render when the player equips an elytra.

## Change History

| Step | Files | Change |
| --- | --- | --- |
| 1 | `capes.md`, `electron/storage/cosmeticStorage.ts` | Recorded the researched architecture and added bounded local byte storage for profile texture downloads. |
| 2 | `shared/types/account.ts`, `electron/auth/authService.ts`, `capes.md` | Microsoft login now caches Mojang-hosted active textures locally; existing custom or legacy local selections remain authoritative. Texture URLs are host/path checked, HTTPS-only, redirected requests are rejected, and downloads time out. |
| 3 | `electron/remote/cosmeticsSyncService.ts`, `capes.md` | Added local/server elytra preview caching, automatic republishing when Mojang textures change, and elytra-only publish detection. Cosmetic source metadata now survives canonical manifest updates. |
| 4 | `src/components/Sidebar.tsx`, `src/App.tsx`, `src/views/CosmeticsView.tsx`, `src/views/AccountsView.tsx`, `src/styles/components.css`, `package.json`, `package-lock.json`, `capes.md` | Added a standalone Cosmetics route with a name-tagged draggable 3D player, skin/cape/elytra preview selection, auto-rotation, custom uploads, and queued sync status. Added `skinview3d` and updated the lockfile. The existing Accounts uploader now records custom-source provenance. |
| 5 | `electron/remote/cosmeticsSyncService.ts`, `capes.md` | Retained account-local files and preview fallbacks when remote sync is disabled/offline or the server has no asset for a slot. |
| 6 | `tests/cosmetics-sync.test.mjs`, `capes.md` | Added regression coverage for an elytra-only publish and local cached-preview readback. |
| 7 | `src/views/CosmeticsView.tsx`, `src/styles/components.css`, `capes.md` | Fixed initial responsive sizing so a model created at a narrow window width expands with its preview frame. |
| 8 | `src/views/CosmeticsView.tsx`, `capes.md` | Server cosmetics sync events now clear temporary local preview overrides and refresh the canonical textures. |
| 9 | `src/components/Header.tsx`, `src/views/CosmeticsView.tsx`, `capes.md` | Added the route title and aligned the preview background option with the viewer library's transparent default. |
| 10 | `src/views/CosmeticsView.tsx`, `capes.md` | Ensured the model's current auto-rotation preference is applied when the viewer is constructed or textures change. |
| 11 | `src/views/CosmeticsView.tsx`, `capes.md` | Preserved the preview drawing buffer for stable capture and canvas-pixel validation. |

## Verification

- `node.exe ./node_modules/typescript/bin/tsc --noEmit` passed.
- `node.exe --test tests/client.test.mjs tests/cosmetics-sync.test.mjs tests/admin-auth.test.mjs` passed: 54 tests, 0 failures.
- `node.exe ./node_modules/vite/bin/vite.js build` completed without reported build errors.
- Browser check rendered the named WebGL player preview at 1440 px and 820 px viewport widths; canvas matched its responsive preview frame at both sizes.