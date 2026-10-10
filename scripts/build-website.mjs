import esbuild from 'esbuild';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import AdmZip from 'adm-zip';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const websiteDir = path.join(rootDir, 'website');
const outDir = path.join(rootDir, 'dist-website');
const zipFile = path.join(rootDir, 'dist-website.zip');

async function buildProductionWebsite() {
  console.log('🚀 [Build Website] Starting production build for DewClient website...');

  // 1. Clean previous build directory and zip
  if (fs.existsSync(outDir)) {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
  if (fs.existsSync(zipFile)) {
    fs.rmSync(zipFile, { force: true });
  }
  fs.mkdirSync(outDir, { recursive: true });
  fs.mkdirSync(path.join(outDir, 'css'), { recursive: true });
  fs.mkdirSync(path.join(outDir, 'js'), { recursive: true });
  fs.mkdirSync(path.join(outDir, 'assets'), { recursive: true });

  // 2. Bundle & Minify JavaScript via esbuild
  console.log('📦 [1/6] Bundling & minifying JavaScript...');
  await esbuild.build({
    entryPoints: [path.join(websiteDir, 'src/main.ts')],
    bundle: true,
    minify: true,
    target: 'es2020',
    format: 'iife',
    outfile: path.join(outDir, 'js/main.js')
  });

  // Also update local website/js/main.js for local dev
  await esbuild.build({
    entryPoints: [path.join(websiteDir, 'src/main.ts')],
    bundle: true,
    minify: false,
    target: 'es2020',
    format: 'iife',
    outfile: path.join(websiteDir, 'js/main.js')
  });

  // 3. Bundle & Minify CSS via esbuild
  console.log('🎨 [2/6] Bundling & minifying CSS stylesheets...');
  await esbuild.build({
    entryPoints: [path.join(websiteDir, 'css/style.css')],
    bundle: true,
    minify: true,
    outfile: path.join(outDir, 'css/style.css'),
    loader: { '.css': 'css' }
  });

  // Also copy tokens.css into dist for reference
  if (fs.existsSync(path.join(websiteDir, 'css/tokens.css'))) {
    fs.copyFileSync(
      path.join(websiteDir, 'css/tokens.css'),
      path.join(outDir, 'css/tokens.css')
    );
  }

  // 4. Copy HTML files & Assets
  console.log('📄 [3/6] Copying HTML files & assets...');
  fs.copyFileSync(path.join(rootDir, 'icon', 'DewClient.ico'), path.join(websiteDir, 'favicon.ico'));
  const htmlFiles = ['index.html', 'news.html', 'privacy.html', 'terms.html'];
  for (const file of htmlFiles) {
    const srcPath = path.join(websiteDir, file);
    if (fs.existsSync(srcPath)) {
      fs.copyFileSync(srcPath, path.join(outDir, file));
    }
  }

  // Copy assets folder
  const assetsSrc = path.join(websiteDir, 'assets');
  if (fs.existsSync(assetsSrc)) {
    fs.cpSync(assetsSrc, path.join(outDir, 'assets'), { recursive: true });
  }

  // Copy favicons
  const favicons = ['favicon.ico'];
  for (const fav of favicons) {
    const favPath = path.join(websiteDir, fav);
    if (fs.existsSync(favPath)) {
      fs.copyFileSync(favPath, path.join(outDir, fav));
    }
  }

  // Copy .well-known folder (for Microsoft / Azure publisher domain verification)
  const wellKnownSrc = path.join(websiteDir, '.well-known');
  if (fs.existsSync(wellKnownSrc)) {
    fs.cpSync(wellKnownSrc, path.join(outDir, '.well-known'), { recursive: true });
  }

  // 5. Generate SEO & Hosting Configurations (robots.txt, sitemap.xml, _headers, nginx.conf)
  console.log('🌐 [4/6] Generating SEO & Web Server configurations...');

  // robots.txt
  const robotsTxt = `User-agent: *
Allow: /

Sitemap: https://dewclient.fun/sitemap.xml
`;
  fs.writeFileSync(path.join(outDir, 'robots.txt'), robotsTxt, 'utf8');

  // sitemap.xml
  const sitemapLastmod = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi' }).format(new Date());
  const sitemapXml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://dewclient.fun/</loc>
    <lastmod>${sitemapLastmod}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>
  <url>
    <loc>https://dewclient.fun/news.html</loc>
    <lastmod>${sitemapLastmod}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
  </url>
  <url>
    <loc>https://dewclient.fun/privacy.html</loc>
    <lastmod>${sitemapLastmod}</lastmod>
    <changefreq>yearly</changefreq>
    <priority>0.3</priority>
  </url>
  <url>
    <loc>https://dewclient.fun/terms.html</loc>
    <lastmod>${sitemapLastmod}</lastmod>
    <changefreq>yearly</changefreq>
    <priority>0.3</priority>
  </url>
</urlset>
`;
  fs.writeFileSync(path.join(outDir, 'sitemap.xml'), sitemapXml, 'utf8');

  // _headers (for Cloudflare Pages / Netlify security & caching)
  const headersConfig = `/*
  X-Frame-Options: SAMEORIGIN
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: geolocation=(), microphone=(), camera=()

/css/*
  Cache-Control: public, max-age=31536000, immutable

/js/*
  Cache-Control: public, max-age=31536000, immutable

/assets/*
  Cache-Control: public, max-age=31536000, immutable
`;
  fs.writeFileSync(path.join(outDir, '_headers'), headersConfig, 'utf8');

  // Nginx configuration example for VPS hosting
  const nginxExample = `# DewClient VPS Nginx Configuration Template
# Place in: /etc/nginx/sites-available/dewclient.fun
# Symlink: ln -s /etc/nginx/sites-available/dewclient.fun /etc/nginx/sites-enabled/

server {
    listen 80;
    listen [::]:80;
    server_name dewclient.fun www.dewclient.fun;

    # Root directory pointing to the extracted build
    root /var/www/dewclient;
    index index.html;

    # Gzip compression
    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_types text/plain text/css text/xml application/javascript application/json image/svg+xml;

    location / {
        try_files $uri $uri/ =404;
    }

    # Static assets caching
    location ~* \\.(css|js|png|jpg|jpeg|gif|ico|svg|woff|woff2)$ {
        expires 1y;
        add_header Cache-Control "public, no-transform";
    }

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
}
`;
  fs.writeFileSync(path.join(outDir, 'nginx.conf.example'), nginxExample, 'utf8');

  // 6. Create Zip Archive (for 1-click upload to Hostinger / VPS / cPanel)
  console.log('🗜️  [5/6] Creating production zip archive (dist-website.zip)...');
  const zip = new AdmZip();
  zip.addLocalFolder(outDir);
  zip.writeZip(zipFile);

  const zipStats = fs.statSync(zipFile);
  console.log(`✅ [6/6] Production build ready!`);
  console.log(`📁 Build Folder: ${outDir}`);
  console.log(`📦 Zip Package: ${zipFile} (${(zipStats.size / 1024).toFixed(1)} KB)`);
}

buildProductionWebsite().catch((err) => {
  console.error('❌ Build failed:', err);
  process.exit(1);
});
