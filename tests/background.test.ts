import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createBackgroundController,
  invokeInjectedRunner,
  type BackgroundRuntime,
} from '@/lib/background-controller';
import { RUNNER_SYMBOL_KEY } from '@/lib/protocol';

function createMockRuntime() {
  const executeScript = vi.fn();
  const setBadgeBackgroundColor = vi.fn().mockResolvedValue(undefined);
  const setBadgeTextColor = vi.fn().mockResolvedValue(undefined);
  const setBadgeText = vi.fn().mockResolvedValue(undefined);
  const removeAll = vi.fn().mockResolvedValue(undefined);
  const create = vi.fn((_props, cb?: () => void) => {
    cb?.();
  });

  const installedListeners: Array<() => void> = [];
  const startupListeners: Array<() => void> = [];
  const menuClickListeners: Array<
    (info: { menuItemId: string | number; frameId?: number }, tab?: { id?: number }) => void
  > = [];
  const actionClickListeners: Array<(tab: { id?: number }) => void> = [];
  const tabRemovedListeners: Array<(tabId: number) => void> = [];

  const runtime: BackgroundRuntime = {
    actionApi: {
      setBadgeBackgroundColor,
      setBadgeTextColor,
      setBadgeText,
      onClicked: {
        addListener: (listener) => actionClickListeners.push(listener),
      },
    },
    scripting: {
      executeScript,
    },
    contextMenus: {
      removeAll,
      create,
      onClicked: {
        addListener: (listener) => menuClickListeners.push(listener),
      },
    },
    runtime: {
      lastError: null,
      onInstalled: {
        addListener: (listener) => installedListeners.push(listener),
      },
      onStartup: {
        addListener: (listener) => startupListeners.push(listener),
      },
    },
    tabs: {
      TAB_ID_NONE: -1,
      onRemoved: {
        addListener: (listener) => tabRemovedListeners.push(listener),
      },
    },
  };

  return {
    runtime,
    mocks: {
      executeScript,
      setBadgeBackgroundColor,
      setBadgeTextColor,
      setBadgeText,
      removeAll,
      create,
    },
    listeners: {
      installedListeners,
      startupListeners,
      menuClickListeners,
      actionClickListeners,
      tabRemovedListeners,
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  Reflect.deleteProperty(globalThis, Symbol.for(RUNNER_SYMBOL_KEY));
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('invokeInjectedRunner', () => {
  it('retourne missing quand aucun runner n’est enregistré, ok en succès, error sur exception', async () => {
    expect(await invokeInjectedRunner(RUNNER_SYMBOL_KEY, 'auto')).toEqual({ status: 'missing' });

    Reflect.set(globalThis, Symbol.for(RUNNER_SYMBOL_KEY), async () => ({
      ok: true,
      source: 'readability',
      wordCount: 42,
    }));
    expect(await invokeInjectedRunner(RUNNER_SYMBOL_KEY, 'auto')).toEqual({
      status: 'ok',
      result: { ok: true, source: 'readability', wordCount: 42 },
    });

    Reflect.set(globalThis, Symbol.for(RUNNER_SYMBOL_KEY), async () => {
      throw new Error('Runner crashed');
    });
    expect(await invokeInjectedRunner(RUNNER_SYMBOL_KEY, 'auto')).toEqual({
      status: 'error',
      message: 'Runner crashed',
    });
  });
});

describe('createBackgroundController', () => {
  it('injecte /copy-page.js uniquement quand le runner renvoie missing', async () => {
    const { runtime, mocks } = createMockRuntime();
    mocks.executeScript
      .mockResolvedValueOnce([{ result: { status: 'missing' } }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ result: { status: 'ok', result: { ok: true, wordCount: 10 } } }]);

    const controller = createBackgroundController(runtime);
    await controller.triggerCopy(7, 'auto');

    expect(mocks.executeScript).toHaveBeenCalledTimes(3);
    expect(mocks.executeScript.mock.calls[1]?.[0]).toEqual({
      target: { tabId: 7 },
      files: ['/copy-page.js'],
    });
    expect(mocks.setBadgeText).not.toHaveBeenCalled();
  });

  it('ne ré-injecte PAS sur une erreur InjectionResult.error (Firefox MV2) et affiche le badge erreur blanc sur rouge', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { runtime, mocks } = createMockRuntime();
    mocks.executeScript.mockResolvedValueOnce([{ error: new Error('Blocked by CSP') }]);

    const controller = createBackgroundController(runtime);
    await controller.triggerCopy(9, 'page');

    expect(mocks.executeScript).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledOnce();
    expect(mocks.setBadgeBackgroundColor).toHaveBeenCalledWith({ tabId: 9, color: '#b91c1c' });
    expect(mocks.setBadgeTextColor).toHaveBeenCalledWith({ tabId: 9, color: '#ffffff' });
    expect(mocks.setBadgeText).toHaveBeenCalledWith({ tabId: 9, text: '!' });

    vi.advanceTimersByTime(2200);
    expect(mocks.setBadgeText).toHaveBeenLastCalledWith({ tabId: 9, text: '' });
  });

  it('déduplique les appels concurrents sur le même (tabId, frameId)', async () => {
    const { runtime, mocks } = createMockRuntime();
    let resolveFirst!: (items: Array<{ result: unknown }>) => void;
    mocks.executeScript.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve;
        })
    );

    const controller = createBackgroundController(runtime);
    const first = controller.triggerCopy(3, 'selection', 12);
    const second = controller.triggerCopy(3, 'selection', 12);

    expect(mocks.executeScript).toHaveBeenCalledTimes(1);

    resolveFirst([{ result: { status: 'ok', result: { ok: true, wordCount: 5 } } }]);
    await Promise.all([first, second]);
    expect(mocks.executeScript).toHaveBeenCalledTimes(1);
  });

  it('sérialise réellement registerContextMenus jusqu’à la fin des callbacks create', async () => {
    const { runtime, mocks } = createMockRuntime();
    const order: string[] = [];
    mocks.removeAll.mockImplementation(async () => {
      order.push('removeAll');
    });
    mocks.create.mockImplementation((props: { id: string }, cb?: () => void) => {
      order.push(`start:${props.id}`);
      setTimeout(() => {
        order.push(`done:${props.id}`);
        cb?.();
      }, 10);
    });

    const controller = createBackgroundController(runtime);
    const p1 = controller.registerContextMenus();
    const p2 = controller.registerContextMenus();

    await vi.runAllTimersAsync();
    await Promise.all([p1, p2]);

    expect(order).toEqual([
      'removeAll',
      'start:page2md-copy-page',
      'done:page2md-copy-page',
      'start:page2md-copy-selection',
      'done:page2md-copy-selection',
      'removeAll',
      'start:page2md-copy-page',
      'done:page2md-copy-page',
      'start:page2md-copy-selection',
      'done:page2md-copy-selection',
    ]);
  });

  it('annule le timer de badge lorsque l’onglet est fermé', async () => {
    const { runtime, mocks, listeners } = createMockRuntime();
    const controller = createBackgroundController(runtime);
    controller.attachListeners();

    controller.flashErrorBadge(42);
    expect(mocks.setBadgeText).toHaveBeenCalledTimes(1);

    listeners.tabRemovedListeners[0]?.(42);
    vi.advanceTimersByTime(3000);
    expect(mocks.setBadgeText).toHaveBeenCalledTimes(1);
  });
});
