/**
 * DewClient Central Server - Cryptographic Service
 * Ed25519 signature verification & payload hashing using node:crypto
 */

import crypto from 'node:crypto';

const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

function parseEd25519PublicKey(publicKeyHex) {
  if (typeof publicKeyHex !== 'string' || !/^(?:[a-f0-9]{64}|[a-f0-9]{88})$/i.test(publicKeyHex)) {
    throw new Error('Invalid Ed25519 public key encoding.');
  }
  const encodedKey = Buffer.from(publicKeyHex, 'hex');
  const derKey = encodedKey.length === 32
    ? Buffer.concat([ED25519_SPKI_PREFIX, encodedKey])
    : encodedKey;
  return crypto.createPublicKey({ key: derKey, format: 'der', type: 'spki' });
}

export class CryptoService {
  static isFreshTimestamp(timestamp) {
    if (typeof timestamp !== 'string' || !/^\d{10,16}$/.test(timestamp)) return false;
    const parsed = Number(timestamp);
    return Number.isSafeInteger(parsed) && Math.abs(Date.now() - parsed) <= 5 * 60 * 1000;
  }

  /**
   * Generate a unique client identifier
   */
  static generateClientId() {
    return `client_${crypto.randomBytes(12).toString('hex')}`;
  }

  /**
   * Compute standard SHA-256 hex hash
   */
  static sha256(data) {
    return crypto.createHash('sha256').update(data).digest('hex');
  }

  /**
   * Validate that a string is a valid Ed25519 SPKI DER public key in hex
   */
  static isValidEd25519PublicKey(publicKeyHex) {
    try {
      parseEd25519PublicKey(publicKeyHex);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Verify an Ed25519 signature against a canonical payload string
   * Canonical payload: `${clientId}:${timestamp}:${bodyHash}`
   */
  static verifySignature(publicKeyHex, canonicalPayload, signatureHex) {
    if (!publicKeyHex || !canonicalPayload || !signatureHex) return false;
    try {
      const sigBuffer = Buffer.from(signatureHex, 'hex');
      const dataBuffer = Buffer.from(canonicalPayload, 'utf-8');
      return crypto.verify(null, dataBuffer, parseEd25519PublicKey(publicKeyHex), sigBuffer);
    } catch {
      return false;
    }
  }
}
