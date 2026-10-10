import crypto from 'node:crypto';

const CATEGORIES = new Set(['launcher', 'game-launch', 'account', 'cosmetics', 'other']);
const STATUSES = new Set(['pending', 'reviewing', 'resolved']);

function reply(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(JSON.stringify(payload));
}

function safeVersion(value) {
  if (typeof value !== 'string') return null;
  const version = value.trim();
  return /^[0-9A-Za-z._+-]{1,32}$/.test(version) ? version : null;
}

export async function handleSubmitBugReport(res, storage, body) {
  const category = typeof body?.category === 'string' ? body.category : '';
  const title = typeof body?.title === 'string' ? body.title.trim() : '';
  const description = typeof body?.description === 'string' ? body.description.trim() : '';
  const clientVersion = safeVersion(body?.clientVersion);
  const minecraftVersion = safeVersion(body?.minecraftVersion);

  if (!CATEGORIES.has(category) || title.length < 8 || title.length > 120
    || description.length < 20 || description.length > 5000 || !clientVersion) {
    return reply(res, 400, { ok: false, error: { code: 'INVALID_BUG_REPORT', message: 'Check the category, title, and description, then try again.' } });
  }

  try {
    const id = crypto.randomUUID();
    await storage.createBugReport({ id, category, title, description, clientVersion, minecraftVersion });
    return reply(res, 201, { ok: true, data: { id } });
  } catch {
    return reply(res, 503, { ok: false, error: { code: 'BUG_REPORT_UNAVAILABLE', message: 'The report could not be saved right now. Try again later.' } });
  }
}

export async function handleGetBugReports(res, storage, query = {}) {
  const status = typeof query.status === 'string' && query.status !== 'all' ? query.status : null;
  if (status && !STATUSES.has(status)) {
    return reply(res, 400, { ok: false, error: { code: 'INVALID_REPORT_STATUS', message: 'Choose a valid report status.' } });
  }

  const parsedOffset = Number.parseInt(String(query.offset || '0'), 10);
  const offset = Number.isFinite(parsedOffset) ? Math.max(0, Math.min(1_000_000, parsedOffset)) : 0;
  try {
    const page = await storage.getBugReports({ status, limit: 100, offset });
    return reply(res, 200, { ok: true, data: page });
  } catch {
    return reply(res, 503, { ok: false, error: { code: 'BUG_REPORTS_UNAVAILABLE', message: 'Bug reports could not be loaded right now.' } });
  }
}

export async function handleUpdateBugReport(res, storage, id, body, admin) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    return reply(res, 400, { ok: false, error: { code: 'INVALID_REPORT_ID', message: 'This report reference is invalid.' } });
  }
  const status = typeof body?.status === 'string' ? body.status : '';
  const note = typeof body?.resolutionNote === 'string' ? body.resolutionNote.trim().slice(0, 1000) : '';
  if (!STATUSES.has(status)) {
    return reply(res, 400, { ok: false, error: { code: 'INVALID_REPORT_STATUS', message: 'Choose Pending, Under review, or Resolved.' } });
  }

  try {
    const report = await storage.updateBugReport(id, {
      status,
      resolutionNote: note || null,
      resolvedBy: status === 'resolved' ? (admin?.email || null) : null
    });
    if (!report) return reply(res, 404, { ok: false, error: { code: 'REPORT_NOT_FOUND', message: 'That bug report no longer exists.' } });
    return reply(res, 200, { ok: true, data: report });
  } catch {
    return reply(res, 503, { ok: false, error: { code: 'BUG_REPORT_UPDATE_FAILED', message: 'The report status could not be updated.' } });
  }
}
