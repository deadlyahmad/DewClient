/**
 * DewClient - Secure Logger with Automatic Secret Redaction
 */

import fs from 'node:fs';
import path from 'node:path';
import { sanitizeLogString } from '../../shared/schemas/validation.ts';
import { getPathManager } from '../storage/paths.ts';

export type LogLevel = 'INFO' | 'WARN' | 'ERROR' | 'DEBUG';

export class Logger {
  constructor(customPath?: string) {
    // Older builds wrote every internal client diagnostic to client.log. Clear
    // that legacy file once so verbose history from those builds is not left on
    // disk after upgrading. `customPath` is retained for API compatibility.
    const legacyPath = customPath;
    if (legacyPath) {
      try { fs.writeFileSync(legacyPath, '', { mode: 0o600 }); } catch { /* best effort */ }
    } else {
      try {
        fs.writeFileSync(path.join(getPathManager().getLogsPath(), 'client.log'), '', { mode: 0o600 });
      } catch { /* best effort */ }
    }
  }

  public log(level: LogLevel, tag: string, message: string, ...extra: any[]): void {
    const ts = new Date().toISOString();
    const sanitizedMsg = sanitizeLogString(message);
    const extraStr = extra.length
      ? ' ' + extra.map((e) => (typeof e === 'object' ? sanitizeLogString(JSON.stringify(e)) : sanitizeLogString(String(e)))).join(' ')
      : '';
    const line = `[${ts}] [${level}] [${tag}] ${sanitizedMsg}${extraStr}`;

    // Output to console
    if (level === 'ERROR') {
      console.error(line);
    } else if (level === 'WARN') {
      console.warn(line);
    } else {
      console.log(line);
    }

    // Application diagnostics stay in the local process console only. They
    // can contain local paths or account metadata, so they are never persisted
    // to the launcher's data directory or sent to the server.
  }

  public info(tag: string, message: string, ...extra: any[]): void {
    this.log('INFO', tag, message, ...extra);
  }

  public warn(tag: string, message: string, ...extra: any[]): void {
    this.log('WARN', tag, message, ...extra);
  }

  public error(tag: string, message: string, ...extra: any[]): void {
    this.log('ERROR', tag, message, ...extra);
  }

  public debug(tag: string, message: string, ...extra: any[]): void {
    this.log('DEBUG', tag, message, ...extra);
  }
}

let defaultLogger: Logger | null = null;

export function getLogger(): Logger {
  if (!defaultLogger) {
    defaultLogger = new Logger();
  }
  return defaultLogger;
}
