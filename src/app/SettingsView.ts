import type { MessageKey } from '../i18n';
import {
  assetCacheEntries,
  assetCacheUsage,
  clearAssetCache,
  deleteAssetCacheEntry,
} from '../engine/assets';
import type { EnginePreferences } from '../engine/preferences';

export interface SettingsOptions {
  readonly host: HTMLElement;
  readonly t: (key: MessageKey) => string;
  readonly general: HTMLElement;
  readonly preferences: EnginePreferences;
  readonly autoAnalyze: boolean;
  readonly engineReply: boolean;
  readonly running: boolean;
  readonly onAutoAnalyze: (enabled: boolean) => void;
  readonly onEngineReply: (enabled: boolean) => void;
  readonly onPreferences: (next: EnginePreferences) => boolean;
  readonly onEngineRestart: () => void;
}

export async function openSettings(options: SettingsOptions): Promise<void> {
  const { host, t, preferences } = options;
  let current = preferences;
  const overlay = document.createElement('div');
  overlay.className = 'modal';
  const dialog = document.createElement('div');
  dialog.className = 'settings-dialog';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-label', t('settings'));

  const title = document.createElement('h2');
  title.textContent = t('settings');
  const interfaceTitle = document.createElement('h3');
  interfaceTitle.textContent = t('interfaceSettings');
  const engineTitle = document.createElement('h3');
  engineTitle.textContent = t('engineSettings');
  const engineFields = document.createElement('div');
  engineFields.className = 'settings-engine';

  const threadsSelect = document.createElement('select');
  const hashSelect = document.createElement('select');
  for (const value of ['auto', 1, 2, 4] as const) {
    const option = document.createElement('option');
    option.value = String(value);
    option.textContent = value === 'auto' ? t('auto') : String(value);
    option.selected = String(preferences.threads) === option.value;
    threadsSelect.append(option);
  }
  for (const value of ['auto', 16, 32, 64, 128, 256] as const) {
    const option = document.createElement('option');
    option.value = String(value);
    option.textContent = value === 'auto' ? t('auto') : String(value);
    option.selected = String(preferences.hashMb) === option.value;
    hashSelect.append(option);
  }
  for (const [label, select] of [
    [t('threads'), threadsSelect],
    [t('hash'), hashSelect],
  ] as const) {
    const field = document.createElement('label');
    field.textContent = label;
    field.append(select);
    engineFields.append(field);
  }

  const autoLabel = document.createElement('label');
  const autoInput = document.createElement('input');
  autoInput.type = 'checkbox';
  autoInput.checked = options.autoAnalyze;
  autoInput.addEventListener('change', () => options.onAutoAnalyze(autoInput.checked));
  autoLabel.append(autoInput, t('autoAnalyze'));
  engineFields.append(autoLabel);

  const replyLabel = document.createElement('label');
  const replyInput = document.createElement('input');
  replyInput.type = 'checkbox';
  replyInput.checked = options.engineReply;
  replyInput.addEventListener('change', () => options.onEngineReply(replyInput.checked));
  replyLabel.append(replyInput, t('engineReply'));
  engineFields.append(replyLabel);

  const facts = document.createElement('dl');
  facts.className = 'settings-facts';
  const usage = document.createElement('dd');
  const quota = document.createElement('dd');
  const cache = document.createElement('dd');
  for (const [label, value] of [
    [t('storageUsage'), usage],
    [t('quota'), quota],
    [t('engineCache'), cache],
  ] as const) {
    const dt = document.createElement('dt');
    dt.textContent = label;
    facts.append(dt, value);
  }

  const message = document.createElement('p');
  message.className = 'settings-message';
  const cachedTitle = document.createElement('h3');
  cachedTitle.textContent = t('cachedNetworks');
  const networkList = document.createElement('ul');
  networkList.className = 'settings-networks';
  const actions = document.createElement('div');
  actions.className = 'settings-actions';
  const clear = document.createElement('button');
  clear.type = 'button';
  clear.textContent = t('clearCache');
  const close = document.createElement('button');
  close.type = 'button';
  close.textContent = t('close');
  close.addEventListener('click', () => host.replaceChildren());

  const commit = (next: EnginePreferences): void => {
    if (options.running && !window.confirm(t('confirmEngineRestart'))) {
      threadsSelect.value = String(current.threads);
      hashSelect.value = String(current.hashMb);
      return;
    }
    if (options.onPreferences(next)) {
      current = next;
      message.textContent = t('engineSettingsSaved');
    }
  };
  threadsSelect.addEventListener('change', () => {
    commit({
      ...current,
      threads: threadsSelect.value === 'auto' ? 'auto' : (Number(threadsSelect.value) as 1 | 2 | 4),
    });
  });
  hashSelect.addEventListener('change', () => {
    commit({
      ...current,
      hashMb:
        hashSelect.value === 'auto'
          ? 'auto'
          : (Number(hashSelect.value) as 16 | 32 | 64 | 128 | 256),
    });
  });

  const formatBytes = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
  };
  const refresh = async (): Promise<void> => {
    const estimate = navigator.storage?.estimate ? await navigator.storage.estimate() : {};
    usage.textContent = formatBytes(estimate.usage ?? 0);
    quota.textContent = estimate.quota ? formatBytes(estimate.quota) : t('unknown');
    cache.textContent = formatBytes(await assetCacheUsage());
    networkList.replaceChildren();
    for (const entry of await assetCacheEntries()) {
      const item = document.createElement('li');
      const name = new URL(entry.key).pathname.split('/').pop() ?? entry.key;
      const when = entry.cachedAt ? new Date(entry.cachedAt).toLocaleString() : t('unknown');
      const label = document.createElement('span');
      label.textContent = `${name} · ${formatBytes(entry.bytes)} · ${when}`;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = t('deleteNetwork');
      remove.addEventListener('click', () => {
        remove.disabled = true;
        void (async () => {
          options.onEngineRestart();
          const removed = await deleteAssetCacheEntry(entry.key);
          await refresh();
          message.textContent = removed ? t('networkRemoved') : t('cacheUnavailable');
        })();
      });
      item.append(label, remove);
      networkList.append(item);
    }
  };

  clear.addEventListener('click', () => {
    clear.disabled = true;
    void (async () => {
      options.onEngineRestart();
      const removed = await clearAssetCache();
      await refresh();
      message.textContent = removed ? t('cacheCleared') : t('cacheUnavailable');
      clear.disabled = false;
    })();
  });

  actions.append(clear, close);
  dialog.append(
    title,
    interfaceTitle,
    options.general,
    engineTitle,
    engineFields,
    facts,
    cachedTitle,
    networkList,
    message,
    actions,
  );
  overlay.append(dialog);
  host.append(overlay);
  await refresh();
}
