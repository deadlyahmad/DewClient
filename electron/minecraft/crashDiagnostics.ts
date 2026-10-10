/**
 * DewClient - Crash Diagnostics & Root Cause Analysis
 */

import fs from 'node:fs';
import path from 'node:path';

export interface CrashDiagnosticResult {
  title: string;
  message: string;
  details?: string;
  actionLabel?: string;
  actionRoute?: string;
}

export class CrashDiagnostics {
  public static analyzeCrash(gameDirectory: string, exitCode?: number): CrashDiagnosticResult {
    let logContent = '';

    // Check crash-reports/ folder first
    const crashReportsDir = path.join(gameDirectory, 'crash-reports');
    if (fs.existsSync(crashReportsDir)) {
      try {
        const files = fs.readdirSync(crashReportsDir).filter((f) => f.startsWith('crash-') && f.endsWith('.txt'));
        if (files.length > 0) {
          files.sort((a, b) => {
            return fs.statSync(path.join(crashReportsDir, b)).mtimeMs - fs.statSync(path.join(crashReportsDir, a)).mtimeMs;
          });
          logContent = fs.readFileSync(path.join(crashReportsDir, files[0]), 'utf-8');
        }
      } catch {
        // Fall back to latest.log
      }
    }

    // Check latest.log
    if (!logContent) {
      const latestLog = path.join(gameDirectory, 'logs', 'latest.log');
      if (fs.existsSync(latestLog)) {
        try {
          const stats = fs.statSync(latestLog);
          // Read up to last 100KB
          const readBytes = Math.min(stats.size, 100 * 1024);
          const buf = Buffer.alloc(readBytes);
          const fd = fs.openSync(latestLog, 'r');
          fs.readSync(fd, buf, 0, readBytes, Math.max(0, stats.size - readBytes));
          fs.closeSync(fd);
          logContent = buf.toString('utf-8');
        } catch {
          // Ignore
        }
      }
    }

    // 1. Out of memory
    if (logContent.includes('java.lang.OutOfMemoryError') || logContent.includes('Java heap space')) {
      return {
        title: 'Out of Memory',
        message: 'Minecraft ran out of memory. Try increasing the maximum RAM allocated in Instance Settings.',
        details: 'Java threw OutOfMemoryError: Java heap space.',
        actionLabel: 'Adjust RAM Settings',
        actionRoute: '/settings'
      };
    }

    // 2. Incompatible Java version
    if (logContent.includes('UnsupportedClassVersionError') || logContent.includes('has been compiled by a more recent version of the Java Runtime')) {
      return {
        title: 'Incompatible Java Runtime',
        message: 'The game version requires a newer version of Java than the selected runtime.',
        details: 'UnsupportedClassVersionError detected.',
        actionLabel: 'Detect Java Runtimes',
        actionRoute: '/settings'
      };
    }

    // 3. Graphics / OpenGL / Driver issue
    if (
      logContent.includes('Pixel format not accelerated') ||
      logContent.includes('WGL: The driver does not appear to support OpenGL') ||
      logContent.includes('GLFW error 65542') ||
      logContent.includes('org.lwjgl.LWJGLException: Could not create context')
    ) {
      return {
        title: 'Graphics Driver Error',
        message: 'Your graphics card or driver does not support the required OpenGL context. Please update your GPU drivers.',
        details: 'OpenGL context creation failed.',
        actionLabel: 'Open Game Logs',
        actionRoute: '/logs'
      };
    }

    // 4. Mod conflict / Fabric error
    if (logContent.includes('net.fabricmc.loader.impl.FormattedException') || logContent.includes('DuplicateModsException')) {
      return {
        title: 'Mod Loader Conflict',
        message: 'A mod conflict or missing dependency was detected in your mods folder.',
        details: 'Fabric Loader encountered an unrecoverable mod exception.',
        actionLabel: 'Manage Mods',
        actionRoute: '/mods'
      };
    }

    // 5. Native library error
    if (logContent.includes('UnsatisfiedLinkError') || logContent.includes('Failed to load native library')) {
      return {
        title: 'Corrupted Native Libraries',
        message: 'A native library failed to load. Try repairing the instance to re-download official libraries.',
        details: 'UnsatisfiedLinkError detected.',
        actionLabel: 'Repair Instance',
        actionRoute: '/instances'
      };
    }

    // Generic crash
    return {
      title: 'Game Crashed',
      message: `Minecraft exited unexpectedly with code ${exitCode !== undefined ? exitCode : 'unknown'}. Check the latest game logs for details.`,
      actionLabel: 'View Game Logs',
      actionRoute: '/logs'
    };
  }
}
