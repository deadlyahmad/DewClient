/**
 * DewClient Central Server - Strict Admin Email/Password Authentication
 */

import crypto from 'node:crypto';
import { CONFIG } from '../config.mjs';
import { fetchSupabase } from './supabaseHttp.mjs';

const normalizeEmail = (value) => typeof value === 'string' ? value.trim().toLowerCase() : '';
const PASSWORD_HASH_PREFIX = 'scrypt';
const PASSWORD_HASH_OPTIONS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const PASSWORD_HASH_BYTES = 64;
function signSessionPayload(payload) {
  if (!CONFIG.ADMIN_SESSION_SECRET) throw new Error('ADMIN_SESSION_SECRET must be configured before issuing admin sessions.');
  return crypto.createHmac('sha256', CONFIG.ADMIN_SESSION_SECRET).update(payload).digest('base64url');
}

function safeEqualHex(left, right) {
  if (!/^[a-f0-9]+$/i.test(left) || !/^[a-f0-9]+$/i.test(right) || left.length !== right.length) return false;
  return crypto.timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
}

function safeStaffRecord(row) {
  return {
    id: row.id,
    email: normalizeEmail(row.email),
    displayName: row.display_name || row.email,
    isActive: row.is_active === true,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null
  };
}

export class AuthService {
  static hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(String(password), salt, PASSWORD_HASH_BYTES, PASSWORD_HASH_OPTIONS).toString('hex');
    return `${PASSWORD_HASH_PREFIX}$${PASSWORD_HASH_OPTIONS.N}$${PASSWORD_HASH_OPTIONS.r}$${PASSWORD_HASH_OPTIONS.p}$${salt}$${hash}`;
  }

  static verifyPassword(password, encodedHash) {
    const stored = String(encodedHash || '');
    const parts = stored.split('$');
    if (parts.length === 6 && parts[0] === PASSWORD_HASH_PREFIX) {
      const [, n, r, p, salt, expected] = parts;
      if (Number(n) !== PASSWORD_HASH_OPTIONS.N || Number(r) !== PASSWORD_HASH_OPTIONS.r || Number(p) !== PASSWORD_HASH_OPTIONS.p || !/^[a-f0-9]{32}$/i.test(salt)) return false;
      const actual = crypto.scryptSync(String(password), salt, PASSWORD_HASH_BYTES, PASSWORD_HASH_OPTIONS).toString('hex');
      return safeEqualHex(actual, expected);
    }

    // Upgrade the previous unsalted SHA-256 format after a successful legacy login.
    if (/^[a-f0-9]{64}$/i.test(stored)) {
      const legacyHash = crypto.createHash('sha256').update(String(password)).digest('hex');
      return safeEqualHex(legacyHash, stored);
    }
    return false;
  }

  static async getDatabaseAdmin(email) {
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail || !CONFIG.SUPABASE_URL || !CONFIG.SUPABASE_KEY) {
      return null;
    }

    try {
      const url = `${CONFIG.SUPABASE_URL}/rest/v1/dew_admins?email=eq.${encodeURIComponent(normalizedEmail)}&select=id,email,password_hash,display_name,session_version,is_active,created_at,updated_at`;
      const res = await fetchSupabase(url, {
        headers: {
          apikey: CONFIG.SUPABASE_KEY,
          Authorization: `Bearer ${CONFIG.SUPABASE_KEY}`,
          'Content-Type': 'application/json'
        }
      });

      if (!res.ok) {
        return null;
      }

      const rows = await res.json();
      return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
    } catch {
      console.error('[AUTH] Database staff lookup failed.');
      return null;
    }
  }

  static async updatePasswordHash(id, passwordHash) {
    const url = `${CONFIG.SUPABASE_URL}/rest/v1/dew_admins?id=eq.${encodeURIComponent(id)}`;
    const res = await fetchSupabase(url, {
      method: 'PATCH',
      headers: {
        apikey: CONFIG.SUPABASE_KEY,
        Authorization: `Bearer ${CONFIG.SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal'
      },
      body: JSON.stringify({ password_hash: passwordHash, updated_at: new Date().toISOString() })
    });
    if (!res.ok) throw new Error(`Staff password update failed (${res.status}).`);
  }

  static async verifyCredentials(email, password) {
    const suppliedEmail = normalizeEmail(email);
    const suppliedPassword = String(password || '');
    if (!suppliedEmail || suppliedEmail.length > 254 || suppliedPassword.length < 1 || suppliedPassword.length > 256) return false;
    const dbAdmin = await this.getDatabaseAdmin(suppliedEmail);
    if (!dbAdmin || dbAdmin.is_active !== true || !dbAdmin.password_hash) return false;
    if (!this.verifyPassword(suppliedPassword, dbAdmin.password_hash)) return false;
    if (/^[a-f0-9]{64}$/i.test(String(dbAdmin.password_hash))) {
      try {
        await this.updatePasswordHash(dbAdmin.id, this.hashPassword(suppliedPassword));
      } catch {
        console.error('[AUTH] Legacy password hash upgrade failed.');
      }
    }
    return true;
  }

  static createSessionToken(email, sessionVersion = 1) {
    const payload = {
      email: normalizeEmail(email),
      exp: Date.now() + Number(CONFIG.ADMIN_SESSION_TTL_MS || 8 * 60 * 60 * 1000),
      sv: Number(sessionVersion),
      v: 'dewclient-admin-v1'
    };
    const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return `${encodedPayload}.${signSessionPayload(encodedPayload)}`;
  }

  static async verifySession(req) {
    const authHeader = String(req.headers['authorization'] || '');
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';

    if (!token) {
      return null;
    }

    try {
      const [encodedPayload, suppliedSignature, ...extraParts] = token.split('.');
      if (!encodedPayload || !suppliedSignature || extraParts.length > 0) {
        return null;
      }

      const expectedSignature = Buffer.from(signSessionPayload(encodedPayload));
      const actualSignature = Buffer.from(suppliedSignature);
      if (actualSignature.length !== expectedSignature.length || !crypto.timingSafeEqual(actualSignature, expectedSignature)) {
        return null;
      }

      const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
      if (!payload?.email || payload.v !== 'dewclient-admin-v1' || !Number.isSafeInteger(payload.sv)) {
        return null;
      }

      if (!Number.isFinite(payload.exp) || payload.exp <= Date.now()) {
        return null;
      }

      const userEmail = normalizeEmail(payload.email);
      if (!userEmail) {
        return null;
      }

      const activeAdmin = await this.getDatabaseAdmin(userEmail);
      if (!activeAdmin || activeAdmin.is_active !== true || Number(activeAdmin.session_version || 1) !== payload.sv) return null;
      const admin = safeStaffRecord(activeAdmin);
      return {
        ...admin,
        user_metadata: { name: admin.displayName }
      };
    } catch {
      console.error('[AUTH] Session verification failed.');
      return null;
    }
  }

  static async listStaff() {
    const res = await fetchSupabase(`${CONFIG.SUPABASE_URL}/rest/v1/dew_admins?select=id,email,display_name,is_active,created_at,updated_at&order=created_at.asc`, {
      headers: { apikey: CONFIG.SUPABASE_KEY, Authorization: `Bearer ${CONFIG.SUPABASE_KEY}` }
    });
    if (!res.ok) throw new Error(`Staff list query failed (${res.status}).`);
    return (await res.json()).map(safeStaffRecord);
  }

  static async createStaff({ email, password, displayName }) {
    const res = await fetchSupabase(`${CONFIG.SUPABASE_URL}/rest/v1/dew_admins`, {
      method: 'POST',
      headers: {
        apikey: CONFIG.SUPABASE_KEY,
        Authorization: `Bearer ${CONFIG.SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation'
      },
      body: JSON.stringify({
        email: normalizeEmail(email),
        password_hash: this.hashPassword(password),
        display_name: displayName || null,
        is_active: true
      })
    });
    if (!res.ok) throw new Error(`Staff creation failed (${res.status}).`);
    const [row] = await res.json();
    if (!row) throw new Error('Staff creation returned no record.');
    return safeStaffRecord(row);
  }

  static async updateStaff(id, changes) {
    const res = await fetchSupabase(`${CONFIG.SUPABASE_URL}/rest/v1/dew_admins?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: {
        apikey: CONFIG.SUPABASE_KEY,
        Authorization: `Bearer ${CONFIG.SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation'
      },
      body: JSON.stringify(changes)
    });
    if (!res.ok) throw new Error(`Staff update failed (${res.status}).`);
    const [row] = await res.json();
    return row ? safeStaffRecord(row) : null;
  }

  static async countActiveAdmins() {
    const res = await fetchSupabase(`${CONFIG.SUPABASE_URL}/rest/v1/dew_admins?select=id&is_active=eq.true`, {
      headers: { apikey: CONFIG.SUPABASE_KEY, Authorization: `Bearer ${CONFIG.SUPABASE_KEY}` }
    });
    if (!res.ok) throw new Error(`Active admin count failed (${res.status}).`);
    return (await res.json()).length;
  }

}
