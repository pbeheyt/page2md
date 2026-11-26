import {
  createBackgroundController,
  type BackgroundActionApi,
  type BackgroundRuntime,
} from '@/lib/background-controller';

function resolveActionApi(): BackgroundActionApi {
  return (
    import.meta.env.MANIFEST_VERSION === 3 ? browser.action : browser.browserAction
  ) as unknown as BackgroundActionApi;
}

export default defineBackground({
  persistent: false,
  main() {
    const controller = createBackgroundController({
      actionApi: resolveActionApi(),
      scripting: browser.scripting as unknown as BackgroundRuntime['scripting'],
      contextMenus: browser.contextMenus as unknown as BackgroundRuntime['contextMenus'],
      runtime: browser.runtime as unknown as BackgroundRuntime['runtime'],
      tabs: browser.tabs as unknown as BackgroundRuntime['tabs'],
    });
    controller.attachListeners();
  },
});
