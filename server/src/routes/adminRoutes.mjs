/**
 * DewClient Central Server - Admin & Dashboard API Routes
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { CONFIG } from '../config.mjs';
import { AuthService } from '../services/authService.mjs';

export async function handleGetStaff(req, res) {
  const staff = await AuthService.listStaff();
  return sendJson(res, 200, { ok: true, data: staff });
}

export async function handleCreateStaff(req, res, body) {
  const email = String(body?.email || '').trim().toLowerCase();
  const password = String(body?.password || '');
  const displayName = String(body?.displayName || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 12 || password.length > 256
    || (displayName && displayName.length > 80)) {
    return sendJson(res, 400, { ok: false, error: { code: 'INVALID_ADMIN', message: 'Provide a valid email, a password of at least 12 characters, and a display name up to 80 characters.' } });
  }
  try {
    const staff = await AuthService.createStaff({ email, password, displayName });
    return sendJson(res, 201, { ok: true, data: staff });
  } catch (error) {
    if (/\(409\)/.test(error.message)) {
      return sendJson(res, 409, { ok: false, error: { code: 'STAFF_EXISTS', message: 'A staff account with that email already exists.' } });
    }
    throw error;
  }
}

export async function handleUpdateStaff(req, res, staffId, actor, body) {
  const staff = await AuthService.listStaff();
  const target = staff.find((entry) => entry.id === staffId);
  if (!target) return sendJson(res, 404, { ok: false, error: { code: 'STAFF_NOT_FOUND', message: 'Staff account was not found.' } });

  const changes = {};
  if (body?.isActive !== undefined) {
    if (typeof body.isActive !== 'boolean') {
      return sendJson(res, 400, { ok: false, error: { code: 'INVALID_STATUS', message: 'isActive must be a boolean.' } });
    }
    if (target.id === actor.id && body.isActive !== target.isActive) {
      return sendJson(res, 403, { ok: false, error: { code: 'SELF_STATUS_CHANGE', message: 'Staff cannot disable their own account.' } });
    }
    changes.is_active = body.isActive;
  }
  if (body?.displayName !== undefined) {
    if (typeof body.displayName !== 'string' || body.displayName.trim().length > 80) {
      return sendJson(res, 400, { ok: false, error: { code: 'INVALID_DISPLAY_NAME', message: 'Display name must be 80 characters or fewer.' } });
    }
    changes.display_name = body.displayName.trim() || null;
  }
  if (body?.password !== undefined) {
    if (typeof body.password !== 'string' || body.password.length < 12 || body.password.length > 256) {
      return sendJson(res, 400, { ok: false, error: { code: 'INVALID_PASSWORD', message: 'Password must be between 12 and 256 characters.' } });
    }
    changes.password_hash = AuthService.hashPassword(body.password);
  }
  if (Object.keys(changes).length === 0) {
    return sendJson(res, 400, { ok: false, error: { code: 'EMPTY_UPDATE', message: 'Provide at least one supported staff field to update.' } });
  }

  const remainsActiveAdmin = changes.is_active === undefined ? target.isActive : changes.is_active;
  if (target.isActive && !remainsActiveAdmin && await AuthService.countActiveAdmins() <= 1) {
    return sendJson(res, 409, { ok: false, error: { code: 'LAST_ACTIVE_ADMIN', message: 'At least one active administrator must remain.' } });
  }

  changes.updated_at = new Date().toISOString();
  const updated = await AuthService.updateStaff(staffId, changes);
  if (!updated) return sendJson(res, 404, { ok: false, error: { code: 'STAFF_NOT_FOUND', message: 'Staff account was not found.' } });
  return sendJson(res, 200, { ok: true, data: updated });
}

export async function handleGetStats(req, res, storage) {
  const stats = await storage.getStats();
  return sendJson(res, 200, { ok: true, data: stats });
}

export async function handleGetAccounts(req, res, storage, query) {
  const parsedLimit = Number(query?.limit || 50);
  const parsedPage = Number(query?.page || 1);
  const limit = Number.isInteger(parsedLimit) ? Math.max(1, Math.min(100, parsedLimit)) : 50;
  const page = Number.isInteger(parsedPage) ? Math.max(1, Math.min(100_000, parsedPage)) : 1;
  const search = typeof query?.search === 'string' ? query.search.trim().slice(0, 100) : '';
  const offset = (page - 1) * limit;
  let paginated;
  let total;

  if (typeof storage.getAccountsPage === 'function') {
    const result = await storage.getAccountsPage({ search, limit, offset });
    paginated = result.accounts;
    total = result.total;
  } else {
    const accounts = await storage.getAccounts({ search, limit, offset });
    const filtered = accounts.filter((account) => !search
      || account.username?.toLowerCase().includes(search.toLowerCase())
      || account.uuid?.toLowerCase().includes(search.toLowerCase()));
    total = filtered.length;
    paginated = filtered.slice(offset, offset + limit);
  }

  return sendJson(res, 200, {
    ok: true,
    data: {
      total,
      page,
      limit,
      accounts: paginated,
      pages: Math.ceil(total / limit)
    }
  });
}

export async function handleGetClients(req, res, storage) {
  const clients = await storage.getClients();
  const twoMinutesAgo = Date.now() - 2 * 60 * 1000;

  const decorated = clients.map((c) => ({
    ...c,
    isOnline: Boolean(c.lastSeenAt && new Date(c.lastSeenAt).getTime() >= twoMinutesAgo)
  }));

  return sendJson(res, 200, { ok: true, data: decorated });
}

export async function handleUpdateServer(req, res, storage, body) {
  const { id, name, host, port, tags, enabled, priority, iconUrl } = body || {};
  if (!name || !host || (enabled !== undefined && typeof enabled !== 'boolean')) {
    return sendJson(res, 400, { ok: false, error: { code: 'INVALID_DATA', message: 'Server name and host required.' } });
  }

  const manifest = await storage.getManifest();
  const servers = manifest.featuredServers || [];
  const serverId = id || `srv-${Date.now()}`;

  const existingIndex = servers.findIndex((s) => s.id === serverId);
  const serverObj = {
    id: serverId,
    name,
    host,
    port: parseInt(port || '25565', 10),
    tags: Array.isArray(tags) ? tags : typeof tags === 'string' ? tags.split(',').map((t) => t.trim()) : [],
    enabled: enabled !== undefined ? Boolean(enabled) : true,
    priority: parseInt(priority || '50', 10),
    iconUrl: iconUrl || `https://api.mcstatus.io/v2/icon/${encodeURIComponent(`${String(host).trim()}:${parseInt(port || '25565', 10)}`)}`
  };

  if (existingIndex >= 0) {
    servers[existingIndex] = serverObj;
  } else {
    servers.push(serverObj);
  }

  manifest.featuredServers = servers;
  await storage.saveManifest(manifest);
  return sendJson(res, 200, { ok: true, data: serverObj });
}

export async function handleDeleteServer(req, res, storage, id) {
  const manifest = await storage.getManifest();
  manifest.featuredServers = (manifest.featuredServers || []).filter((s) => s.id !== id);
  await storage.saveManifest(manifest);
  return sendJson(res, 200, { ok: true, message: 'Server removed' });
}

export async function handleUpdateNews(req, res, storage, body) {
  const { id, title, summary, tag, imageUrl, url, enabled } = body || {};
  if (!title || !summary || (enabled !== undefined && typeof enabled !== 'boolean')) {
    return sendJson(res, 400, { ok: false, error: { code: 'INVALID_DATA', message: 'News title and summary required.' } });
  }

  const manifest = await storage.getManifest();
  const newsList = manifest.news || [];
  const newsId = id || `news-${Date.now()}`;

  const existingIndex = newsList.findIndex((n) => n.id === newsId);
  const newsObj = {
    id: newsId,
    title,
    summary,
    tag: tag || 'UPDATE',
    imageUrl: imageUrl || '',
    url: url || '',
    publishedAt: new Date().toISOString(),
    enabled: enabled !== undefined ? Boolean(enabled) : true
  };

  if (existingIndex >= 0) {
    newsList[existingIndex] = { ...newsList[existingIndex], ...newsObj };
  } else {
    newsList.unshift(newsObj);
  }

  manifest.news = newsList;
  await storage.saveManifest(manifest);
  return sendJson(res, 200, { ok: true, data: newsObj });
}

export async function handleDeleteNews(req, res, storage, id) {
  const manifest = await storage.getManifest();
  manifest.news = (manifest.news || []).filter((n) => n.id !== id);
  await storage.saveManifest(manifest);
  return sendJson(res, 200, { ok: true, message: 'News item removed' });
}

export async function handleUpdateAnnouncement(req, res, storage, body) {
  const { id, title, message, severity, url, enabled, priority } = body || {};
  if (!title || !message || (enabled !== undefined && typeof enabled !== 'boolean')) {
    return sendJson(res, 400, { ok: false, error: { code: 'INVALID_DATA', message: 'Title and message required.' } });
  }

  const manifest = await storage.getManifest();
  const annList = manifest.announcements || [];
  const annId = id || `ann-${Date.now()}`;

  const existingIndex = annList.findIndex((a) => a.id === annId);
  const annObj = {
    id: annId,
    title,
    message,
    severity: severity || 'info',
    url: url || '',
    enabled: enabled !== undefined ? Boolean(enabled) : true,
    priority: parseInt(priority || '10', 10)
  };

  if (existingIndex >= 0) {
    annList[existingIndex] = annObj;
  } else {
    annList.push(annObj);
  }

  manifest.announcements = annList;
  await storage.saveManifest(manifest);
  return sendJson(res, 200, { ok: true, data: annObj });
}

export async function handleDeleteAnnouncement(req, res, storage, id) {
  const manifest = await storage.getManifest();
  manifest.announcements = (manifest.announcements || []).filter((a) => a.id !== id);
  await storage.saveManifest(manifest);
  return sendJson(res, 200, { ok: true, message: 'Announcement removed' });
}

export async function handleToggleMaintenance(req, res, storage, body) {
  const { enabled, mode, title, message } = body || {};
  if (typeof enabled !== 'boolean') {
    return sendJson(res, 400, { ok: false, error: { code: 'INVALID_DATA', message: 'enabled must be a boolean.' } });
  }
  const manifest = await storage.getManifest();

  manifest.maintenance = {
    enabled: Boolean(enabled),
    mode: mode === 'hard' ? 'hard' : 'soft',
    title: title || 'Scheduled Maintenance',
    message: message || 'DewClient server infrastructure is undergoing scheduled maintenance.'
  };

  await storage.saveManifest(manifest);
  return sendJson(res, 200, { ok: true, data: manifest.maintenance });
}

export async function handleGetClientRelease(req, res, storage) {
  const manifest = await storage.getManifest();
  const clientRelease = manifest.client || {
    latestVersion: '',
    minimumVersion: '',
    updateUrl: '',
    notesUrl: ''
  };

  return sendJson(res, 200, { ok: true, data: clientRelease });
}

export async function handleUpdateClientRelease(req, res, storage, body) {
  const payload = body || {};
  const manifest = await storage.getManifest();
  const current = manifest.client || {
    latestVersion: '',
    minimumVersion: '',
    updateUrl: '',
    notesUrl: ''
  };

  const next = {
    ...current,
    ...payload
  };

  const versionPattern = /^v?\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/;
  if (next.latestVersion && !versionPattern.test(String(next.latestVersion).trim())) {
    return sendJson(res, 400, { ok: false, error: { code: 'INVALID_VERSION', message: 'latestVersion must be a valid semver string.' } });
  }
  if (next.minimumVersion && !versionPattern.test(String(next.minimumVersion).trim())) {
    return sendJson(res, 400, { ok: false, error: { code: 'INVALID_VERSION', message: 'minimumVersion must be a valid semver string.' } });
  }

  if (next.sha256 && !/^[a-f0-9]{64}$/i.test(String(next.sha256))) {
    return sendJson(res, 400, { ok: false, error: { code: 'INVALID_HASH', message: 'sha256 must be a 64-character hexadecimal digest.' } });
  }
  if (next.sizeBytes !== undefined && (!Number.isSafeInteger(Number(next.sizeBytes)) || Number(next.sizeBytes) <= 0)) {
    return sendJson(res, 400, { ok: false, error: { code: 'INVALID_SIZE', message: 'sizeBytes must be a positive safe integer.' } });
  }

  if (next.updateUrl !== undefined && next.updateUrl !== null && String(next.updateUrl).trim() !== '') {
    try {
      const url = new URL(String(next.updateUrl).trim());
      if (url.protocol !== 'https:') {
        throw new Error('Invalid protocol');
      }
      next.updateUrl = url.toString();
    } catch {
      return sendJson(res, 400, { ok: false, error: { code: 'INVALID_URL', message: 'updateUrl must be a valid HTTPS URL.' } });
    }
    if (!/^[a-f0-9]{64}$/i.test(String(next.sha256 || ''))
      || !Number.isSafeInteger(Number(next.sizeBytes))
      || Number(next.sizeBytes) <= 0
      || Number(next.sizeBytes) > 2 * 1024 * 1024 * 1024) {
      return sendJson(res, 400, { ok: false, error: { code: 'INVALID_INTEGRITY_METADATA', message: 'Installer releases require a SHA-256 digest and a valid size up to 2 GiB.' } });
    }
  }

  if (next.notesUrl !== undefined && next.notesUrl !== null && String(next.notesUrl).trim() !== '') {
    try {
      const url = new URL(String(next.notesUrl).trim());
      if (!['http:', 'https:'].includes(url.protocol)) {
        throw new Error('Invalid protocol');
      }
      next.notesUrl = url.toString();
    } catch {
      return sendJson(res, 400, { ok: false, error: { code: 'INVALID_URL', message: 'notesUrl must be a valid http/https URL.' } });
    }
  }

  manifest.client = next;
  await storage.saveManifest(manifest);
  return sendJson(res, 200, { ok: true, data: manifest.client });
}

export async function handleUploadClientRelease(req, res, query) {
  const version = String(query?.version || '').trim();
  const versionPattern = /^v?\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/;
  if (!versionPattern.test(version)) {
    return sendJson(res, 400, { ok: false, error: { code: 'INVALID_VERSION', message: 'A valid release version is required.' } });
  }
  if (req.headers['content-type'] !== 'application/octet-stream') {
    return sendJson(res, 415, { ok: false, error: { code: 'INVALID_CONTENT_TYPE', message: 'Upload the installer as application/octet-stream.' } });
  }

  const maxBytes = 2 * 1024 * 1024 * 1024;
  const declaredSize = Number(req.headers['content-length'] || 0);
  if (declaredSize > maxBytes) {
    return sendJson(res, 413, { ok: false, error: { code: 'FILE_TOO_LARGE', message: 'Installer exceeds the 2 GiB upload limit.' } });
  }

  fs.mkdirSync(CONFIG.RELEASE_DIR, { recursive: true });
  const safeVersion = version.replace(/[^A-Za-z0-9.-]/g, '_');
  const filename = `DewClient-${safeVersion}-${crypto.randomUUID()}.exe`;
  const targetPath = path.join(CONFIG.RELEASE_DIR, filename);
  const temporaryPath = `${targetPath}.upload`;
  const hash = crypto.createHash('sha256');
  const header = Buffer.alloc(2);
  let headerBytes = 0;
  let sizeBytes = 0;

  const verifier = new Transform({
    transform(chunk, encoding, callback) {
      sizeBytes += chunk.length;
      if (sizeBytes > maxBytes) {
        callback(new Error('Installer exceeds the 2 GiB upload limit.'));
        return;
      }
      if (headerBytes < 2) {
        const copied = chunk.copy(header, headerBytes, 0, Math.min(chunk.length, 2 - headerBytes));
        headerBytes += copied;
      }
      hash.update(chunk);
      callback(null, chunk);
    }
  });

  try {
    await pipeline(req, verifier, fs.createWriteStream(temporaryPath, { flags: 'wx' }));
    if (headerBytes !== 2 || header.toString('ascii') !== 'MZ') {
      throw new Error('Uploaded file is not a valid Windows executable.');
    }
    if (declaredSize && declaredSize !== sizeBytes) {
      throw new Error('Uploaded file size does not match Content-Length.');
    }
    fs.renameSync(temporaryPath, targetPath);

    const publicDomain = String(CONFIG.PUBLIC_DOMAIN).replace(/^https?:\/\//i, '').replace(/\/+$/, '');
    return sendJson(res, 201, {
      ok: true,
      data: {
        filename,
        updateUrl: `https://${publicDomain}/downloads/${encodeURIComponent(filename)}`,
        sha256: hash.digest('hex'),
        sizeBytes
      }
    });
  } catch (error) {
    if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
    if (/2 GiB upload limit/.test(error.message)) {
      return sendJson(res, 413, { ok: false, error: { code: 'FILE_TOO_LARGE', message: 'Installer exceeds the 2 GiB upload limit.' } });
    }
    if (error.message === 'Uploaded file is not a valid Windows executable.' || error.message === 'Uploaded file size does not match Content-Length.') {
      return sendJson(res, 400, { ok: false, error: { code: 'INVALID_UPLOAD', message: error.message } });
    }
    return sendJson(res, 500, { ok: false, error: { code: 'UPLOAD_FAILED', message: 'Installer upload failed.' } });
  }
}

function sendJson(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json'
  });
  res.end(JSON.stringify(data));
}
