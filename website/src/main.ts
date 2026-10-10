const API_BASE = 'https://server.dewclient.fun/api/v1';
const RELEASE_FALLBACK = 'https://server.dewclient.fun/downloads/DewClient-1.0.1.exe';
const DEFAULT_NEWS = {
  id: 'dewcosmetics-0-4-0-support-matrix',
  title: 'DewCosmetics 0.4.0: cosmetics across five Minecraft versions',
  summary: 'DewCosmetics 0.4.0 adds Fabric support for Minecraft 1.21.4, 1.21.8, 1.21.11, 26.2, and 26.3. Supported modded clients can sync skins, capes, and wings across these versions. Free cape claims remain available only to Microsoft and Discord accounts, not offline sandbox profiles.',
  tag: 'DEWCOSMETICS · 0.4.0',
  publishedAt: '2026-10-09T00:00:00.000Z',
  enabled: true
};

type NewsItem = {
  id?: string;
  title?: string;
  summary?: string;
  tag?: string;
  publishedAt?: string;
  enabled?: boolean;
  url?: string;
};

function initTheme(): void {
  const root = document.documentElement;
  let saved = '';
  try { saved = localStorage.getItem('dewclient-site-theme') || ''; } catch { /* Storage can be disabled. */ }
  const theme = saved === 'light' || saved === 'dark' ? saved : 'dark';
  root.dataset.theme = theme;
  document.getElementById('themeToggle')?.addEventListener('click', () => {
    const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
    root.dataset.theme = next;
    try { localStorage.setItem('dewclient-site-theme', next); } catch { /* Keep theme changes in memory. */ }
  });
}

function initNavigation(): void {
  const button = document.getElementById('menuToggle');
  const nav = document.getElementById('primaryNav');
  if (!button || !nav) return;
  const close = () => {
    nav.classList.remove('is-open');
    button.setAttribute('aria-expanded', 'false');
    button.setAttribute('aria-label', 'Open navigation');
  };
  button.addEventListener('click', () => {
    const open = button.getAttribute('aria-expanded') !== 'true';
    nav.classList.toggle('is-open', open);
    button.setAttribute('aria-expanded', String(open));
    button.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
  });
  nav.querySelectorAll('a').forEach((link) => link.addEventListener('click', close));
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') close(); });
  document.addEventListener('click', (event) => {
    if (!nav.contains(event.target as Node) && !button.contains(event.target as Node)) close();
  });
  window.addEventListener('resize', () => { if (window.innerWidth > 700) close(); }, { passive: true });
}

function initMotion(): void {
  const targets = [...document.querySelectorAll<HTMLElement>('.reveal')];
  if (!targets.length || !('IntersectionObserver' in window) || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  document.documentElement.classList.add('motion-ready');
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      (entry.target as HTMLElement).classList.add('is-visible');
      observer.unobserve(entry.target);
    }
  }, { threshold: 0.12, rootMargin: '0px 0px -24px 0px' });
  targets.forEach((target, index) => {
    target.style.transitionDelay = `${Math.min(index % 4, 3) * 65}ms`;
    observer.observe(target);
  });
}

function initDownloads(): void {
  document.querySelectorAll<HTMLAnchorElement>('[data-download]').forEach((link) => {
    const status = document.getElementById(link.id === 'heroDownload' ? 'heroDownloadStatus' : 'downloadStatus');
    const label = link.querySelector<HTMLElement>('.download-label');
    const originalLabel = label?.textContent || '';
    let resetTimer = 0;

    link.addEventListener('click', (event) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      if (!officialDownloadUrl(link.href)) return;
      window.clearTimeout(resetTimer);
      link.classList.add('is-starting');
      link.setAttribute('aria-busy', 'true');
      if (label) label.textContent = 'Starting download…';
      if (status) status.textContent = 'Download requested. Check your browser’s Downloads if it does not appear.';
      resetTimer = window.setTimeout(() => {
        link.classList.remove('is-starting');
        link.removeAttribute('aria-busy');
        if (label) label.textContent = originalLabel;
      }, 2400);
    });
  });
}

function formatDate(value: string | undefined): string {
  const date = value ? new Date(value) : new Date('2026-10-08T00:00:00.000Z');
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en', { year: 'numeric', month: 'long', day: 'numeric' }).format(date);
}

function officialDownloadUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value, API_BASE);
    return url.protocol === 'https:' && url.hostname === 'server.dewclient.fun' && /^\/downloads\/DewClient-[A-Za-z0-9._-]+\.exe$/i.test(url.pathname)
      ? url.toString()
      : null;
  } catch { return null; }
}

async function loadPublicManifest(): Promise<any | null> {
  try {
    const response = await fetch(`${API_BASE}/manifest`, { headers: { Accept: 'application/json' }, cache: 'no-cache', credentials: 'omit', redirect: 'error' });
    if (!response.ok) return null;
    const manifest = await response.json();
    return manifest && typeof manifest === 'object' ? manifest : null;
  } catch { return null; }
}

function updateRelease(manifest: any): void {
  const button = document.getElementById('downloadButton') as HTMLAnchorElement | null;
  const hero = document.getElementById('heroDownload') as HTMLAnchorElement | null;
  if (!button) return;
  const officialUrl = officialDownloadUrl(manifest?.client?.updateUrl) || RELEASE_FALLBACK;
  button.href = officialUrl;
  if (hero) hero.href = officialUrl;
  const meta = document.getElementById('downloadMeta');
  if (meta) {
    const size = Number(manifest?.client?.sizeBytes);
    meta.textContent = Number.isFinite(size) && size > 0
      ? `Windows 10/11 · 64-bit · ${(size / (1024 * 1024)).toFixed(0)} MB`
      : 'Windows 10/11 · 64-bit';
  }
}

function createNewsCard(item: NewsItem, featured: boolean): HTMLElement {
  const article = document.createElement('article');
  article.className = `news-card${featured ? ' news-card-featured' : ''} reveal is-visible`;
  const top = document.createElement('div');
  top.className = 'news-card-top';
  const tag = document.createElement('span');
  tag.className = 'news-tag';
  tag.textContent = item.id === 'dewcosmetics-26-3-release' ? 'MINECRAFT · 26.3' : item.tag || 'UPDATE';
  const time = document.createElement('time');
  time.textContent = formatDate(item.publishedAt);
  if (item.publishedAt) time.dateTime = item.publishedAt;
  top.append(tag, time);
  const title = document.createElement('h2');
  title.textContent = item.title || 'DewClient update';
  const summary = document.createElement('p');
  summary.textContent = item.summary || '';
  article.append(top, title, summary);
  if (item.url) {
    try {
      const url = new URL(item.url, window.location.href);
      if (url.protocol === 'https:' && (url.hostname === 'dewclient.fun' || url.hostname === 'server.dewclient.fun' || url.hostname === 'discord.gg')) {
        const link = document.createElement('a');
        link.className = 'text-link';
        link.href = url.toString();
        link.textContent = 'Read more →';
        article.append(link);
      }
    } catch { /* Invalid optional links are omitted. */ }
  }
  return article;
}

function updateNews(manifest: any): void {
  const list = document.getElementById('newsList');
  if (!list) return;
  const remoteItems = Array.isArray(manifest?.news)
    ? (manifest.news as NewsItem[]).filter((item) => item && item.enabled !== false && typeof item.title === 'string')
    : [];
  const items = remoteItems.length ? remoteItems : [DEFAULT_NEWS];
  list.replaceChildren(...items.map((item, index) => createNewsCard(item, index === 0)));
}

document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  initNavigation();
  initMotion();
  initDownloads();
  const year = document.getElementById('year');
  if (year) year.textContent = String(new Date().getFullYear());
  void loadPublicManifest().then((manifest) => {
    if (!manifest) return;
    updateRelease(manifest);
    updateNews(manifest);
  });
});
