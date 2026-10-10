import net from 'node:net';
import { DEFAULT_SETTINGS } from '../../shared/constants/defaults.ts';
import { getLogger } from '../core/logger.ts';
import { getSettingsStorage } from '../storage/settingsStorage.ts';

interface DiscordActivity {
  details: string;
  state?: string;
  assets?: {
    large_image?: string;
    large_text?: string;
  };
}

interface DiscordCommand {
  cmd: 'SET_ACTIVITY';
  args: {
    pid: number;
    activity: DiscordActivity | null;
  };
  nonce: string;
}

export type RichPresenceState = 'launcher' | 'minecraft';

export interface RichPresenceTransport {
  connect(): Promise<void>;
  send(command: DiscordCommand): Promise<void>;
  close(): void;
}

class DiscordIpcTransport implements RichPresenceTransport {
  private readonly clientId: string;
  private socket: net.Socket | null = null;
  private buffer = Buffer.alloc(0);
  private pending: Array<{ resolve: () => void; reject: (error: Error) => void }> = [];

  constructor(clientId: string) {
    this.clientId = clientId;
  }

  public connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const pipeNames = Array.from({ length: 10 }, (_, index) => `\\\\?\\pipe\\discord-ipc-${index}`);
      const attempt = (index: number) => {
        if (index >= pipeNames.length) {
          reject(new Error('Discord IPC pipe was not found.'));
          return;
        }

        const socket = net.createConnection(pipeNames[index]);
        const fail = () => {
          socket.destroy();
          attempt(index + 1);
        };
        socket.once('error', fail);
        socket.once('connect', () => {
          socket.removeListener('error', fail);
          this.socket = socket;
          socket.on('data', (chunk) => this.handleData(chunk));
          socket.on('close', () => {
            this.socket = null;
            this.rejectPending(new Error('Discord IPC connection closed.'));
          });
          this.sendRaw(0, { v: 1, client_id: this.clientId }).then(resolve, reject);
        });
      };
      attempt(0);
    });
  }

  public send(command: DiscordCommand): Promise<void> {
    return this.sendRaw(1, command);
  }

  public close(): void {
    this.socket?.destroy();
    this.socket = null;
    this.rejectPending(new Error('Discord IPC connection closed.'));
  }

  private sendRaw(opcode: number, payload: unknown): Promise<void> {
    if (!this.socket) return Promise.reject(new Error('Discord IPC is not connected.'));
    const body = Buffer.from(JSON.stringify(payload), 'utf8');
    const frame = Buffer.alloc(8 + body.length);
    frame.writeInt32LE(opcode, 0);
    frame.writeInt32LE(body.length, 4);
    body.copy(frame, 8);

    return new Promise((resolve, reject) => {
      this.pending.push({ resolve, reject });
      this.socket?.write(frame, (error) => {
        if (error) reject(error);
      });
    });
  }

  private handleData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 8) {
      const length = this.buffer.readInt32LE(4);
      if (this.buffer.length < 8 + length) return;
      this.buffer = this.buffer.subarray(8 + length);
      this.pending.shift()?.resolve();
    }
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.splice(0)) pending.reject(error);
  }
}

export class RichPresenceService {
  private readonly fallbackClientId: string;
  private readonly createTransport: () => RichPresenceTransport;
  private transport: RichPresenceTransport | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private stopped = false;
  private state: RichPresenceState = 'launcher';
  private minecraftVersion: string | null = null;

  constructor(clientId = process.env.DEWCLIENT_DISCORD_CLIENT_ID?.trim() || '', createTransport?: () => RichPresenceTransport) {
    this.fallbackClientId = clientId;
    this.createTransport = createTransport || (() => new DiscordIpcTransport(this.getClientId()));
  }

  public start(): void {
    this.stopped = false;
    if (!this.isEnabled()) return;
    this.connect().catch(() => {});
  }

  public refreshConfiguration(): void {
    this.stop();
    this.start();
  }

  public stop(): void {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.transport?.close();
    this.transport = null;
  }

  public setLauncherState(): void {
    this.state = 'launcher';
    this.minecraftVersion = null;
    this.publish().catch(() => {});
  }

  public setMinecraftState(version: string): void {
    if (!version || !version.trim()) return;
    this.state = 'minecraft';
    this.minecraftVersion = version.trim();
    this.publish().catch(() => {});
  }

  public getState(): { state: RichPresenceState; minecraftVersion: string | null } {
    return { state: this.state, minecraftVersion: this.minecraftVersion };
  }

  private async connect(): Promise<void> {
    if (this.stopped || !this.isEnabled() || !this.getClientId() || this.transport) return;
    const transport = this.createTransport();
    try {
      await transport.connect();
      this.transport = transport;
      await this.publish();
    } catch (error: any) {
      transport.close();
      if (!this.stopped) {
        getLogger().debug('presence', `Discord Rich Presence unavailable: ${error.message}`);
        this.scheduleReconnect();
      }
    }
  }

  private async publish(): Promise<void> {
    if (!this.transport) {
      this.scheduleReconnect();
      return;
    }

    const activity: DiscordActivity = {
      details: 'Playing DewClient',
      ...(this.state === 'minecraft' && this.minecraftVersion ? { state: this.minecraftVersion } : {}),
      assets: {
        large_image: 'dewclient',
        large_text: 'DewClient'
      }
    };

    try {
      await this.transport.send({
        cmd: 'SET_ACTIVITY',
        args: { pid: process.pid, activity },
        nonce: `${Date.now()}-${Math.random()}`
      });
    } catch {
      this.transport.close();
      this.transport = null;
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer || !this.isEnabled() || !this.getClientId()) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect().catch(() => {});
    }, 10_000);
  }

  private isEnabled(): boolean {
    return getSettingsStorage().getSettings().launcher.richPresenceEnabled !== false;
  }

  private getClientId(): string {
    return DEFAULT_SETTINGS.launcher.discordClientId;
  }
}

let richPresenceService: RichPresenceService | null = null;

export function getRichPresenceService(): RichPresenceService {
  if (!richPresenceService) richPresenceService = new RichPresenceService();
  return richPresenceService;
}
