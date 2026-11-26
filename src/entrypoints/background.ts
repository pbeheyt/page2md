import {
  createBackgroundController,
  type BackgroundActionApi,
} from '@/lib/background-controller';

function resolveActionApi(): BackgroundActionApi {
  return import.meta.env.MANIFEST_VERSION === 3 ? browser.action : browser.browserAction;
}

export default defineBackground({
  persistent: false,
  main() {
    const controller = createBackgroundController({
      actionApi: resolveActionApi(),
      scripting: browser.scripting,
      contextMenus: browser.contextMenus,
      runtime: browser.runtime,
      tabs: browser.tabs,
    });
    controller.attachListeners();
  },
});
