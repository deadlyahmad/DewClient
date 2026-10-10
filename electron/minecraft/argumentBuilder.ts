/**
 * DewClient - Launch Argument Builder
 * Formats JVM and Game command-line arguments according to official Mojang metadata specifications
 */

import path from 'node:path';
import type {
  MinecraftVersionPackage,
  LaunchConfiguration,
  ArgumentRule
} from '../../shared/types/minecraft.ts';
import { PRODUCT_NAME, PRODUCT_VERSION } from '../../shared/constants/versions.ts';
import { LibraryResolver } from './libraryResolver.ts';

export class ArgumentBuilder {
  private libraryResolver = new LibraryResolver();

  public parseCommandLineArgs(value: string): string[] {
    const args: string[] = [];
    let current = '';
    let quote: '"' | "'" | null = null;
    let escaped = false;

    for (const character of value) {
      if (escaped) {
        current += character;
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (quote) {
        if (character === quote) quote = null;
        else current += character;
      } else if (character === '"' || character === "'") {
        quote = character;
      } else if (/\s/.test(character)) {
        if (current) {
          args.push(current);
          current = '';
        }
      } else {
        current += character;
      }
    }

    if (escaped) current += '\\';
    if (current) args.push(current);
    return args;
  }

  public buildClasspath(launchConfig: LaunchConfiguration, clientJarPath: string): string {
    const separator = process.platform === 'win32' ? ';' : ':';
    const entries = [...launchConfig.classpath, clientJarPath];
    return entries.join(separator);
  }

  public evaluateArgumentRule(rule?: ArgumentRule, features: Record<string, boolean> = {}): boolean {
    if (!rule) return true;
    return this.libraryResolver.evaluateRules([rule], features);
  }

  public parseRuleBasedArguments(
    args: Array<string | { rules?: ArgumentRule[]; value: string | string[] }>,
    substitutions: Record<string, string>,
    features: Record<string, boolean> = {}
  ): string[] {
    const result: string[] = [];

    for (const item of args) {
      if (typeof item === 'string') {
        result.push(this.applySubstitutions(item, substitutions));
      } else if (item && typeof item === 'object') {
        const allowed = item.rules ? this.libraryResolver.evaluateRules(item.rules, features) : true;
        if (allowed) {
          if (Array.isArray(item.value)) {
            for (const val of item.value) {
              result.push(this.applySubstitutions(val, substitutions));
            }
          } else if (typeof item.value === 'string') {
            result.push(this.applySubstitutions(item.value, substitutions));
          }
        }
      }
    }

    return result;
  }

  public applySubstitutions(template: string, substitutions: Record<string, string>): string {
    return template.replace(/\$\{([a-zA-Z0-9_]+)\}/g, (_match, varName) => {
      return substitutions[varName] !== undefined ? substitutions[varName] : _match;
    });
  }

  public buildLaunchCommand(
    pkg: MinecraftVersionPackage,
    config: LaunchConfiguration,
    clientJarPath: string
  ): { command: string; args: string[]; safeArgsForLogs: string[] } {
    const classpathStr = this.buildClasspath(config, clientJarPath);
    const osName = this.libraryResolver.getPlatformOsName();
    const classpathSeparator = process.platform === 'win32' ? ';' : ':';
    const features: Record<string, boolean> = {
      has_custom_resolution: Boolean(config.resolutionWidth && config.resolutionHeight),
      has_quick_plays_support: Boolean(config.quickPlay),
      is_quick_play_singleplayer: config.quickPlay?.type === 'singleplayer',
      is_quick_play_multiplayer: config.quickPlay?.type === 'multiplayer',
      is_quick_play_realms: config.quickPlay?.type === 'realms',
      ...(config.features || {})
    };

    const substitutions: Record<string, string> = {
      auth_player_name: config.auth.username,
      version_name: pkg.id,
      game_directory: config.gameDirectory,
      assets_root: config.assetsDirectory,
      assets_index_name: pkg.assetIndex?.id || pkg.id,
      auth_uuid: config.auth.uuid.replace(/-/g, ''),
      auth_access_token: config.auth.accessToken,
      user_type: config.auth.userType || 'mojang',
      user_properties: JSON.stringify(config.auth.userProperties || {}),
      version_type: pkg.type || 'release',
      natives_directory: config.nativesDirectory,
      launcher_name: PRODUCT_NAME,
      launcher_version: PRODUCT_VERSION,
      classpath: classpathStr,
      classpath_separator: classpathSeparator,
      library_directory: path.dirname(config.nativesDirectory)
      ,resolution_width: String(config.resolutionWidth || 0)
      ,resolution_height: String(config.resolutionHeight || 0)
    };

    // 1. Build JVM Arguments
    const jvmArgs: string[] = [];

    // Use the single global memory value as the JVM heap cap and avoid duplicate incompatible heap settings.
    const memoryMb = config.memoryMb;
    jvmArgs.push(`-Xmx${memoryMb}M`);

    // Parse package JVM args if declared
    if (pkg.arguments?.jvm) {
      const parsedJvm = this.parseRuleBasedArguments(pkg.arguments.jvm, substitutions, features);
      jvmArgs.push(...parsedJvm);
    } else {
      // Standard fallback JVM flags for versions without arguments.jvm (legacy < 1.13)
      jvmArgs.push(`-Djava.library.path=${config.nativesDirectory}`);
      jvmArgs.push('-cp', classpathStr);
    }

    // Append custom JVM args from user config
    if (config.jvmArgs && config.jvmArgs.length > 0) {
      jvmArgs.push(...config.jvmArgs);
    }

    // Ensure -Djava.library.path is present and deduplicated exactly once
    const libraryPathIndices: number[] = [];
    for (let i = 0; i < jvmArgs.length; i++) {
      if (jvmArgs[i].startsWith('-Djava.library.path=')) {
        libraryPathIndices.push(i);
      }
    }

    if (libraryPathIndices.length === 0) {
      // If missing from both metadata and custom args, inject before -cp or append
      const cpIndex = jvmArgs.indexOf('-cp');
      if (cpIndex !== -1) {
        jvmArgs.splice(cpIndex, 0, `-Djava.library.path=${config.nativesDirectory}`);
      } else {
        jvmArgs.push(`-Djava.library.path=${config.nativesDirectory}`);
      }
    } else if (libraryPathIndices.length > 1) {
      // Deduplicate: retain only the last occurrence (JVM override semantics)
      const lastIndex = libraryPathIndices[libraryPathIndices.length - 1];
      const deduplicated = jvmArgs.filter((arg, idx) => {
        if (!arg.startsWith('-Djava.library.path=')) return true;
        return idx === lastIndex;
      });
      jvmArgs.length = 0;
      jvmArgs.push(...deduplicated);
    }

    // 2. Main Class
    const mainClass = pkg.mainClass;

    // 3. Build Game Arguments
    const gameArgs: string[] = [];

    if (pkg.arguments?.game) {
      const parsedGame = this.parseRuleBasedArguments(pkg.arguments.game, substitutions, features);
      gameArgs.push(...parsedGame);
    } else if (pkg.minecraftArguments) {
      // Legacy argument template parsing
      const parts = this.parseCommandLineArgs(pkg.minecraftArguments);
      for (const part of parts) {
        if (part) {
          gameArgs.push(this.applySubstitutions(part, substitutions));
        }
      }
    }

    // Quick Play options
    if (config.quickPlay) {
      if (config.quickPlay.type === 'singleplayer') {
        gameArgs.push('--quickPlaySingleplayer', config.quickPlay.target);
      } else if (config.quickPlay.type === 'multiplayer') {
        gameArgs.push('--quickPlayMultiplayer', config.quickPlay.target);
      } else if (config.quickPlay.type === 'realms') {
        gameArgs.push('--quickPlayRealms', config.quickPlay.target);
      }
    }

    // Append custom game args from user config
    if (config.gameArgs && config.gameArgs.length > 0) {
      gameArgs.push(...config.gameArgs);
    }

    if (config.resolutionWidth && config.resolutionHeight) {
      if (!gameArgs.includes('--width')) gameArgs.push('--width', String(config.resolutionWidth));
      if (!gameArgs.includes('--height')) gameArgs.push('--height', String(config.resolutionHeight));
    }
    if (config.fullscreen && !gameArgs.includes('--fullscreen')) {
      gameArgs.push('--fullscreen');
    }

    // Full argument list passed to Java process
    const fullArgs = [...jvmArgs, mainClass, ...gameArgs];

    // Build sanitized version for logs (redacts sensitive tokens)
    const safeArgsForLogs = fullArgs.map((arg, idx) => {
      const prev = fullArgs[idx - 1];
      if (prev === '--accessToken' || prev === '${auth_access_token}') {
        return '[REDACTED]';
      }
      if (arg.startsWith('-Dauth_access_token=')) {
        return '-Dauth_access_token=[REDACTED]';
      }
      if (arg === config.auth.accessToken && config.auth.accessToken.length > 10) {
        return '[REDACTED]';
      }
      return arg;
    });

    return {
      command: config.javaPath,
      args: fullArgs,
      safeArgsForLogs
    };
  }
}
