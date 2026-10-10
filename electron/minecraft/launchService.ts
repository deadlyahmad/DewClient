/**
 * DewClient - Minecraft Launch Process Supervisor
 *
 * Minecraft output is streamed to the visible console in bounded batches. It
 * is intentionally not copied into launcher log files or uploaded anywhere.
 */

import fs from 'node:fs';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { spawn, type ChildProcess } from 'node:child_process';
import type { LaunchStatusUpdate, GameLogEntry } from '../../shared/types/minecraft.ts';
import { sanitizeLogString } from '../../shared/schemas/validation.ts';
import { getLogger } from '../core/logger.ts';
import { getPathManager } from '../storage/paths.ts';

export interface ActiveGameProcess {
  instanceId: string;
  process: ChildProcess;
  pid?: number;
  startTime: number;
}

export interface LaunchProcessOptions {
  env?: NodeJS.ProcessEnv;
}

const CONSOLE_FLUSH_MS = 150;
const MAX_PENDING_LINES = 400;
const MAX_LINE_CHARS = 1200;
const MAX_HISTORY_BYTES = 24 * 1024;

function sanitizeMinecraftConsoleLine(value: string): string {
  if (/Failed to verify signature on property|Profile contained invalid signature/i.test(value)) {
    return '[Minecraft] A player texture signature could not be verified; profile details hidden.';
  }
  if (/\[CHAT\]/i.test(value)) return '[Minecraft] In-game chat text hidden from launcher console.';
  if (/Found graphics adapter:|Using graphics device:|using drivers:/i.test(value)) return '[Minecraft] Graphics device initialized.';
  return sanitizeLogString(value)
    .replace(/(Setting user:\s*).+/i, '$1[hidden]')
    .replace(/\b[A-Z]:\\Users\\[^\\\s"']+/gi, '[user folder]')
    .replace(/\b\/home\/[^/\s]+/g, '[user folder]')
    .trimEnd();
}

function recordLaunchSummary(event: 'started' | 'closed' | 'failed', durationSeconds?: number, exitCode?: number): void {
  try {
    const filePath = path.join(getPathManager().getLogsPath(), 'minecraft-launch-history.jsonl');
    const row = JSON.stringify({
      at: new Date().toISOString(),
      event,
      ...(Number.isFinite(durationSeconds) ? { durationSeconds: Math.max(0, Math.round(durationSeconds!)) } : {}),
      ...(Number.isSafeInteger(exitCode) ? { exitCode } : {})
    }) + '\n';
    if (fs.existsSync(filePath) && fs.statSync(filePath).size > MAX_HISTORY_BYTES) {
      const rows = fs.readFileSync(filePath, 'utf8').split(/\r?\n/).filter(Boolean).slice(-80);
      fs.writeFileSync(filePath, rows.join('\n') + (rows.length ? '\n' : ''), { encoding: 'utf8', mode: 0o600 });
    }
    fs.appendFileSync(filePath, row, { encoding: 'utf8', mode: 0o600 });
  } catch {
    // A history file is optional; it must never block game startup.
  }
}

export class LaunchService {
  private activeProcesses = new Map<string, ActiveGameProcess>();
  private stoppingInstances = new Set<string>();
  private stopTimeouts = new Map<string, NodeJS.Timeout>();

  public isInstanceRunning(instanceId: string): boolean {
    const act = this.activeProcesses.get(instanceId);
    return Boolean(act && act.process && act.process.exitCode === null && act.process.signalCode === null);
  }

  public getRunningPids(): Record<string, number> {
    const pids: Record<string, number> = {};
    for (const [id, act] of this.activeProcesses.entries()) {
      if (act.pid) pids[id] = act.pid;
    }
    return pids;
  }

  public stopInstance(instanceId: string): boolean {
    const act = this.activeProcesses.get(instanceId);
    if (!act || !act.process) return false;
    if (this.stoppingInstances.has(instanceId)) return true;

    try {
      if (!act.process.kill('SIGTERM')) return false;
      this.stoppingInstances.add(instanceId);
      const timeout = setTimeout(() => {
        this.stopTimeouts.delete(instanceId);
        if (this.isInstanceRunning(instanceId)) act.process.kill('SIGKILL');
      }, 5000);
      timeout.unref?.();
      this.stopTimeouts.set(instanceId, timeout);
      return true;
    } catch {
      return false;
    }
  }

  public launchProcess(
    instanceId: string,
    command: string,
    args: string[],
    cwd: string,
    onStatus?: (status: LaunchStatusUpdate) => void,
    onLog?: (log: GameLogEntry) => void,
    options: LaunchProcessOptions = {}
  ): Promise<number> {
    const logger = getLogger();
    if (this.isInstanceRunning(instanceId)) throw new Error(`Instance '${instanceId}' is already running.`);

    logger.info('launch', 'Starting Minecraft process.');

    return new Promise((resolve, reject) => {
      try {
        const proc = spawn(command, args, {
          cwd,
          detached: false,
          stdio: ['ignore', 'pipe', 'pipe'],
          env: options.env ? { ...process.env, ...options.env } : undefined,
          windowsHide: false
        });

        const pid = proc.pid;
        const startTime = Date.now();
        recordLaunchSummary('started');
        this.activeProcesses.set(instanceId, { instanceId, process: proc, pid, startTime });
        onStatus?.({ instanceId, state: 'running', pid, message: 'Minecraft is starting.' });

        let pendingLines: string[] = [];
        let droppedLines = 0;
        let flushTimer: NodeJS.Timeout | null = null;
        const decoders = { STDOUT: new StringDecoder('utf8'), STDERR: new StringDecoder('utf8') };
        const partialLines = { STDOUT: '', STDERR: '' };
        const hidingTextureSignatureStack = { STDOUT: false, STDERR: false };

        const flushConsole = () => {
          if (flushTimer) clearTimeout(flushTimer);
          flushTimer = null;
          if (!pendingLines.length || !onLog) {
            pendingLines = [];
            return;
          }
          const prefix = droppedLines ? [`[DEWCLIENT] Console output is busy; ${droppedLines} older lines were skipped.`] : [];
          const message = [...prefix, ...pendingLines].join('\n');
          pendingLines = [];
          droppedLines = 0;
          onLog({ instanceId, timestamp: new Date().toISOString(), level: 'STDOUT', message });
        };

        const queueLine = (level: 'STDOUT' | 'STDERR', value: string) => {
          if (hidingTextureSignatureStack[level]) {
            if (/^\s+at\s|^java\.security\.SignatureException:/.test(value)) return;
            hidingTextureSignatureStack[level] = false;
          }
          if (/Failed to verify signature on property/i.test(value)) hidingTextureSignatureStack[level] = true;
          const sanitized = sanitizeMinecraftConsoleLine(value);
          if (!sanitized) return;
          const line = `[${level}] ${sanitized.slice(0, MAX_LINE_CHARS)}`;
          if (pendingLines.length >= MAX_PENDING_LINES) {
            pendingLines.shift();
            droppedLines += 1;
          }
          pendingLines.push(line);
          if (!flushTimer) {
            flushTimer = setTimeout(flushConsole, CONSOLE_FLUSH_MS);
            flushTimer.unref?.();
          }
        };

        const consumeChunk = (chunk: Buffer, level: 'STDOUT' | 'STDERR') => {
          const text = partialLines[level] + decoders[level].write(chunk);
          const rows = text.split(/\r?\n/);
          const partial = rows.pop() || '';
          partialLines[level] = partial.length > MAX_LINE_CHARS
            ? `[line truncated] ${partial.slice(-MAX_LINE_CHARS)}`
            : partial;
          for (const row of rows) queueLine(level, row);
        };

        proc.stdout?.on('data', (data: Buffer) => consumeChunk(data, 'STDOUT'));
        proc.stderr?.on('data', (data: Buffer) => consumeChunk(data, 'STDERR'));

        proc.on('error', () => {
          flushConsole();
          this.activeProcesses.delete(instanceId);
          recordLaunchSummary('failed');
          logger.error('launch', 'Minecraft process could not be started.');
          onStatus?.({ instanceId, state: 'error', message: 'Minecraft could not be started.' });
          reject(new Error('Minecraft could not be started. Check Java installation and instance files.'));
        });

        proc.on('close', (code, signal) => {
          for (const level of ['STDOUT', 'STDERR'] as const) {
            const remainder = partialLines[level] + decoders[level].end();
            if (remainder) queueLine(level, remainder);
          }
          flushConsole();
          const wasStopped = this.stoppingInstances.has(instanceId);
          this.activeProcesses.delete(instanceId);
          this.stoppingInstances.delete(instanceId);
          const stopTimeout = this.stopTimeouts.get(instanceId);
          if (stopTimeout) clearTimeout(stopTimeout);
          this.stopTimeouts.delete(instanceId);

          const durationSec = Math.round((Date.now() - startTime) / 1000);
          const exitCode = wasStopped ? 0 : code ?? 1;
          recordLaunchSummary(exitCode === 0 ? 'closed' : 'failed', durationSec, exitCode);
          logger.info('launch', `Minecraft process finished (${exitCode}) after ${durationSec}s.`);

          onStatus?.({
            instanceId,
            state: exitCode === 0 ? 'idle' : 'error',
            exitCode,
            message: wasStopped ? 'Minecraft stopped.' : signal ? 'Minecraft process ended unexpectedly.' : exitCode === 0 ? 'Minecraft closed.' : 'Minecraft exited unexpectedly.'
          });
          resolve(exitCode);
        });
      } catch {
        this.activeProcesses.delete(instanceId);
        recordLaunchSummary('failed');
        logger.error('launch', 'Minecraft process could not be created.');
        reject(new Error('Minecraft process could not be created. Check Java installation and instance files.'));
      }
    });
  }
}
