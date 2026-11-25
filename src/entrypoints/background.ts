import type { ExtractMode } from '@/lib/extractor';

const MENU_PAGE_ID = 'page2md-copy-page';
const MENU_SELECTION_ID = 'page2md-copy-selection';

async function triggerCopy(tabId: number, mode: ExtractMode): Promise<void> {
  try {
    await browser.scripting.executeScript({
      target: { tabId },
      func: (selectedMode: ExtractMode) => {
        (window as Window & { __page2mdMode?: ExtractMode }).__page2mdMode =
          selectedMode;
      },
      args: [mode],
    });
    await browser.scripting.executeScript({
      target: { tabId },
      files: ['/copy-page.js'],
    });
  } catch {
  }
}

async function registerContextMenus(): Promise<void> {
  await browser.contextMenus.removeAll();
  browser.contextMenus.create({
    id: MENU_PAGE_ID,
    title: 'Copier la page en Markdown',
    contexts: ['page'],
  });
  browser.contextMenus.create({
    id: MENU_SELECTION_ID,
    title: 'Copier la sélection en Markdown',
    contexts: ['selection'],
  });
}

export default defineBackground(() => {
  browser.runtime.onInstalled.addListener(() => {
    void registerContextMenus();
  });

  browser.contextMenus.onClicked.addListener((info, tab) => {
    if (!tab?.id) {
      return;
    }
    if (info.menuItemId === MENU_SELECTION_ID) {
      void triggerCopy(tab.id, 'selection');
    } else if (info.menuItemId === MENU_PAGE_ID) {
      void triggerCopy(tab.id, 'page');
    }
  });

  const actionApi = browser.action ?? browser.browserAction;
  actionApi.onClicked.addListener((tab) => {
    if (tab.id) {
      void triggerCopy(tab.id, 'auto');
    }
  });
});
