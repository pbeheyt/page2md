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
});
