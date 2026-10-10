> **Archived website source — 10 October 2026.** This describes the former official DewClient website and references the retired official manifest/download service. It is provided for archival/reference and may not work without replacing domains and backend configuration. Branding assets are reserved; rebrand a fork before publishing it. See [`../COPYING.md`](../COPYING.md) and [`../FORKING.md`](../FORKING.md).

# DewClient website

Static Windows release site for DewClient. The site includes the home page, release news, Privacy Policy, and Terms of Service. It loads public release and news data from `https://server.dewclient.fun/api/v1/manifest`.

Build from the repository root with `npm run build:website:prod`. The deployable files are written to `dist-website/`; `icon/DewClient.ico` is copied as the site favicon. The download button accepts only HTTPS installer links hosted by `server.dewclient.fun`.
