import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEW_COSMETICS_PROTOCOL_VERSION,
  validateDewCosmeticsModSessionRequest,
  validateEquippedCosmeticsSnapshot
} from '../index.ts';

test('DewCosmetics protocol accepts supported session metadata and snapshots', () => {
  assert.equal(DEW_COSMETICS_PROTOCOL_VERSION, 1);
  assert.equal(validateDewCosmeticsModSessionRequest({
    instanceId: 'instance-1',
    minecraftVersion: '26.3',
    modVersion: '0.3.0',
    protocolVersion: 1,
    loaderFamily: 'fabric',
    capabilities: ['skin', 'cape', 'wings']
  }).valid, true);
  assert.deepEqual(validateEquippedCosmeticsSnapshot({
    revision: 3,
    items: [{ cosmeticId: 'cape:dawn', assetVersion: 2, enabled: true }]
  }), {
    valid: true,
    data: { revision: 3, items: [{ cosmeticId: 'cape:dawn', assetVersion: 2, enabled: true }] }
  });
});

test('DewCosmetics protocol rejects stale-shaped, duplicate, and unsupported data', () => {
  assert.equal(validateDewCosmeticsModSessionRequest({
    instanceId: 'instance-1',
    minecraftVersion: '26.3',
    modVersion: '0.3.0',
    protocolVersion: 2,
    loaderFamily: 'fabric',
    capabilities: ['skin']
  }).valid, false);
  assert.equal(validateEquippedCosmeticsSnapshot({
    revision: -1,
    items: []
  }).valid, false);
  assert.equal(validateEquippedCosmeticsSnapshot({
    revision: 1,
    items: [
      { cosmeticId: 'cape:dawn', assetVersion: 1, enabled: true },
      { cosmeticId: 'cape:dawn', assetVersion: 2, enabled: true }
    ]
  }).valid, false);
});
