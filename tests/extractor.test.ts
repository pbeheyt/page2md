import { afterEach, describe, expect, it } from 'vitest';
import { extractDocumentContent } from '@/lib/extractor';
import { formatDocumentAsMarkdown } from '@/lib/markdown';

function createDetachedDoc(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html');
}

function setLiveDocument(title: string, bodyHtml: string): void {
  document.title = title;
  document.body.innerHTML = bodyHtml;
}

afterEach(() => {
  window.getSelection()?.removeAllRanges();
  document.title = '';
  document.body.innerHTML = '';
});

describe('extractDocumentContent', () => {
  it('extrait le contenu principal via Readability et ignore nav/footer', () => {
    const doc = createDetachedDoc(
      `<!doctype html>
      <html>
        <head><title>Article Tech</title></head>
        <body>
          <nav><a href="/">Accueil</a><a href="/about">À propos</a></nav>
          <article>
            <h1>Migration PostgreSQL 17</h1>
            <p>Voici un retour d'expérience détaillé sur la migration de notre base de données en production vers PostgreSQL 17 avec zéro interruption de service.</p>
            <p>Les gains de performance sur le vacuum et les requêtes JSONB ont réduit la latence p99 de 35 pour cent sur l'ensemble de nos services critiques.</p>
          </article>
          <footer>© 2026 Copyright</footer>
        </body>
      </html>`
    );

    const result = extractDocumentContent(doc, 'page');
    expect(result.source).toBe('readability');
    expect(result.html).toContain('PostgreSQL 17');
    expect(result.html).not.toContain('© 2026 Copyright');
  });

  it('préserve les classes de langage des blocs de code à travers Readability', () => {
    setLiveDocument(
      'Guide TypeScript',
      `
      <article>
        <h1>Typage strict en TypeScript</h1>
        <p>Dans une codebase critique, la configuration noUncheckedIndexedAccess permet d'éviter une classe entière de bugs silencieux lors des accès aux tableaux et dictionnaires.</p>
        <pre><code class="language-ts">const first: string | undefined = items[0];</code></pre>
      </article>
      `
    );

    const extracted = extractDocumentContent(document, 'page');
    expect(extracted.source).toBe('readability');

    const md = formatDocumentAsMarkdown(extracted);
    expect(md).toContain('```ts\nconst first: string | undefined = items[0];\n```');
  });

  it('utilise le fallback nettoyé quand la page est courte et ignore les éléments cachés', () => {
    const doc = createDetachedDoc(
      `<!doctype html>
      <html>
        <head><title>Dashboard</title></head>
        <body>
          <header>Menu principal</header>
          <main>
            <p>Statut : OK</p>
            <span class="sr-only">Texte caché lecteur écran</span>
            <div hidden>Paywall caché</div>
          </main>
          <footer>Pied de page</footer>
        </body>
      </html>`
    );

    const result = extractDocumentContent(doc, 'page');
    expect(result.source).toBe('fallback');
    expect(result.html).toContain('Statut : OK');
    expect(result.html).not.toContain('Menu principal');
    expect(result.html).not.toContain('Pied de page');
    expect(result.html).not.toContain('Texte caché lecteur écran');
    expect(result.html).not.toContain('Paywall caché');
  });

  it('filtre display:none et visibility:hidden tout en conservant un enfant visibility:visible', () => {
    setLiveDocument(
      'Visibilité CSS',
      `
      <main>
        <p>Texte visible</p>
        <div style="display: none"><p>Sous-arbre masqué</p></div>
        <div style="visibility: hidden">
          Texte parent masqué
          <span style="visibility: visible">Enfant explicitement visible</span>
        </div>
        <div style="visibility: collapse">Ligne réduite</div>
      </main>
      `
    );

    const result = extractDocumentContent(document, 'page');
    expect(result.html).toContain('Texte visible');
    expect(result.html).toContain('Enfant explicitement visible');
    expect(result.html).not.toContain('Sous-arbre masqué');
    expect(result.html).not.toContain('Texte parent masqué');
    expect(result.html).not.toContain('Ligne réduite');
  });

  it('priorise <main> sur une carte <article> antérieure et conserve <header> interne', () => {
    setLiveDocument(
      'Priorité racine',
      `
      <article><p>Carte latérale</p></article>
      <main>
        <header><h1>Titre principal</h1></header>
        <p>Contenu court.</p>
      </main>
      `
    );

    const result = extractDocumentContent(document, 'page');
    expect(result.source).toBe('fallback');
    expect(result.html).toContain('Titre principal');
    expect(result.html).toContain('Contenu court.');
    expect(result.html).not.toContain('Carte latérale');
  });

  it('résout les liens relatifs en mode fallback et laisse le titre vide si absent', () => {
    setLiveDocument(
      '',
      `<main><p>Voir la <a href="/docs/api">documentation</a>.</p></main>`
    );

    const result = extractDocumentContent(document, 'page');
    expect(result.title).toBe('');
    expect(result.url).toBe('https://example.com/article');
    expect(result.html).toContain('href="https://example.com/docs/api"');
  });

  it('préserve le contexte <pre><code> lors d’une sélection partielle de code', () => {
    setLiveDocument(
      'Snippet',
      `<pre><code class="language-python">def hello():\n    return 42</code></pre>`
    );

    const codeText = document.querySelector('code')!.firstChild!;
    const range = document.createRange();
    range.setStart(codeText, 0);
    range.setEnd(codeText, 12);

    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);

    const extracted = extractDocumentContent(document, 'auto');
    expect(extracted.source).toBe('selection');

    const md = formatDocumentAsMarkdown(extracted);
    expect(md).toContain('```python\ndef hello():\n```');
  });

  it('préserve le contexte <table> et nettoie les éléments cachés lors d’une sélection', () => {
    setLiveDocument(
      'Tableau',
      `
      <table>
        <tbody>
          <tr id="r1"><th>Clé</th><th>Lien</th></tr>
          <tr id="r2"><td>API <span aria-hidden="true">Copier</span></td><td><a href="/ref">Réf</a></td></tr>
        </tbody>
      </table>
      `
    );

    const tbody = document.querySelector('tbody')!;
    const range = document.createRange();
    range.selectNodeContents(tbody);

    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);

    const extracted = extractDocumentContent(document, 'selection');
    expect(extracted.source).toBe('selection');
    expect(extracted.html).not.toContain('Copier');
    expect(extracted.html).toContain('https://example.com/ref');

    const md = formatDocumentAsMarkdown(extracted);
    expect(md).toContain('| Clé | Lien |\n| --- | --- |\n| API | [Réf](https://example.com/ref) |');
  });

  it('retourne un HTML vide en mode selection explicite quand aucune sélection n’est active', () => {
    setLiveDocument('Page', '<main><p>Texte</p></main>');

    const result = extractDocumentContent(document, 'selection');
    expect(result.source).toBe('selection');
    expect(result.html).toBe('');
  });

  it('préserve les libellés de boutons dans les en-têtes <th> à travers Readability', () => {
    setLiveDocument(
      'Portefeuille',
      `
      <article>
        <h1>Suivi du portefeuille</h1>
        <p>Tableau consolidé de toutes les positions ouvertes avec valorisation quotidienne et performance cumulée depuis le début de l'année.</p>
        <table>
          <thead>
            <tr>
              <th><button type="button">Instrument</button><button aria-label="Sort"><svg></svg></button></th>
              <th><button type="button">Valeur</button></th>
            </tr>
          </thead>
          <tbody>
            <tr><td>ASML</td><td>3 500 €</td></tr>
          </tbody>
        </table>
      </article>
      `
    );

    const extracted = extractDocumentContent(document, 'page');
    const md = formatDocumentAsMarkdown(extracted);
    expect(md).toContain('| Instrument | Valeur |');
    expect(md).toContain('| ASML | 3 500 € |');
  });

  it('bascule sur <main> nettoyé si Readability ampute la majorité d’un fil multi-messages', () => {
    const replies = Array.from(
      { length: 8 },
      (_, i) => `
        <div class="comment">
          <a href="/u/membre-${i + 1}">Membre ${i + 1}</a>
          <p>Réponse ${i + 1} très détaillée avec des éléments chiffrés sur la marge opérationnelle, le carnet de commandes et les risques d'exécution.</p>
        </div>
      `
    ).join('');
    setLiveDocument(
      'Forum Discussion',
      `
      <nav><a href="/">Menu</a></nav>
      <main>
        <div role="navigation"><a href="/sidebar">Navigation interne</a></div>
        <article>
          <h1>Sujet principal</h1>
          <p>Premier message détaillé qui présente l'ensemble du contexte technique, les chiffres clés de l'année et les perspectives à moyen terme pour la filière européenne.</p>
          <p>Analyse complémentaire des marges, des investissements industriels, de la trésorerie et de la structure financière sur les trois derniers exercices publiés.</p>
        </article>
        <div id="comments" class="comments">
          <h2>Réponses</h2>
          ${replies}
        </div>
        <button type="button">Répondre</button>
        <select><option>Trier par date</option><option>Trier par vote</option></select>
      </main>
      `
    );

    const extracted = extractDocumentContent(document, 'page');
    expect(extracted.source).toBe('fallback');
    const md = formatDocumentAsMarkdown(extracted);
    expect(md).toContain('Premier message détaillé');
    expect(md).toContain('Réponse 1 très détaillée');
    expect(md).toContain('Réponse 8 très détaillée');
    expect(md).not.toContain('Navigation interne');
    expect(md).not.toContain('Trier par date');
  });

  it('bascule sur le fallback si Readability ne retient qu’un encart isolé sur une app div sans <main>', () => {
    const rows = Array.from(
      { length: 60 },
      (_, i) =>
        `<div><a href="/actif/${i + 1}">Actif Financier Européen ${i + 1}</a><span>1 250,00 €</span><span>+4,25 %</span></div>`
    ).join('');
    setLiveDocument(
      'Portefeuilles',
      `
      <div class="notice">
        <h2>Information réglementaire</h2>
        <p>Veuillez mettre à jour vos informations personnelles afin de garantir la conformité de votre dossier client auprès de nos services réglementaires et fiscaux en vigueur.</p>
      </div>
      <div class="grid">${rows}</div>
      `
    );

    const extracted = extractDocumentContent(document, 'page');
    expect(extracted.source).toBe('fallback');
    const md = formatDocumentAsMarkdown(extracted);
    expect(md).toContain('Actif Financier Européen 1');
    expect(md).toContain('Actif Financier Européen 60');
  });

  it('extrait le LaTeX des balises <math> (KaTeX/MathML/Wikipedia) même sous wrapper a11y display:none', () => {
    setLiveDocument(
      'Théorème',
      `
      <article>
        <h1>Théorème fondamental</h1>
        <p>
          Sur <span style="display: none"><math data-mw='{"body":{"extsrc":"\\\\mathbb{C}"}}'><mi>C</mi></math></span><img alt="C" src="c.svg" />,
          tout polynôme <math><semantics><mi>P</mi><annotation encoding="application/x-tex">P(X)</annotation></semantics></math> admet une racine.
        </p>
        <p>Voici la formule en bloc :</p>
        <math display="block"><semantics><mrow></mrow><annotation encoding="application/x-tex">a_n X^n + \\dots + a_0 = 0</annotation></semantics></math>
      </article>
      `
    );

    const extracted = extractDocumentContent(document, 'page');
    const md = formatDocumentAsMarkdown(extracted);
    expect(md).toContain('$\\mathbb{C}$');
    expect(md).toContain('$P(X)$');
    expect(md).toContain('$$\na_n X^n + \\dots + a_0 = 0\n$$');
  });

  it('convertit un <textarea aria-readonly="true"> en bloc de code tout en ignorant un <textarea> éditable', () => {
    setLiveDocument(
      'Fichier source',
      `
      <main>
        <h1>index.ts</h1>
        <textarea aria-readonly="true">export function sum(a: number, b: number) {\n  return a + b;\n}</textarea>
        <textarea placeholder="Ajouter un commentaire">Brouillon utilisateur</textarea>
      </main>
      `
    );

    const extracted = extractDocumentContent(document, 'page');
    const md = formatDocumentAsMarkdown(extracted);
    expect(md).toContain('```\nexport function sum(a: number, b: number) {\n  return a + b;\n}\n```');
    expect(md).not.toContain('Brouillon utilisateur');
  });

  it('normalise les blocs <pre> à lignes <div> / boutons Copy sans perdre les retours à la ligne', () => {
    setLiveDocument(
      'Docs Code',
      `
      <article>
        <h1>Configuration</h1>
        <p>Exemple complet de configuration avec plusieurs lignes et un bouton copier intégré dans le bloc de code.</p>
        <pre class="language-ts"><button type="button">Copy</button><code class="language-ts"><div><span>const a = 1;</span></div><div><span>const b = 2;</span></div></code></pre>
      </article>
      `
    );

    const extracted = extractDocumentContent(document, 'page');
    const md = formatDocumentAsMarkdown(extracted);
    expect(md).toContain('```ts\nconst a = 1;\nconst b = 2;\n```');
    expect(md).not.toContain('Copy');
  });

  it('préserve les <pre> multi-<code>, les lignes <div></div> vides et ignore les <textarea readonly> cachés', () => {
    setLiveDocument(
      'Multi-code',
      `
      <main>
        <h1>Code</h1>
        <pre class="language-js"><code>const a = 1;</code><code>const b = 2;</code></pre>
        <pre><code><div>line 1</div><div></div><div>line 3</div></code></pre>
        <textarea readonly hidden>secret buffer</textarea>
        <textarea aria-readonly="true" style="display: none">hidden editor buffer</textarea>
      </main>
      `
    );

    const extracted = extractDocumentContent(document, 'page');
    const md = formatDocumentAsMarkdown(extracted);
    expect(md).toContain('```js\nconst a = 1;\nconst b = 2;\n```');
    expect(md).toContain('```\nline 1\n\nline 3\n```');
    expect(md).not.toContain('secret buffer');
    expect(md).not.toContain('hidden editor buffer');
  });

  it('préserve une sélection couvrant <thead> et <tbody> ainsi que les formules <math> en sélection', () => {
    setLiveDocument(
      'Sélection riche',
      `
      <table id="t">
        <thead><tr><th>Nom</th><th>Formule</th></tr></thead>
        <tbody><tr><td>Identité</td><td><math><semantics><annotation encoding="application/x-tex">e^{i\\pi}+1=0</annotation></semantics></math></td></tr></tbody>
      </table>
      `
    );

    const table = document.getElementById('t')!;
    const range = document.createRange();
    range.setStart(table.querySelector('thead')!, 0);
    range.setEnd(table.querySelector('tbody')!, 1);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);

    const extracted = extractDocumentContent(document, 'selection');
    expect(extracted.source).toBe('selection');
    const md = formatDocumentAsMarkdown(extracted);
    expect(md).toContain('| Nom | Formule |');
    expect(md).toContain('| Identité | $e^{i\\pi}+1=0$ |');
  });

  it('détecte katex-display / data-mw sur ancêtre, préserve {\\displaystyle a} + {\\displaystyle b} et garde <aside> dans <main>', () => {
    setLiveDocument(
      'Maths et callout',
      `
      <main>
        <div class="mwe-math-element mwe-math-element-block" data-mw='{"body":{"extsrc":"{\\\\displaystyle a} + {\\\\displaystyle b}"}}'>
          <span style="display: none"><math><mi>a+b</mi></math></span>
        </div>
        <aside><p>Note importante dans le contenu principal.</p></aside>
      </main>
      <aside><p>Barre latérale externe.</p></aside>
      `
    );

    const extracted = extractDocumentContent(document, 'page');
    const md = formatDocumentAsMarkdown(extracted);
    expect(md).toContain('$$\n{\\displaystyle a} + {\\displaystyle b}\n$$');
    expect(md).toContain('Note importante dans le contenu principal.');
    expect(md).not.toContain('Barre latérale externe.');
  });

  it('ignore un premier <main> vide et nettoie les attributs onerror', () => {
    setLiveDocument(
      'Main vide',
      `
      <main></main>
      <div id="content"><p>Contenu utile <img src="x" onerror="window.__xss=1" /></p></div>
      `
    );

    const extracted = extractDocumentContent(document, 'page');
    expect(extracted.html).toContain('Contenu utile');
    expect(extracted.html).not.toContain('onerror');
  });
});
