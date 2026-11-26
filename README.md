# Page2MD

Extension navigateur (Chrome Manifest V3 & Firefox Manifest V2) construite avec [WXT](https://wxt.dev/) pour copier le contenu principal d’une page web ou d’une sélection en Markdown propre, prêt à coller dans un LLM.

## Fonctionnalités

- **Copie page entière ou sélection** : détection automatique de la sélection active ; sinon extraction du contenu principal via `@mozilla/readability` complétée par un scoring DOM et un garde-fou de rétention pour éviter les pertes de contenu sur les pages structurées.
- **Conversion Markdown haute fidélité** :
  - Moteur de tableaux GFM dédié (`markdown-table.ts`) avec gestion propre de l’alignement et des cellules complexes.
  - Préservation des blocs de code et détection du langage (`extractor-code.ts`).
  - Extraction des formules MathML / LaTeX (`extractor-math.ts`).
  - Hygiène des liens, échappement et frontières inline (`markdown-inline-boundaries.ts`), parsing dans un document inerte.
- **UX & robustesse runtime** :
  - Notification toast isolée en Shadow DOM (avec repli sécurisé) et isolation du focus lors de la copie presse-papiers.
  - Verrous de concurrence par onglet dans le contrôleur background (`background-controller.ts`) et distinction nette entre runner absent et erreur d’exécution.
- **Confidentialité** : aucune collecte de données, aucun appel réseau externe (`permissions`: `activeTab`, `scripting`, `contextMenus`, `clipboardWrite`, Firefox `>= 140.0`).

## Utilisation

- **Raccourci clavier** : `Ctrl+Shift+L` (copie la sélection si du texte est surligné, sinon la page entière).
- **Clic sur l’icône** : même comportement.
- **Clic droit** : *Copier la page en Markdown* ou *Copier la sélection en Markdown*.

## Développement & Build

```bash
npm install
npm run check          # typecheck + tests + builds Chrome & Firefox
npm run typecheck      # Vérification TypeScript strict
npm test               # Suite Vitest + jsdom
npm run dev            # Mode dev Chrome MV3
npm run dev:firefox    # Mode dev Firefox MV2
npm run build          # Build production Chrome MV3 -> .output/chrome-mv3
npm run build:firefox  # Build production Firefox MV2 -> .output/firefox-mv2
npm run zip            # Archive Chrome
npm run zip:firefox    # Archive Firefox
npm run install:local  # Build Chrome + Firefox + copie dans ~/.local/share/browser-extensions/page2md
npm run sign:firefox   # Signature AMO unlisted via web-ext (lit AMO_JWT_ISSUER / AMO_JWT_SECRET dans .env)
```

## Installation locale

1. Lancer `npm run install:local` (ou `npm run build` / `npm run build:firefox`).
2. **Chrome / Chromium** : ouvrir `chrome://extensions`, activer le *Mode développeur*, puis *Charger l’extension non empaquetée* sur `~/.local/share/browser-extensions/page2md/chrome` (ou `.output/chrome-mv3`).
3. **Firefox** : ouvrir `about:debugging#/runtime/this-firefox`, cliquer sur *Charger un module complémentaire temporaire* et sélectionner `~/.local/share/browser-extensions/page2md/firefox/manifest.json` (ou installer le `.xpi` signé via `npm run sign:firefox`).
