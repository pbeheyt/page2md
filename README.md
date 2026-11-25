# Page2MD

Extension navigateur (Chrome MV3 & Firefox MV2) pour copier le contenu principal d'une page web ou d'une sélection en Markdown propre, prêt à coller dans un LLM.

## Utilisation

- **Raccourci clavier** : `Ctrl+Shift+X` (copie la sélection si du texte est surligné, sinon la page entière).
- **Clic sur l'icône** : même comportement.
- **Clic droit** : *Copier la page en Markdown* ou *Copier la sélection en Markdown*.

## Développement & Build

```bash
npm install
npm test
npm run typecheck
npm run build           # Chrome (.output/chrome-mv3)
npm run build:firefox   # Firefox (.output/firefox-mv2)
npm run install:local   # Copie Chrome + Firefox + .xpi dans ~/.local/share/browser-extensions/page2md
```
