import React, { useEffect, useRef, useState } from 'react';
import { Check, Cloud, RotateCw, Shirt, Sparkles, Upload, Wind } from 'lucide-react';
import { SkinViewer } from 'skinview3d';
import type { LocalCosmeticTexture, UserAccount } from '../../shared/types/account.ts';
import { getUserFacingErrorMessage } from '../utils/userFacingError.ts';

type CosmeticSlot = 'skin' | 'cape' | 'elytra';

interface CosmeticsViewProps {
  activeAccount: UserAccount | null;
  onUpdateAccount: (id: string, partial: any) => Promise<void>;
  onClaimCape: (assetId: string) => void;
}

type FreeCapeItem = { assetId: string; sha256: string; name: string; kind: 'cape'; width: number | null; height: number | null; byteSize: number; createdAt: string; claimed: boolean };

const slotLabels: Record<CosmeticSlot, string> = { skin: 'Skin', cape: 'Cape', elytra: 'Wings' };
const slotIcons = { skin: Shirt, cape: Sparkles, elytra: Wind };

const CosmeticSlotTexture: React.FC<{
  accountId: string;
  kind: CosmeticSlot;
  assetId?: string;
  assetPath?: string;
  freeCape?: { assetId: string; sha256: string };
  label: string;
}> = ({ accountId, kind, assetId, assetPath, freeCape, label }) => {
  const previewRef = useRef<HTMLSpanElement | null>(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [renderedPreviewUrl, setRenderedPreviewUrl] = useState('');

  useEffect(() => {
    const previewElement = previewRef.current;
    if (!previewElement || (!assetId && !assetPath && !freeCape)) return;
    let cancelled = false;
    let started = false;
    const loadPreview = () => {
      if (started) return;
      started = true;
      const request = freeCape
        ? window.dewclient.auth.getFreeCapePreview(accountId, freeCape.assetId, freeCape.sha256)
        : assetId
        ? window.dewclient.auth.getAssignedCosmeticPreview(accountId, kind, assetId)
        : window.dewclient.auth.getCosmeticPreview(accountId, assetPath!, kind);
      void request.then((url) => {
        if (!cancelled) setPreviewUrl(url);
      }).catch(() => undefined);
    };

    if (typeof IntersectionObserver === 'undefined') {
      loadPreview();
    } else {
      const observer = new IntersectionObserver((entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          observer.disconnect();
          loadPreview();
        }
      }, { rootMargin: '80px' });
      observer.observe(previewElement);
      return () => {
        cancelled = true;
        observer.disconnect();
      };
    }

    return () => { cancelled = true; };
  }, [accountId, assetId, assetPath, freeCape?.assetId, freeCape?.sha256, kind]);

  useEffect(() => {
    if (!previewUrl) {
      setRenderedPreviewUrl('');
      return;
    }
    let cancelled = false;
    void renderCosmeticSlotPreview(previewUrl, kind, () => cancelled).then((url) => {
      if (!cancelled && url) setRenderedPreviewUrl(url);
    }).catch(() => {
      // Keep the original texture as a safe fallback when WebGL is unavailable.
      if (!cancelled) setRenderedPreviewUrl(previewUrl);
    });
    return () => { cancelled = true; };
  }, [previewUrl, kind]);

  return (
    <span ref={previewRef} className={`cosmetic-slot-preview cosmetic-slot-preview-${kind}`} aria-label={`${label} texture preview`}>
      {renderedPreviewUrl
        ? <img src={renderedPreviewUrl} alt="" loading="lazy" />
        : kind === 'skin' ? <Shirt size={15} /> : kind === 'cape' ? <Sparkles size={15} /> : <Wind size={15} />}
    </span>
  );
};

function createDefaultPlayerSkin(): HTMLCanvasElement {
  const skin = document.createElement('canvas');
  skin.width = 64;
  skin.height = 64;
  const context = skin.getContext('2d');
  if (!context) return skin;

  const fill = (x: number, y: number, width: number, height: number, color: string) => {
    context.fillStyle = color;
    context.fillRect(x, y, width, height);
  };
  const skinTone = '#c99063';
  const hair = '#49301f';
  const shirt = '#3478a8';
  const shirtShade = '#245a84';
  const pants = '#354a86';
  const boots = '#282d3a';

  fill(0, 8, 32, 8, skinTone);
  fill(8, 0, 8, 8, hair);
  fill(16, 0, 8, 8, skinTone);
  fill(0, 8, 8, 3, hair);
  fill(8, 8, 8, 2, hair);
  fill(16, 8, 8, 3, hair);
  fill(24, 8, 8, 3, hair);
  fill(8, 10, 8, 6, skinTone);
  fill(10, 11, 1, 1, '#26384a');
  fill(13, 11, 1, 1, '#26384a');
  fill(11, 14, 2, 1, '#704331');

  fill(16, 16, 24, 16, shirt);
  fill(16, 20, 4, 12, shirtShade);
  fill(28, 20, 4, 12, shirtShade);
  fill(32, 20, 8, 12, shirtShade);
  fill(20, 16, 8, 4, '#4a8db7');

  fill(40, 16, 16, 16, skinTone);
  fill(40, 20, 16, 5, shirt);
  fill(40, 20, 4, 5, shirtShade);
  fill(48, 20, 4, 5, shirtShade);
  fill(52, 20, 4, 5, shirtShade);

  fill(0, 16, 16, 16, pants);
  fill(0, 20, 4, 12, '#293b72');
  fill(8, 20, 4, 12, '#293b72');
  fill(12, 20, 4, 12, '#293b72');
  fill(0, 29, 16, 3, boots);

  fill(16, 48, 16, 16, pants);
  fill(20, 52, 4, 12, '#293b72');
  fill(28, 52, 4, 12, '#293b72');
  fill(16, 61, 16, 3, boots);

  fill(32, 48, 16, 16, skinTone);
  fill(32, 52, 16, 5, shirt);
  fill(32, 52, 4, 5, shirtShade);
  fill(40, 52, 4, 5, shirtShade);
  fill(44, 52, 4, 5, shirtShade);
  return skin;
}

let cosmeticPreviewQueue: Promise<void> = Promise.resolve();

function renderCosmeticSlotPreview(source: string, kind: CosmeticSlot, isCancelled: () => boolean): Promise<string> {
  const render = cosmeticPreviewQueue.then(async () => {
    if (isCancelled()) return '';
    const canvas = document.createElement('canvas');
    let viewer: SkinViewer | null = null;
    try {
      viewer = new SkinViewer({
        canvas,
        width: 96,
        height: 80,
        pixelRatio: 1,
        zoom: 0.66,
        enableControls: false,
        renderPaused: true,
        preserveDrawingBuffer: true,
        background: 'rgba(0,0,0,0)'
      });
      viewer.playerWrapper.rotation.y = kind === 'skin' ? 0 : Math.PI;
      await viewer.loadSkin(kind === 'skin' ? source : createDefaultPlayerSkin().toDataURL('image/png'));
      if (kind !== 'skin') await viewer.loadCape(source, { backEquipment: kind === 'elytra' ? 'elytra' : 'cape' });
      if (isCancelled()) return '';
      viewer.render();
      return canvas.toDataURL('image/png');
    } finally {
      viewer?.dispose();
    }
  });
  cosmeticPreviewQueue = render.then(() => undefined, () => undefined);
  return render;
}

const MinecraftPlayerPreview: React.FC<{
  username: string;
  skinUrl: string | null;
  backUrl: string | null;
  backEquipment: 'cape' | 'elytra' | null;
  autoRotate: boolean;
}> = ({ username, skinUrl, backUrl, backEquipment, autoRotate }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const viewerRef = useRef<SkinViewer | null>(null);
  const [previewError, setPreviewError] = useState('');

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let viewer: SkinViewer;
    try {
      const initialBounds = canvas.parentElement?.getBoundingClientRect();
      viewer = new SkinViewer({
        canvas,
        width: Math.max(1, initialBounds?.width || canvas.clientWidth),
        height: Math.max(1, initialBounds?.height || canvas.clientHeight),
        pixelRatio: 'match-device',
        preserveDrawingBuffer: true,
        enableControls: true,
        zoom: 0.72,
        nameTag: username
      });
      viewer.controls.enableRotate = true;
      viewer.controls.enableZoom = false;
      viewer.controls.enablePan = false;
      viewer.autoRotate = autoRotate;
      canvas.style.width = '100%';
      canvas.style.height = '100%';
    } catch {
      setPreviewError('3D preview is unavailable on this device.');
      return;
    }

    viewerRef.current = viewer;
    const resizeObserver = new ResizeObserver(() => {
      const bounds = canvas.getBoundingClientRect();
      viewer.setSize(Math.max(1, bounds.width), Math.max(1, bounds.height));
      canvas.style.width = '100%';
      canvas.style.height = '100%';
    });
    if (canvas.parentElement) resizeObserver.observe(canvas.parentElement);

    if (skinUrl) {
      void viewer.loadSkin(skinUrl).catch(() => setPreviewError('Could not load this skin. Showing the default player skin.'));
    } else {
      void viewer.loadSkin(createDefaultPlayerSkin().toDataURL('image/png'), { model: 'default' });
    }
    if (backUrl && backEquipment) {
      void viewer.loadCape(backUrl, { backEquipment }).catch(() => setPreviewError(`${slotLabels[backEquipment === 'cape' ? 'cape' : 'elytra']} texture could not be loaded.`));
    }
    setPreviewError('');

    return () => {
      resizeObserver.disconnect();
      viewer.dispose();
      viewerRef.current = null;
    };
  }, [username, skinUrl, backUrl, backEquipment]);

  useEffect(() => {
    if (viewerRef.current) viewerRef.current.autoRotate = autoRotate;
  }, [autoRotate]);

  return (
    <div className="cosmetics-studio-preview">
      <span className="cosmetics-studio-preview-label">Player Preview</span>
      <canvas ref={canvasRef} aria-label={`${username} Minecraft player model`} />
      {previewError && <span className="cosmetics-studio-error">{previewError}</span>}
    </div>
  );
};

export const CosmeticsView: React.FC<CosmeticsViewProps> = ({ activeAccount, onUpdateAccount, onClaimCape }) => {
  const [cosmetics, setCosmetics] = useState<any>(null);
  const [freeCapes, setFreeCapes] = useState<FreeCapeItem[]>([]);
  const [freeCapesError, setFreeCapesError] = useState('');
  const [discordLinked, setDiscordLinked] = useState(false);
  const [microsoftCapes, setMicrosoftCapes] = useState<LocalCosmeticTexture[]>(activeAccount?.cosmetics?.officialCapes || []);
  const [selectedSlot, setSelectedSlot] = useState<CosmeticSlot>('skin');
  const [selectedSkinSlot, setSelectedSkinSlot] = useState(0);
  const [selectedOfficialCapeId, setSelectedOfficialCapeId] = useState<string | null>(null);
  const [selectedCapeAssetId, setSelectedCapeAssetId] = useState<string | null | undefined>(undefined);
  const [selectedAdminAssetIds, setSelectedAdminAssetIds] = useState<Partial<Record<CosmeticSlot, string>>>({});
  const [loadingAssignedAssetId, setLoadingAssignedAssetId] = useState<string | null>(null);
  const [claimingCapeAssetId, setClaimingCapeAssetId] = useState<string | null>(null);
  const [equippingCapeAssetId, setEquippingCapeAssetId] = useState<string | null>(null);
  const [previewOverrides, setPreviewOverrides] = useState<Partial<Record<CosmeticSlot, string | null>>>({});
  const [autoRotate, setAutoRotate] = useState(true);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const refreshCosmetics = async (isCurrent: () => boolean = () => true) => {
    if (!activeAccount) return;
    setRefreshing(true);
    setError('');
    try {
      const [result, capeAccount] = await Promise.all([
        window.dewclient.auth.getCosmetics().catch(() => null),
        activeAccount?.type === 'microsoft'
          ? window.dewclient.auth.refreshOfficialCapes(activeAccount.id).catch(() => null)
          : Promise.resolve(null)
      ]);
      if (isCurrent()) {
        if (result?.accountId === activeAccount.id) {
          setCosmetics(result);
          setSelectedAdminAssetIds({
            ...(result.manifest?.metadata?.activeAdminCosmetics || {}),
            ...(activeAccount.cosmetics?.activeAdminCosmetics || {})
          });
          const metadata = result.manifest?.metadata || {};
          const explicitlySelected = Object.prototype.hasOwnProperty.call(metadata, 'activeCapeAssetId');
          setSelectedCapeAssetId(explicitlySelected
            ? (typeof metadata.activeCapeAssetId === 'string' ? metadata.activeCapeAssetId.toLowerCase() : null)
            : (typeof result.manifest?.cape?.assetId === 'string' ? result.manifest.cape.assetId.toLowerCase() : null));
        }
        if (activeAccount.type === 'microsoft') {
          setMicrosoftCapes(capeAccount?.cosmetics?.officialCapes || activeAccount.cosmetics?.officialCapes || []);
        } else {
          setMicrosoftCapes([]);
        }
      }
    } catch (refreshError: any) {
      if (isCurrent()) setError(getUserFacingErrorMessage(refreshError, 'Could not load player cosmetics.'));
    } finally {
      if (isCurrent()) setRefreshing(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    setCosmetics(null);
    setMicrosoftCapes(activeAccount?.cosmetics?.officialCapes || []);
    setPreviewOverrides({});
    setSelectedAdminAssetIds({});
    setSelectedCapeAssetId(undefined);
    setLoadingAssignedAssetId(null);
    setClaimingCapeAssetId(null);
    setEquippingCapeAssetId(null);
    setDiscordLinked(false);
    setError('');
    setMessage('');
    setFreeCapesError('');
    if (!activeAccount) return () => { cancelled = true; };

    void refreshCosmetics(() => !cancelled);
    const canClaimWithAccount = activeAccount.type === 'microsoft' || activeAccount.type === 'discord';
    const loadFreeCapeCatalog = () => window.dewclient.auth.getFreeCapes(canClaimWithAccount ? activeAccount.id : undefined);
    void loadFreeCapeCatalog().then((result) => {
      if (!cancelled) {
        setFreeCapes(Array.isArray(result?.items) ? result.items : []);
        setDiscordLinked(result?.discordLinked === true);
        if (canClaimWithAccount && !result?.identityRequired) {
          const selected = typeof result?.selectedCapeAssetId === 'string' ? result.selectedCapeAssetId.toLowerCase() : null;
          setSelectedCapeAssetId(selected);
          const adminCapeActive = (cosmetics?.manifest?.metadata?.adminAssignedKinds || []).includes('cape');
          const nextCapeSource = selected
            ? (adminCapeActive ? 'admin' : 'dew')
            : activeAccount.cosmetics?.activeCapeSource || (activeAccount.cosmetics?.activeOfficialCapeId ? 'microsoft' : undefined);
          const nextCapeAssetId = selected || null;
          if (nextCapeSource && (activeAccount.cosmetics?.activeCapeSource !== nextCapeSource || activeAccount.cosmetics?.activeCapeAssetId !== nextCapeAssetId)) {
            void onUpdateAccount(activeAccount.id, {
              cosmetics: { ...activeAccount.cosmetics, activeCapeSource: nextCapeSource, activeCapeAssetId: nextCapeAssetId }
            }).catch(() => {});
          }
          const selectedCape = (result.items || []).find((cape: FreeCapeItem) => cape.assetId.toLowerCase() === selected);
          if (selectedCape) {
            void window.dewclient.auth.getFreeCapePreview(activeAccount.id, selectedCape.assetId, selectedCape.sha256)
              .then((previewUrl) => { if (!cancelled) setPreviewOverrides((current) => ({ ...current, cape: previewUrl })); })
              .catch(() => {});
          }
        }
      }
    }).catch((loadError: any) => {
      if (!cancelled) setFreeCapesError(getUserFacingErrorMessage(loadError, 'Free capes could not be loaded.'));
    });
    const unsubscribe = window.dewclient.auth.onCosmeticsSync((status) => {
      if (status?.accountId === activeAccount.id) {
        void refreshCosmetics(() => !cancelled);
      }
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [activeAccount?.id]);

  useEffect(() => {
    if (!activeAccount) return;
    let cancelled = false;
    const slot = Math.max(0, Math.min(3, activeAccount.cosmetics?.activeSkinSlot || 0));
    const savedSkin = activeAccount.cosmetics?.skinSlots?.find((entry) => entry.id === `skin-${slot + 1}`)
      || (slot === 0 && activeAccount.cosmetics?.skinSource === 'custom' && activeAccount.skinAssetPath
        ? { assetPath: activeAccount.skinAssetPath }
        : null);
    const capeSource = activeAccount.cosmetics?.activeCapeSource;
    const activeCape = capeSource === 'dew' || capeSource === 'admin'
      ? null
      : activeAccount.cosmetics?.officialCapes?.find((cape) => cape.id === activeAccount.cosmetics?.activeOfficialCapeId)
        || activeAccount.cosmetics?.officialCapes?.find((cape) => cape.active)
        || activeAccount.cosmetics?.officialCapes?.[0];
    setSelectedSkinSlot(slot);
    setSelectedOfficialCapeId(activeCape?.id || null);
    setPreviewOverrides({});
    if (savedSkin?.assetPath) {
      void window.dewclient.auth.getCosmeticPreview(activeAccount.id, savedSkin.assetPath, 'skin')
        .then((previewUrl) => {
          if (!cancelled) setPreviewOverrides((current) => ({ ...current, skin: previewUrl }));
        })
        .catch(() => {});
    }
    if (activeCape?.assetPath) {
      void window.dewclient.auth.getCosmeticPreview(activeAccount.id, activeCape.assetPath, 'cape')
        .then((previewUrl) => {
          if (!cancelled) setPreviewOverrides((current) => ({ ...current, cape: previewUrl }));
        })
        .catch(() => {});
    }
    return () => { cancelled = true; };
  }, [activeAccount?.id]);

  const uploadSelected = async () => {
    if (!activeAccount) return;
    if (selectedSlot !== 'skin') {
      setError('Only custom skin uploads are available to players. Capes and elytra textures are assigned by DewClient administrators.');
      return;
    }
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const selected = await window.dewclient.auth.pickCosmetic(activeAccount.id, 'skin', selectedSkinSlot);
      if (!selected) return;
      const previewUrl = await window.dewclient.auth.getCosmeticPreview(activeAccount.id, selected.path, 'skin');
      const nextSkinSlots = Array.from({ length: 4 }, (_, slot) => activeAccount.cosmetics?.skinSlots?.find((entry) => entry.id === `skin-${slot + 1}`) || null);
      nextSkinSlots[selectedSkinSlot] = {
        id: `skin-${selectedSkinSlot + 1}`,
        name: `Skin ${selectedSkinSlot + 1}`,
        assetPath: selected.path,
        previewUrl: ''
      };
      await onUpdateAccount(activeAccount.id, {
        skinAssetPath: selected.path,
        cosmetics: {
          ...activeAccount.cosmetics,
          skinSlots: nextSkinSlots.filter(Boolean),
          activeSkinSlot: selectedSkinSlot,
          skinAssetPath: selected.path,
          skinSource: 'custom'
        }
      });
      setPreviewOverrides((current) => ({ ...current, [selectedSlot]: previewUrl }));
      setMessage(`Skin saved to slot ${selectedSkinSlot + 1}.`);
    } catch (uploadError: any) {
      setError(getUserFacingErrorMessage(uploadError, `Could not save the ${slotLabels[selectedSlot].toLowerCase()}.`));
    } finally {
      setSaving(false);
    }
  };

  if (!activeAccount) {
    return <div className="cosmetics-studio-empty"><Sparkles size={28} /><strong>Select a player account to view cosmetics.</strong></div>;
  }

  const savedSkinSlots = Array.from({ length: 4 }, (_, slot) => {
    const saved = activeAccount.cosmetics?.skinSlots?.find((entry) => entry.id === `skin-${slot + 1}`);
    if (saved) return saved;
    if (slot === 0 && activeAccount.cosmetics?.skinSource === 'custom' && activeAccount.skinAssetPath) {
      return { id: 'skin-1', name: 'Skin 1', assetPath: activeAccount.skinAssetPath, previewUrl: '' };
    }
    return null;
  });
  const officialCapes = activeAccount.type === 'microsoft' ? microsoftCapes : [];
  const accountCanClaim = activeAccount.type === 'microsoft' || activeAccount.type === 'discord';
  const assignedCosmetics = (kind: CosmeticSlot) => {
    const manifest = cosmetics?.manifest;
    const collectionKey = kind === 'skin' ? 'skins' : kind === 'cape' ? 'capes' : 'elytras';
    const collection = manifest?.metadata?.[collectionKey];
    const items = Array.isArray(collection) ? collection : [manifest?.[kind]];
    const unique = new Map<string, any>();
    for (const item of items) {
      if (item?.enabled === true && typeof item.assetId === 'string' && typeof item.sha256 === 'string') unique.set(item.assetId, item);
    }
    return [...unique.values()];
  };
  const selectSkinSlot = async (slot: number) => {
    setSelectedSkinSlot(slot);
    const skin = savedSkinSlots[slot];
    if (!skin) {
      setPreviewOverrides((current) => ({ ...current, skin: null }));
      return;
    }
    try {
      const previewUrl = await window.dewclient.auth.getCosmeticPreview(activeAccount.id, skin.assetPath, 'skin');
      setPreviewOverrides((current) => ({ ...current, skin: previewUrl }));
      await onUpdateAccount(activeAccount.id, {
        skinAssetPath: skin.assetPath,
        cosmetics: {
          ...activeAccount.cosmetics,
          activeSkinSlot: slot,
          skinAssetPath: skin.assetPath,
          skinSource: 'custom'
        }
      });
    } catch (selectionError: any) {
      setError(getUserFacingErrorMessage(selectionError, 'Could not select this skin.'));
    }
  };

  const selectOfficialCape = async (cape: LocalCosmeticTexture) => {
    if (!activeAccount || equippingCapeAssetId || (cosmetics?.manifest?.metadata?.adminAssignedKinds || []).includes('cape')) return;
    setEquippingCapeAssetId(`ms:${cape.id}`);
    setError('');
    setMessage('');
    try {
      const previewUrl = await window.dewclient.auth.getCosmeticPreview(activeAccount.id, cape.assetPath, 'cape');
      await window.dewclient.auth.equipFreeCape(activeAccount.id, null);
      await onUpdateAccount(activeAccount.id, {
        capeAssetPath: cape.assetPath,
        cosmetics: {
          ...activeAccount.cosmetics,
          activeOfficialCapeId: cape.id,
          activeCapeSource: 'microsoft',
          activeCapeAssetId: null,
          capeAssetPath: cape.assetPath,
          capeSource: 'official'
        }
      });
      setSelectedCapeAssetId(null);
      setSelectedOfficialCapeId(cape.id);
      setPreviewOverrides((current) => ({ ...current, cape: previewUrl }));
      setMessage(`${cape.name || 'Microsoft cape'} is equipped for this game. DewClient capes remain in your collection.`);
    } catch (capeError: any) {
      setError(getUserFacingErrorMessage(capeError, 'Could not load this Microsoft cape preview.'));
    } finally {
      setEquippingCapeAssetId(null);
    }
  };

  const selectAssignedCosmetic = async (kind: CosmeticSlot, item: any) => {
    if (!activeAccount || !item?.assetId) return;
    setError('');
    setMessage('');
    setLoadingAssignedAssetId(item.assetId);
    try {
      const previewUrl = await window.dewclient.auth.getAssignedCosmeticPreview(activeAccount.id, kind, item.assetId);
      const activeAdminCosmetics = { ...(activeAccount.cosmetics?.activeAdminCosmetics || {}), [kind]: item.assetId };
      await onUpdateAccount(activeAccount.id, {
        cosmetics: {
          ...activeAccount.cosmetics,
          activeAdminCosmetics,
          ...(kind === 'cape' ? { activeOfficialCapeId: undefined, activeCapeSource: 'admin' as const, activeCapeAssetId: item.assetId } : {})
        }
      });
      setPreviewOverrides((current) => ({ ...current, [kind]: previewUrl }));
      setSelectedAdminAssetIds((current) => ({ ...current, [kind]: item.assetId }));
      setMessage(`${slotLabels[kind]} selected for in-game use. The client is syncing this choice.`);
    } catch (assignedError: any) {
      setError(getUserFacingErrorMessage(assignedError, 'Could not load this assigned texture.'));
    } finally {
      setLoadingAssignedAssetId((current) => current === item.assetId ? null : current);
    }
  };

  const claimFreeCape = async (cape: FreeCapeItem) => {
    if (!activeAccount || !accountCanClaim || claimingCapeAssetId) return;
    setClaimingCapeAssetId(cape.assetId);
    setError('');
    setMessage('');
    try {
      const result = await window.dewclient.auth.claimFreeCape(activeAccount.id, cape.assetId);
      if (result.requiresLink) {
        setMessage('Link Discord once in Settings → Account; this cape will be included automatically.');
        onClaimCape(cape.assetId);
        return;
      }
      if (result.equipped && result.selectedCapeAssetId) {
        const selected = result.selectedCapeAssetId.toLowerCase();
        setSelectedCapeAssetId(selected);
        await onUpdateAccount(activeAccount.id, {
          cosmetics: { ...activeAccount.cosmetics, activeOfficialCapeId: undefined, activeCapeSource: 'dew', activeCapeAssetId: selected }
        });
      }
      setMessage(result.equipped
        ? `${cape.name} is in your collection and equipped in-game.`
        : result.alreadyClaimed
          ? `${cape.name} is already in your cape collection.`
          : `${cape.name} was claimed and added to your cape collection.`);
      await refreshCosmetics();
      try {
        const catalog = await window.dewclient.auth.getFreeCapes(activeAccount.id);
        setFreeCapes(catalog.items);
        setDiscordLinked(catalog.discordLinked === true);
        if (!catalog.identityRequired) setSelectedCapeAssetId(catalog.selectedCapeAssetId);
        setFreeCapesError('');
      } catch {
        setFreeCapesError('Claim saved. Refresh free capes when your account session is available.');
      }
    } catch (claimError: any) {
      setError(getUserFacingErrorMessage(claimError, `Could not claim ${cape.name}.`));
    } finally {
      setClaimingCapeAssetId(null);
    }
  };

  const equipFreeCape = async (cape: FreeCapeItem) => {
    if (!activeAccount || equippingCapeAssetId || (cosmetics?.manifest?.metadata?.adminAssignedKinds || []).includes('cape')) return;
    setEquippingCapeAssetId(cape.assetId);
    setError('');
    setMessage('');
    try {
      const previewUrl = await window.dewclient.auth.getFreeCapePreview(activeAccount.id, cape.assetId, cape.sha256);
      const result = await window.dewclient.auth.equipFreeCape(activeAccount.id, cape.assetId);
      setSelectedCapeAssetId(result.selectedCapeAssetId?.toLowerCase() || cape.assetId.toLowerCase());
      setPreviewOverrides((current) => ({ ...current, cape: previewUrl }));
      await onUpdateAccount(activeAccount.id, {
        cosmetics: {
          ...activeAccount.cosmetics,
          activeOfficialCapeId: undefined,
          activeCapeSource: 'dew',
          activeCapeAssetId: result.selectedCapeAssetId?.toLowerCase() || cape.assetId.toLowerCase()
        }
      });
      await refreshCosmetics();
      setMessage(`${cape.name} is equipped. The game and nearby players will sync the change.`);
    } catch (equipError: any) {
      setError(getUserFacingErrorMessage(equipError, `Could not equip ${cape.name}.`));
    } finally {
      setEquippingCapeAssetId(null);
    }
  };

  const adminAssignedKinds: string[] = cosmetics?.manifest?.metadata?.adminAssignedKinds || [];
  const explicitlySelectedCape = Object.prototype.hasOwnProperty.call(cosmetics?.manifest?.metadata || {}, 'activeCapeAssetId');
  const manifestCapeAssetId = explicitlySelectedCape
    ? (typeof cosmetics?.manifest?.metadata?.activeCapeAssetId === 'string' ? cosmetics.manifest.metadata.activeCapeAssetId.toLowerCase() : null)
    : (typeof cosmetics?.manifest?.cape?.assetId === 'string' ? cosmetics.manifest.cape.assetId.toLowerCase() : null);
  const activeCapeAssetId = selectedCapeAssetId !== undefined ? selectedCapeAssetId : manifestCapeAssetId;
  const isAdminAssigned = adminAssignedKinds.includes(selectedSlot);
  const skinUrl = adminAssignedKinds.includes('skin')
    ? previewOverrides.skin ?? cosmetics?.skinPreviewUrl ?? null
    : savedSkinSlots[selectedSkinSlot]
      ? previewOverrides.skin ?? null
      : activeAccount.skinUrl ?? null;
  const capeUrl = previewOverrides.cape
    ?? (activeCapeAssetId && cosmetics?.capePreviewUrl ? cosmetics.capePreviewUrl : null)
    ?? cosmetics?.capePreviewUrl
    ?? activeAccount.capeUrl
    ?? null;
  const elytraUrl = adminAssignedKinds.includes('elytra') ? previewOverrides.elytra ?? cosmetics?.elytraPreviewUrl ?? null : null;
  const backEquipment = selectedSlot === 'cape' ? 'cape' : selectedSlot === 'elytra' ? 'elytra' : null;
  const backUrl = selectedSlot === 'cape' ? capeUrl : selectedSlot === 'elytra' ? elytraUrl : null;
  const claimedCapeIds = new Set(freeCapes.filter((cape) => cape.claimed).map((cape) => cape.assetId.toLowerCase()));
  const assignedForSelected = assignedCosmetics(selectedSlot).filter((item) =>
    selectedSlot !== 'cape' || !claimedCapeIds.has(String(item.assetId || '').toLowerCase())
  );
  const selectedCosmetic = cosmetics?.manifest?.[selectedSlot];
  const isOfficial = activeAccount.cosmetics?.[`${selectedSlot}Source` as keyof NonNullable<UserAccount['cosmetics']>] === 'official';
  const selectedStatus = isAdminAssigned && selectedCosmetic?.enabled
    ? 'Assigned to you by a DewClient administrator'
    : previewOverrides[selectedSlot]
      ? 'Stored on this device'
    : selectedCosmetic?.enabled
      ? 'Synced to DewClient server'
      : selectedSlot === 'skin' && savedSkinSlots[selectedSkinSlot]
        ? 'Stored on this device'
      : isOfficial
        ? 'Synced from Minecraft profile'
        : 'No cosmetic selected';
  const SelectedSlotIcon = slotIcons[selectedSlot];
  return (
    <section className="cosmetics-studio">
      <header className="cosmetics-studio-header">
        <div>
          <h2>Cosmetics</h2>
          <p>Player identity for DewClient.</p>
        </div>
        <div className="cosmetics-studio-actions">
          <button type="button" className="btn btn-secondary" onClick={() => { void refreshCosmetics(); }} disabled={refreshing}>
            {refreshing ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
      </header>

      <nav className="cosmetics-studio-nav" role="tablist" aria-label="Cosmetic categories">
        {(['skin', 'cape', 'elytra'] as const).map((slot) => {
          const Icon = slotIcons[slot];
          return (
            <button
              key={slot}
              id={`cosmetics-tab-${slot}`}
              type="button"
              role="tab"
              aria-controls="cosmetics-category-panel"
              aria-selected={selectedSlot === slot}
              tabIndex={selectedSlot === slot ? 0 : -1}
              className={`cosmetics-studio-slot${selectedSlot === slot ? ' is-active' : ''}`}
              onClick={() => setSelectedSlot(slot)}
            >
              <Icon size={15} />{slotLabels[slot]}
            </button>
          );
        })}
      </nav>

      <div className="cosmetics-studio-preview-column">
        <MinecraftPlayerPreview
          username={activeAccount.username}
          skinUrl={skinUrl}
          backUrl={backUrl}
          backEquipment={backEquipment}
          autoRotate={autoRotate}
        />
        <div className="cosmetics-studio-controls">
          <button
            type="button"
            className="cosmetics-studio-toggle"
            aria-label="Toggle model rotation"
            aria-pressed={autoRotate}
            title="Toggle model rotation"
            onClick={() => setAutoRotate((value) => !value)}
          >
            <RotateCw size={16} />
          </button>
        </div>
      </div>

      <aside className="cosmetics-studio-tools" id="cosmetics-category-panel" role="tabpanel" aria-labelledby={`cosmetics-tab-${selectedSlot}`}>
        <h3>{slotLabels[selectedSlot]}</h3>
        <p>{selectedSlot === 'skin'
          ? 'Keep up to four skins on this device and choose which one to use. Any skin assigned by an administrator takes priority in-game.'
          : selectedSlot === 'cape'
            ? 'Capes owned by your Microsoft profile appear below. Select one to preview it; the Active label reflects your Minecraft profile.'
            : 'Elytra textures are assigned by a DewClient administrator and appear while wearing an elytra.'}</p>
        {selectedSlot === 'skin' && (
          <>
            <div className="cosmetics-skin-slots" aria-label="Saved skins">
              {savedSkinSlots.map((skin, slot) => (
                <button
                  key={slot}
                  type="button"
                  className={`cosmetics-skin-slot${selectedSkinSlot === slot ? ' is-active' : ''}`}
                  aria-pressed={selectedSkinSlot === slot}
                  onClick={() => void selectSkinSlot(slot)}
                >
                  {skin
                    ? <CosmeticSlotTexture accountId={activeAccount.id} kind="skin" assetPath={skin.assetPath} label={`Skin ${slot + 1}`} />
                    : <Shirt size={15} />}
                  <span>Slot {slot + 1}</span>
                  <small>{selectedSkinSlot === slot ? 'Selected · In game' : skin ? 'Saved' : 'Empty'}</small>
                  {selectedSkinSlot === slot && <span className="cosmetics-selected-badge"><Check size={11} />Selected</span>}
                </button>
              ))}
            </div>
            <button type="button" className="btn btn-primary cosmetics-studio-upload" onClick={uploadSelected} disabled={saving}>
              <Upload size={15} />{saving ? 'Saving...' : `Upload to Slot ${selectedSkinSlot + 1}`}
            </button>
          </>
        )}
        {assignedForSelected.length > 0 && (
          <section className="cosmetics-assigned-panel" aria-label={`DewClient assigned ${slotLabels[selectedSlot].toLowerCase()}`}>
            <div className="cosmetics-assigned-heading">
              <div><strong>DewClient assigned</strong><small>{assignedForSelected.length} texture{assignedForSelected.length === 1 ? '' : 's'} from an administrator</small></div>
              <Cloud size={16} />
            </div>
            <div className="cosmetics-skin-slots cosmetics-assigned-slots">
              {assignedForSelected.map((item, index) => {
                const itemId = String(item.assetId).toLowerCase();
                const selectedId = String(selectedAdminAssetIds[selectedSlot] || '').toLowerCase();
                const isInGame = String(
                  cosmetics?.manifest?.metadata?.activeAdminCosmetics?.[selectedSlot]
                    || selectedAdminAssetIds[selectedSlot]
                    || cosmetics?.manifest?.[selectedSlot]?.assetId
                    || ''
                ).toLowerCase() === itemId;
                const isSelected = selectedId ? selectedId === itemId : isInGame;
                const isSyncingSelection = isSelected && !isInGame;
                return (
                  <button
                    key={item.assetId}
                    type="button"
                    className={`cosmetics-skin-slot${isSelected ? ' is-active' : ''}${isSyncingSelection ? ' is-syncing-selection' : ''}`}
                    aria-pressed={isSelected}
                    onClick={() => void selectAssignedCosmetic(selectedSlot, item)}
                    disabled={loadingAssignedAssetId === item.assetId}
                  >
                    <CosmeticSlotTexture accountId={activeAccount.id} kind={selectedSlot} assetId={item.assetId} label={`${slotLabels[selectedSlot]} ${index + 1}`} />
                    <span>{slotLabels[selectedSlot]} {index + 1}</span>
                    <small>{loadingAssignedAssetId === item.assetId ? 'Loading…' : isSyncingSelection ? 'Syncing selection…' : isInGame ? 'In game' : 'Assigned'}</small>
                    {isSelected && <span className="cosmetics-selected-badge"><Check size={11} />{isSyncingSelection ? 'Saving' : 'Selected'}</span>}
                  </button>
                );
              })}
            </div>
            {assignedForSelected.length > 1 && <small className="cosmetics-assigned-note">Choose a tile to preview and select it for in-game use. One {slotLabels[selectedSlot].toLowerCase()} can be active at a time.</small>}
          </section>
        )}
        {selectedSlot === 'cape' && activeAccount.type === 'microsoft' && officialCapes.length > 0 && (
          <>
            <div className="cosmetics-list-heading">Microsoft capes <span>{officialCapes.length}</span></div>
            <div className="cosmetics-skin-slots cosmetics-cape-slots" aria-label="Microsoft capes">
              {officialCapes.map((cape) => {
                const isEquipped = !adminAssignedKinds.includes('cape') && !activeCapeAssetId && selectedOfficialCapeId === cape.id;
                const isSwitching = equippingCapeAssetId === `ms:${cape.id}`;
                return <button
                  key={cape.id}
                  type="button"
                  className={`cosmetics-skin-slot${isEquipped ? ' is-active' : ''}`}
                  aria-pressed={isEquipped}
                  aria-label={`${cape.name || 'Microsoft cape'}${isEquipped ? ', equipped' : ', equip cape'}`}
                  onClick={() => void selectOfficialCape(cape)}
                  disabled={isSwitching || adminAssignedKinds.includes('cape')}
                >
                  <CosmeticSlotTexture accountId={activeAccount.id} kind="cape" assetPath={cape.assetPath} label={cape.name || 'Microsoft Cape'} />
                  <span>{cape.name || 'Microsoft Cape'}</span>
                  <small>{adminAssignedKinds.includes('cape')
                    ? 'DewClient cape active'
                    : activeCapeAssetId
                      ? cape.active ? 'Profile cape · overridden' : 'Owned · DewClient cape active'
                      : isSwitching ? 'Equipping…' : isEquipped ? 'Equipped in this game' : cape.active ? 'Microsoft profile cape' : 'Owned · click to equip'}</small>
                  {isEquipped && <span className="cosmetics-selected-badge"><Check size={11} />Equipped</span>}
                </button>;
              })}
            </div>
            <div className="cosmetics-studio-status">Equip a Microsoft cape to switch off the DewClient cape for this profile. Your claimed capes stay in your collection.</div>
          </>
        )}
        {selectedSlot === 'cape' && freeCapes.length > 0 && (
          <section className="cosmetics-free-capes" aria-label="Free DewClient capes">
            <div className="cosmetics-list-heading">Free capes <span>{freeCapes.length}</span></div>
            <p className="cosmetics-free-capes-copy">{discordLinked
              ? 'Claimed capes stay in your collection. Equip one to make it the single active cape for this profile.'
              : 'Choose Claim to link Discord once. After that, you can claim future free capes here with one click.'}</p>
            <div className="cosmetics-free-cape-list">
              {freeCapes.map((cape) => {
                const owned = cape.claimed;
                const isEquipped = !adminAssignedKinds.includes('cape') && activeCapeAssetId === cape.assetId.toLowerCase();
                return (
                  <article className={`cosmetics-free-cape-card${isEquipped ? ' is-equipped' : ''}`} key={cape.assetId}>
                    <div className="cosmetics-free-cape-art">
                      <CosmeticSlotTexture accountId={activeAccount.id} kind="cape" freeCape={{ assetId: cape.assetId, sha256: cape.sha256 }} label={`${cape.name} preview`} />
                      <span>DEW CAPE</span>
                    </div>
                    <div className="cosmetics-free-cape-info">
                      <strong>{cape.name}</strong>
                      <small>{owned ? isEquipped ? 'Equipped · visible in-game' : 'Owned · ready to equip' : `${cape.width || '—'} × ${cape.height || '—'} texture`}</small>
                    </div>
                    {owned ? (
                      <div className="cosmetics-free-cape-actions">
                        {isEquipped
                          ? <span className="cosmetics-free-cape-owned is-equipped" aria-label={`${cape.name} is equipped`}><Check size={14} /> Equipped</span>
                          : <button type="button" className="btn btn-secondary cosmetics-free-cape-equip" onClick={() => void equipFreeCape(cape)} disabled={Boolean(equippingCapeAssetId) || adminAssignedKinds.includes('cape')}>
                              {equippingCapeAssetId === cape.assetId ? 'Equipping…' : adminAssignedKinds.includes('cape') ? 'Admin cape active' : 'Equip'}
                            </button>}
                      </div>
                    ) : (
                      <button type="button" className="btn btn-primary" onClick={() => void claimFreeCape(cape)} disabled={!accountCanClaim || Boolean(claimingCapeAssetId)}>
                        {claimingCapeAssetId === cape.assetId ? 'Claiming…' : accountCanClaim ? 'Claim' : 'Sign in to claim'}
                      </button>
                    )}
                  </article>
                );
              })}
            </div>
            {!accountCanClaim && <div className="cosmetics-studio-status">Offline profiles cannot claim free capes. Sign in with Microsoft or Discord.</div>}
            {freeCapesError && <div className="cosmetics-studio-error">{freeCapesError}</div>}
          </section>
        )}
        <div className="cosmetics-studio-status">
          {selectedCosmetic?.enabled && !(selectedSlot === 'skin' && savedSkinSlots[selectedSkinSlot]) ? <Cloud size={14} /> : <Check size={14} />}
          <span>{selectedSlot === 'cape' && adminAssignedKinds.includes('cape')
            ? `Equipped cape: ${assignedForSelected.find((item) => String(item.assetId).toLowerCase() === String(selectedAdminAssetIds.cape || cosmetics?.manifest?.metadata?.activeAdminCosmetics?.cape || '').toLowerCase())?.name || 'DewClient assigned cape'}`
            : selectedSlot === 'cape' && activeCapeAssetId
              ? `Equipped cape: ${freeCapes.find((cape) => cape.assetId.toLowerCase() === activeCapeAssetId)?.name || assignedForSelected.find((item) => String(item.assetId).toLowerCase() === activeCapeAssetId)?.name || 'DewClient cape'}`
              : selectedSlot === 'cape' && selectedOfficialCapeId
                ? `Equipped cape: ${officialCapes.find((cape) => cape.id === selectedOfficialCapeId)?.name || 'Microsoft cape'}`
                : selectedStatus}</span>
        </div>
        {assignedForSelected.length === 0 && selectedSlot !== 'cape' && <div className="cosmetics-studio-status">These cosmetics become available here after an administrator assigns them to your account.</div>}
        {assignedForSelected.length === 0 && selectedSlot === 'cape' && !freeCapes.some((cape) => cape.claimed) && <div className="cosmetics-studio-status">{officialCapes.length > 0 ? 'Your Microsoft capes appear above. Claim or receive a DewClient cape to use one here.' : 'Claim a free cape or wait for a DewClient assignment to use one in-game.'}</div>}
        {selectedSlot === 'elytra' && <div className="cosmetics-studio-status">Standalone wings are not rendered by the current in-game loader.</div>}
        {message && <div className="cosmetics-studio-status">{message}</div>}
        {error && <div className="cosmetics-studio-error">{error}</div>}
      </aside>
    </section>
  );
};
