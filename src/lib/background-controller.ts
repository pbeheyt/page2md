import type { ExtractMode } from '@/lib/extractor';
import {
  RUNNER_SYMBOL_KEY,
  type Page2MdRunner,
  type RunnerInvocationResult,
} from '@/lib/protocol';

interface ContextMenuConfig {
  readonly id: string;
  readonly title: string;
  readonly contexts: readonly ['page'] | readonly ['selection'];
  readonly mode: ExtractMode;
  readonly targetFrame: boolean;
}

export const CONTEXT_MENUS: readonly ContextMenuConfig[] = [
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
const BADGE_ERROR_TEXT_COLOR = '#ffffff';
const BADGE_ERROR_DURATION_MS = 2200;

export interface ScriptInjectionTarget {
  tabId: number;
  frameIds?: number[];
}

export interface ScriptExecutionItem {
  result?: unknown;
  error?: unknown;
}

export interface BackgroundActionApi {
  setBadgeBackgroundColor(details: { tabId: number; color: string }): Promise<void> | void;
  setBadgeTextColor?: (details: { tabId: number; color: string }) => Promise<void> | void;
  setBadgeText(details: { tabId: number; text: string }): Promise<void> | void;
  onClicked: {
    addListener(listener: (tab: { id?: number }) => void): void;
  };
}

export interface BackgroundRuntime {
  actionApi: BackgroundActionApi;
  scripting: {
    executeScript(details: {
      target: ScriptInjectionTarget;
      files?: string[];
      func?: (...args: never[]) => unknown;
      args?: unknown[];
    }): Promise<ScriptExecutionItem[]>;
  };
  contextMenus: {
    removeAll(): Promise<void> | void;
    create(
      properties: {
        id: string;
        title: string;
        contexts: ('page' | 'selection')[];
      },
      callback?: () => void
    ): unknown;
    onClicked: {
      addListener(
        listener: (
          info: { menuItemId: string | number; frameId?: number },
          tab?: { id?: number }
        ) => void
      ): void;
    };
  };
  runtime: {
    lastError?: { message?: string } | null;
    onInstalled: { addListener(listener: () => void): void };
    onStartup: { addListener(listener: () => void): void };
  };
  tabs: {
    TAB_ID_NONE: number;
    onRemoved?: { addListener(listener: (tabId: number) => void): void };
  };
}

export async function invokeInjectedRunner(
  runnerKey: string,
  selectedMode: ExtractMode
): Promise<RunnerInvocationResult> {
  const candidate: unknown = Reflect.get(globalThis, Symbol.for(runnerKey));
  if (typeof candidate !== 'function') {
    return { status: 'missing' };
  }
  try {
    const result = await (candidate as Page2MdRunner)(selectedMode);
    return { status: 'ok', result };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { status: 'error', message };
  }
}

function createContextMenuItem(
  runtime: BackgroundRuntime,
  menu: ContextMenuConfig
): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (): void => {
      if (settled) {
        return;
      }
      settled = true;
      if (runtime.runtime.lastError) {
        console.warn(
          '[page2md] Context menu registration warning:',
          runtime.runtime.lastError.message
        );
      }
      resolve();
    };

    try {
      const maybePromise = runtime.contextMenus.create(
        {
          id: menu.id,
          title: menu.title,
          contexts: [...menu.contexts],
        },
        finish
      );
      if (maybePromise && typeof (maybePromise as Promise<unknown>).then === 'function') {
        void (maybePromise as Promise<unknown>).then(finish, (error: unknown) => {
          console.warn('[page2md] Context menu registration warning:', error);
          finish();
        });
      }
    } catch (error) {
      console.warn('[page2md] Context menu registration warning:', error);
      finish();
    }
  });
}

function isRunnerInvocationResult(value: unknown): value is RunnerInvocationResult {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const status = (value as { status?: unknown }).status;
  return status === 'missing' || status === 'ok' || status === 'error';
}

export function createBackgroundController(runtime: BackgroundRuntime) {
  const badgeTimers = new Map<number, ReturnType<typeof setTimeout>>();
  const inFlightTargets = new Set<string>();
  let menuRegistrationQueue: Promise<void> = Promise.resolve();

  function isValidTabId(id: number | undefined): id is number {
    return typeof id === 'number' && id !== runtime.tabs.TAB_ID_NONE;
  }

  function clearBadgeTimer(tabId: number): void {
    const previousTimer = badgeTimers.get(tabId);
    if (previousTimer !== undefined) {
      clearTimeout(previousTimer);
      badgeTimers.delete(tabId);
    }
  }

  function flashErrorBadge(tabId: number): void {
    clearBadgeTimer(tabId);

    const updates: Promise<unknown>[] = [
      Promise.resolve(
        runtime.actionApi.setBadgeBackgroundColor({ tabId, color: BADGE_ERROR_COLOR })
      ),
      Promise.resolve(runtime.actionApi.setBadgeText({ tabId, text: '!' })),
    ];
    if (typeof runtime.actionApi.setBadgeTextColor === 'function') {
      updates.push(
        Promise.resolve(
          runtime.actionApi.setBadgeTextColor({ tabId, color: BADGE_ERROR_TEXT_COLOR })
        )
      );
    }

    void Promise.all(updates).catch((error: unknown) => {
      console.warn('[page2md] Unable to display error badge:', error);
    });

    const timerId = setTimeout(() => {
      badgeTimers.delete(tabId);
      void Promise.resolve(runtime.actionApi.setBadgeText({ tabId, text: '' })).catch(
        (error: unknown) => {
          console.debug('[page2md] Badge clear skipped for tab:', tabId, error);
        }
      );
    }, BADGE_ERROR_DURATION_MS);

    badgeTimers.set(tabId, timerId);
  }

  async function runInTarget(
    target: ScriptInjectionTarget,
    mode: ExtractMode
  ): Promise<RunnerInvocationResult> {
    const results = await runtime.scripting.executeScript({
      target,
      func: invokeInjectedRunner as (...args: never[]) => unknown,
      args: [RUNNER_SYMBOL_KEY, mode],
    });

    const first = results[0];
    if (!first) {
      return { status: 'error', message: 'No execution result returned' };
    }
    if (first.error !== undefined) {
      const message =
        first.error instanceof Error ? first.error.message : String(first.error);
      return { status: 'error', message };
    }
    if (!isRunnerInvocationResult(first.result)) {
      return { status: 'error', message: 'Invalid runner invocation result' };
    }
    return first.result;
  }

  async function triggerCopy(
    tabId: number,
    mode: ExtractMode,
    frameId?: number
  ): Promise<void> {
    const lockKey = `${tabId}:${typeof frameId === 'number' ? frameId : 'top'}`;
    if (inFlightTargets.has(lockKey)) {
      return;
    }

    inFlightTargets.add(lockKey);
    const target: ScriptInjectionTarget =
      typeof frameId === 'number' ? { tabId, frameIds: [frameId] } : { tabId };

    try {
      let invocation = await runInTarget(target, mode);
      if (invocation.status === 'missing') {
        await runtime.scripting.executeScript({
          target,
          files: ['/copy-page.js'],
        });
        invocation = await runInTarget(target, mode);
      }

      if (invocation.status !== 'ok') {
        if (invocation.status === 'error') {
          console.warn('[page2md] Copy runner failed on tab:', tabId, invocation.message);
        }
        flashErrorBadge(tabId);
        return;
      }

      if (
        !invocation.result.ok &&
        (invocation.result.reason === 'unsupported_document' ||
          invocation.result.reason === 'unexpected_error')
      ) {
        flashErrorBadge(tabId);
      }
    } catch (error) {
      console.warn('[page2md] Cannot execute copy script on tab:', tabId, error);
      flashErrorBadge(tabId);
    } finally {
      inFlightTargets.delete(lockKey);
    }
  }

  function registerContextMenus(): Promise<void> {
    menuRegistrationQueue = menuRegistrationQueue
      .then(async () => {
        await Promise.resolve(runtime.contextMenus.removeAll());
        for (const menu of CONTEXT_MENUS) {
          await createContextMenuItem(runtime, menu);
        }
      })
      .catch((error: unknown) => {
        console.warn('[page2md] Failed to register context menus:', error);
      });

    return menuRegistrationQueue;
  }

  function attachListeners(): void {
    runtime.runtime.onInstalled.addListener(() => {
      void registerContextMenus();
    });

    runtime.runtime.onStartup.addListener(() => {
      void registerContextMenus();
    });

    runtime.contextMenus.onClicked.addListener((info, tab) => {
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

    runtime.actionApi.onClicked.addListener((tab) => {
      if (isValidTabId(tab.id)) {
        void triggerCopy(tab.id, 'auto');
      }
    });

    runtime.tabs.onRemoved?.addListener((tabId) => {
      clearBadgeTimer(tabId);
    });
  }

  return {
    triggerCopy,
    registerContextMenus,
    flashErrorBadge,
    clearBadgeTimer,
    attachListeners,
  };
}
