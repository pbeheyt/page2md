import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  manifest: ({ browser }) => ({
    name: 'Page2MD',
    description: 'Copie le contenu principal d’une page web ou d’une sélection en Markdown propre pour LLM.',
    permissions: ['activeTab', 'scripting', 'contextMenus', 'clipboardWrite'],
    action: {
      default_title: 'Copier la page en Markdown (Ctrl+Shift+X)',
    },
    commands: {
      [browser === 'firefox' ? '_execute_browser_action' : '_execute_action']: {
        suggested_key: {
          default: 'Ctrl+Shift+X',
        },
        description: 'Copier la page (ou la sélection) en Markdown',
      },
    },
    icons: {
      16: 'icon/16.png',
      32: 'icon/32.png',
      48: 'icon/48.png',
      128: 'icon/128.png',
    },
    ...(browser === 'firefox' && {
      browser_specific_settings: {
        gecko: {
          id: 'page2md@pbeheyt.local',
          strict_min_version: '128.0',
          data_collection_permissions: {
            required: ['none'],
          },
        },
      },
    }),
  }),
});
