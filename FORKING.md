# Creating an independent DewClient-derived client

This repository is a source archive, not a maintained official distribution. Before publishing a fork:

1. **Choose a distinct name.** Do not release a repackaged build under the DewClient name or imply it is official.
2. **Replace reserved branding.** Remove/replace the official icon and favicons, logos, product artwork, branded UI and marketing materials. See [`COPYING.md`](./COPYING.md).
3. **Set your own application identity.** Review `package.json` for `productName`, `appId`, executable name, installer shortcuts, icons, and the `dewclient` protocol scheme; change them to identifiers you control.
4. **Configure your own infrastructure.** Review `server/.env.example`, `PUBLIC_DOMAIN`, CORS origins, OAuth callback URLs, manifest/release URLs, and website configuration. Do not depend on retired official DewClient services.
5. **Review data and security behavior.** Reassess account flows, permissions, telemetry/presence, privacy policy, terms, storage, secret handling and administrative endpoints for your fork. Never publish real credentials or production `.env` files.
6. **Keep license notices and inspect dependencies.** Follow GPL-3.0-only for the main project code, LGPL-3.0-only for `DewCosmeticsLoader/`, and every third-party license. Provide corresponding source and notices as required by the applicable license when distributing binaries.
7. **Verify before release.** Run tests and build checks, configure only your own service endpoints, and test launch/update behavior. The source archive does not assert that retired online features remain operational.

These notes are practical project guidance; the license files and applicable law control if there is a conflict.

## Community Contributions

Developers are welcome to maintain this independent fork, fix bugs, complete unfinished features, improve reliability, and submit pull requests.

Please document significant changes and test them before releasing builds.

Original Developer: Fateh
Discord Username: caesaroftheromans_
