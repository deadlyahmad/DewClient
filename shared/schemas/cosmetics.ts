import type {
  EquippedCosmeticsSnapshot,
  DewCosmeticsModSessionRequest
} from '../types/cosmetics.ts';

export const DEW_COSMETICS_PROTOCOL_VERSION = 1;

const COSMETIC_TYPES = new Set(['skin', 'cape', 'wings', 'accessory', 'effect', 'other']);
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function validateEquippedCosmeticsSnapshot(value: unknown): {
  valid: boolean;
  error?: string;
  data?: EquippedCosmeticsSnapshot;
} {
  if (!isRecord(value) || !Number.isSafeInteger(value.revision) || Number(value.revision) < 0) {
    return { valid: false, error: 'Cosmetics revision must be a non-negative safe integer.' };
  }
  if (!Array.isArray(value.items) || value.items.length > 64) {
    return { valid: false, error: 'Equipped cosmetics must be an array of at most 64 items.' };
  }

  const seen = new Set<string>();
  for (const item of value.items) {
    if (!isRecord(item) || typeof item.cosmeticId !== 'string' || !ID_PATTERN.test(item.cosmeticId)) {
      return { valid: false, error: 'Each equipped cosmetic must have a valid cosmetic ID.' };
    }
    if (seen.has(item.cosmeticId)) {
      return { valid: false, error: 'Equipped cosmetic IDs must be unique.' };
    }
    if (!Number.isSafeInteger(item.assetVersion) || Number(item.assetVersion) < 1 || typeof item.enabled !== 'boolean') {
      return { valid: false, error: 'Each equipped cosmetic must have a positive asset version and enabled flag.' };
    }
    seen.add(item.cosmeticId);
  }

  return {
    valid: true,
    data: value as unknown as EquippedCosmeticsSnapshot
  };
}

export function validateDewCosmeticsModSessionRequest(value: unknown): {
  valid: boolean;
  error?: string;
  data?: DewCosmeticsModSessionRequest;
} {
  if (!isRecord(value)) return { valid: false, error: 'Mod session request must be an object.' };
  if (typeof value.instanceId !== 'string' || !ID_PATTERN.test(value.instanceId)) {
    return { valid: false, error: 'Instance ID is invalid.' };
  }
  if (typeof value.minecraftVersion !== 'string' || !/^[A-Za-z0-9.+_-]{1,32}$/.test(value.minecraftVersion)) {
    return { valid: false, error: 'Minecraft version is invalid.' };
  }
  if (typeof value.modVersion !== 'string' || !/^[A-Za-z0-9.+_-]{1,64}$/.test(value.modVersion)) {
    return { valid: false, error: 'Mod version is invalid.' };
  }
  if (value.protocolVersion !== DEW_COSMETICS_PROTOCOL_VERSION) {
    return { valid: false, error: 'DewCosmetics protocol version is unsupported.' };
  }
  if (value.loaderFamily !== 'fabric') {
    return { valid: false, error: 'Loader family is unsupported.' };
  }
  if (!Array.isArray(value.capabilities) || value.capabilities.length > COSMETIC_TYPES.size
    || value.capabilities.some((capability) => typeof capability !== 'string' || !COSMETIC_TYPES.has(capability))) {
    return { valid: false, error: 'Mod capabilities are invalid.' };
  }
  if (new Set(value.capabilities).size !== value.capabilities.length) {
    return { valid: false, error: 'Mod capabilities must be unique.' };
  }

  return { valid: true, data: value as unknown as DewCosmeticsModSessionRequest };
}