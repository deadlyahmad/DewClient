> **Archived source component.** Maintainer: Fateh. No further official DewClient updates are planned, and the official legacy service has been retired. The mod source is licensed under LGPL-3.0-only; see [`LICENSE`](./LICENSE). DewClient branding remains reserved under [`../COPYING.md`](../COPYING.md), and connected behavior may require a separately operated compatible service.

# DewCosmetics

DewCosmetics provides shared player cosmetics for the five supported Fabric targets below. Every target uses cosmetic protocol 1 and the same account UUID, so modded clients on different listed game versions can exchange equipped skins, capes, and wings through the DewClient cosmetics service.

## Supported targets

| Minecraft | Fabric API | Mod version | Java bytecode |
| --- | --- | --- | --- |
| 1.21.4 | 0.119.4+1.21.4 | 0.4.0 | 21 |
| 1.21.8 | 0.136.1+1.21.8 | 0.4.0 | 21 |
| 1.21.11 | 0.141.6+1.21.11 | 0.4.0 | 21 |
| 26.2 | 0.161.0+26.2 | 0.4.0 | 25 |
| 26.3 | 0.162.0+26.3 | 0.4.0 | 25 |

## Build

From the repository root:

```powershell
npm run build:cosmetics
```

Or build one target from this directory, for example:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\1.21.4\build.ps1
```

Each successful build writes the mod and its Fabric API dependency to `output-jars/`, then records their SHA-256 digests and compatibility protocol in `versions.json`. DewClient installs the artifact for an instance's Minecraft version and replaces outdated DewCosmetics JARs when that instance is updated or prepared.

## Sync behavior

The mod publishes the active skin, cape, and wings for the signed-in Minecraft identity, then fetches equipped public cosmetics for loaded player UUIDs in batches. Cross-version display requires DewCosmetics to be installed and running on both players' clients, and both clients must be able to reach the configured DewClient cosmetics service. Vanilla clients and other mod versions are not included in this support matrix.

The game process receives only a per-instance loopback proof and a short-lived cosmetics session token. DewClient account passwords, Microsoft tokens, and Supabase credentials are not passed into the game runtime.

Build status in `versions.json` means compilation and packaging succeeded. `supportVerified` remains false until in-game multiplayer checks are completed for each target.
