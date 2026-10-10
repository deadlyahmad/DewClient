/**
 * DewClient - Local Client Ed25519 Cryptographic Identity Service
 * Generates and stores device keypair securely; private key never leaves the device.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { PRODUCT_VERSION } from '../../shared/constants/versions.ts';
import type { ClientRegisterResponseDto } from '../../shared/dtos/clientRegister.dto.ts';
import { SecureStorageService } from '../storage/secureStorage.ts';
import { getPathManager } from '../storage/paths.ts';
import { getSettingsStorage } from '../storage/settingsStorage.ts';
import { getLogger } from '../core/logger.ts';
import { resolveRemoteServerBaseUrl } from '../../shared/constants/defaults.ts';

interface StoredIdentity {
  publicKeyHex: string;
  encryptedPrivateKey: string;
  clientId: string | null;
  registeredAt?: string;
}

export class ClientIdentityService {
  private pathManager = getPathManager();
  private identityFilePath: string;
  private identity: StoredIdentity | null = null;
  private privateKeyObj: crypto.KeyObject | null = null;

  constructor() {
    this.identityFilePath = this.pathManager.getIdentityKeyPath();
    this.loadOrCreateIdentity();
  }

  public getPublicKeyHex(): string {
    return this.identity?.publicKeyHex || '';
  }

  public getClientId(): string | null {
    return this.identity?.clientId || null;
  }

  public clearClientRegistration(): void {
    if (!this.identity) return;
    this.identity.clientId = null;
    this.identity.registeredAt = undefined;
    fs.writeFileSync(this.identityFilePath, JSON.stringify(this.identity, null, 2), 'utf-8');
  }

  public signPayload(canonicalPayload: string): string {
    if (!this.privateKeyObj) {
      this.loadOrCreateIdentity();
    }
    if (!this.privateKeyObj) {
      throw new Error('No local private key available for Ed25519 signing.');
    }
    const signature = crypto.sign(null, Buffer.from(canonicalPayload, 'utf-8'), this.privateKeyObj);
    return signature.toString('hex');
  }

  private loadOrCreateIdentity(): void {
    const logger = getLogger();

    if (fs.existsSync(this.identityFilePath)) {
      try {
        const raw = fs.readFileSync(this.identityFilePath, 'utf-8');
        const parsed = JSON.parse(raw) as StoredIdentity;
        const decryptedPrivHex = SecureStorageService.decrypt(parsed.encryptedPrivateKey);

        if (decryptedPrivHex && parsed.publicKeyHex) {
          const privKeyDer = Buffer.concat([
            Buffer.from('302e020100300506032b657004220420', 'hex'), // PKCS8 prefix for Ed25519
            Buffer.from(decryptedPrivHex, 'hex')
          ]);

          this.privateKeyObj = crypto.createPrivateKey({
            key: privKeyDer,
            format: 'der',
            type: 'pkcs8'
          });

          this.identity = parsed;
          return;
        }
      } catch (err: any) {
        logger.warn('remote', 'Could not read existing identity key, regenerating...', { error: err.message });
      }
    }

    // Generate new Ed25519 keypair
    logger.info('remote', 'Generating new local Ed25519 device keypair...');
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');

    const spkiDer = publicKey.export({ type: 'spki', format: 'der' });
    const rawPubBytes = spkiDer.subarray(spkiDer.length - 32);
    const pubHex = rawPubBytes.toString('hex');

    const pkcs8Der = privateKey.export({ type: 'pkcs8', format: 'der' });
    const rawPrivBytes = pkcs8Der.subarray(pkcs8Der.length - 32);
    const privHex = rawPrivBytes.toString('hex');

    const encryptedPriv = SecureStorageService.encrypt(privHex);

    this.privateKeyObj = privateKey;
    this.identity = {
      publicKeyHex: pubHex,
      encryptedPrivateKey: encryptedPriv,
      clientId: null,
      registeredAt: undefined
    };

    const dir = path.dirname(this.identityFilePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(this.identityFilePath, JSON.stringify(this.identity, null, 2), 'utf-8');
  }

  /**
   * Registers this client's public key with the central management backend
   */
  public async registerWithServer(serverUrl?: string): Promise<string> {
    const logger = getLogger();
    const settings = getSettingsStorage().getSettings();
    const primaryUrl = resolveRemoteServerBaseUrl(serverUrl || settings.remote?.serverUrl, { allowLocalhostInTests: process.env.NODE_ENV === 'test' });
    const candidateUrls = [primaryUrl];

    const payload = {
      publicKey: this.getPublicKeyHex(),
      clientVersion: PRODUCT_VERSION,
      os: os.type(),
      osVersion: os.release(),
      architecture: os.arch(),
      hostname: os.hostname()
    };

    let lastError: Error = new Error('No candidate server URLs reachable.');

    for (const baseUrl of candidateUrls) {
      try {
        logger.debug('remote', `Attempting client identity registration with server at ${baseUrl}...`);
        const registerUrl = `${baseUrl.replace(/\/+$/, '')}/client/register`;
        const res = await fetch(registerUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(5000)
        });

        if (!res.ok) {
          throw new Error(`Server registration failed (${res.status}): ${res.statusText}`);
        }

        const data = (await res.json()) as ClientRegisterResponseDto;
        const clientId = data.data?.clientId;
        if (!clientId) {
          throw new Error('Server returned registration success without a client ID.');
        }

        if (this.identity) {
          this.identity.clientId = clientId;
          this.identity.registeredAt = new Date().toISOString();
          fs.writeFileSync(this.identityFilePath, JSON.stringify(this.identity, null, 2), 'utf-8');
        }

        logger.info('remote', `Client registered successfully with ID: ${clientId} via ${baseUrl}`);
        return clientId;
      } catch (err: any) {
        lastError = err;
        logger.debug('remote', `Registration attempt to ${baseUrl} failed: ${err.message}`);
      }
    }

    throw lastError;
  }
}

let clientIdentityService: ClientIdentityService | null = null;

export function getClientIdentityService(): ClientIdentityService {
  const expectedPath = getPathManager().getIdentityKeyPath();
  if (!clientIdentityService || (clientIdentityService as any).identityFilePath !== expectedPath) {
    clientIdentityService = new ClientIdentityService();
  }
  return clientIdentityService;
}
