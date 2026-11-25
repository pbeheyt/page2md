import type { ExtractMode } from '@/lib/extractor';
import {
  RUNNER_SYMBOL_KEY,
  type CopyResult,
  type Page2MdRunner,
} from '@/lib/protocol';

interface ContextMenuConfig {
  readonly id: string;
  readonly title: string;
  readonly contexts: readonly ['page'] | readonly ['selection'];
  readonly mode: ExtractMode;
  readonly targetFrame: boolean;
}

const CONTEXT_MENUS: readonly ContextMenuConfig[] = [
  {
    id: 'page2md-copy-page',
    title: 'Copier la page en Markdown',
    contexts: ['page'],
    mode: 'page',
    targetFrame: false,
  },
  {
    id: 'page2md-copy-selection',
    title: 'Copier la sélection en Markdown',
    contexts: ['selection'],
    mode: 'selection',
    targetFrame: true,
  },
];

const CONTEXT_MENU_BY_ID = new Map<string, ContextMenuConfig>(
  CONTEXT_MENUS.map((menu) => [menu.id, menu])
);

const BADGE_ERROR_COLOR = '#b91c1c';
const BADGE_ERROR_DURATION_MS = 2200;

const badgeTimers = new Map<number, ReturnType<typeof setTimeout>>();
let menuRegistrationQueue: Promise<void> = Promise.resolve();

function getActionApi() {
  return import.meta.env.MANIFEST_VERSION === 3
    ? browser.action
    : browser.browserAction;
}

function isValidTabId(id: number | undefined): id is number {
  return typeof id === 'number' && id !== browser.tabs.TAB_ID_NONE;
}

function flashErrorBadge(tabId: number): void {
  const actionApi = getActionApi();
  const previousTimer = badgeTimers.get(tabId);
  if (previousTimer !== undefined) {
    clearTimeout(previousTimer);
  }

  void Promise.all([
    actionApi.setBadgeBackgroundColor({ tabId, color: BADGE_ERROR_COLOR }),
    actionApi.setBadgeText({ tabId, text: '!' }),
  ]).catch((error: unknown) => {
    console.warn('[page2md] Unable to display error badge:', error);
  });

  const timerId = setTimeout(() => {
    badgeTimers.delete(tabId);
    void actionApi.setBadgeText({ tabId, text: '' }).catch((error: unknown) => {
      console.debug('[page2md] Badge clear skipped for tab:', tabId, error);
    });
  }, BADGE_ERROR_DURATION_MS);

  badgeTimers.set(tabId, timerId);
}

function invokeInjectedRunner(
  runnerKey: string,
  selectedMode: ExtractMode
): Promise<CopyResult> | null {
  const candidate: unknown = Reflect.get(globalThis, Symbol.for(runnerKey));
  if (typeof candidate !== 'function') {
    return null;
  }
  return (candidate as Page2MdRunner)(selectedMode);
}

async function runInTarget(
  target: { tabId: number; frameIds?: number[] },
  mode: ExtractMode
): Promise<CopyResult | null> {
  const results = await browser.scripting.executeScript({
    target,
    func: invokeInjectedRunner,
    args: [RUNNER_SYMBOL_KEY, mode],
  });
  return (results[0]?.result as CopyResult | null | undefined) ?? null;
}

async function triggerCopy(
  tabId: number,
  mode: ExtractMode,
  frameId?: number
): Promise<void> {
  const target =
    typeof frameId === 'number' ? { tabId, frameIds: [frameId] } : { tabId };

  try {
    let result = await runInTarget(target, mode);
    if (result === null) {
      await browser.scripting.executeScript({
        target,
        files: ['/copy-page.js'],
      });
      result = await runInTarget(target, mode);
    }

    if (!result || (!result.ok && result.reason === 'unsupported_document')) {
      flashErrorBadge(tabId);
    }
  } catch (error) {
    console.warn('[page2md] Cannot execute copy script on tab:', tabId, error);
    flashErrorBadge(tabId);
  }
}

function registerContextMenus(): Promise<void> {
  menuRegistrationQueue = menuRegistrationQueue
    .then(async () => {
      await browser.contextMenus.removeAll();
      for (const menu of CONTEXT_MENUS) {
        browser.contextMenus.create(
          {
            id: menu.id,
            title: menu.title,
            contexts: [...menu.contexts],
          },
          () => {
            if (browser.runtime.lastError) {
              console.warn(
                '[page2md] Context menu registration warning:',
                browser.runtime.lastError.message
              );
            }
          }
        );
      }
    })
    .catch((error: unknown) => {
      console.warn('[page2md] Failed to register context menus:', error);
    });

  return menuRegistrationQueue;
}

export default defineBackground({
  persistent: false,
  main() {
    browser.runtime.onInstalled.addListener(() => {
      void registerContextMenus();
    });

    browser.runtime.onStartup.addListener(() => {
      void registerContextMenus();
    });

    browser.contextMenus.onClicked.addListener((info, tab) => {
      if (!isValidTabId(tab?.id) || typeof info.menuItemId !== 'string') {
        return;
      }
      const menu = CONTEXT_MENU_BY_ID.get(info.menuItemId);
      if (!menu) {
        return;
      }
      const targetFrameId = menu.targetFrame ? info.frameId : undefined;
      void triggerCopy(tab.id, menu.mode, targetFrameId);
    });

    getActionApi().onClicked.addListener((tab) => {
      if (isValidTabId(tab.id)) {
        void triggerCopy(tab.id, 'auto');
      }
    });
  },
});
