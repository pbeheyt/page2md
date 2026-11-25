import { describe, expect, it } from 'vitest';
import {
  countWords,
  formatDocumentAsMarkdown,
  htmlToCleanMarkdown,
} from '@/lib/markdown';

describe('htmlToCleanMarkdown', () => {
  it('retourne une chaîne vide pour une entrée vide ou blanche', () => {
    expect(htmlToCleanMarkdown('')).toBe('');
    expect(htmlToCleanMarkdown('   \n\t  ')).toBe('');
  });

  it('convertit les titres ATX et les blocs de code avec langage sur <code> ou <pre>', () => {
    const html = `
      <h2>Exemple</h2>
      <pre><code class="language-ts">const x = 42;</code></pre>
      <pre class="lang-c#"><code>var n = 1;</code></pre>
      <pre>raw stack trace</pre>
    `;
    const md = htmlToCleanMarkdown(html);
    expect(md).toContain('## Exemple');
    expect(md).toContain('```ts\nconst x = 42;\n```');
    expect(md).toContain('```c#\nvar n = 1;\n```');
    expect(md).toContain('```\nraw stack trace\n```');
  });

  it('adapte dynamiquement le délimiteur fence quand le code contient des triple backticks', () => {
    const html = '<pre><code class="language-md">```js\nconsole.log(1);\n```</code></pre>';
    const md = htmlToCleanMarkdown(html);
    expect(md).toBe('````md\n```js\nconsole.log(1);\n```\n````');
  });

  it('convertit un tableau GFM simple et échappe les pipes', () => {
    const html = `
      <table>
        <tr><th>Nom</th><th>Expression</th></tr>
        <tr><td>Filtre</td><td>a | b</td></tr>
      </table>
    `;
    expect(htmlToCleanMarkdown(html)).toBe(
      '| Nom | Expression |\n| --- | --- |\n| Filtre | a \\| b |'
    );
  });

  it('supprime les images, sépare les spans, respecte la ponctuation et retire les colonnes vides', () => {
    const html = `
      <p><img src="https://example.com/avatar.png" alt="Avatar" />Texte utile</p>
      <table>
        <tr><th></th><th>Actif</th><th>Note</th><th></th></tr>
        <tr>
          <td></td>
          <td><span>PSP5.PA</span><span>Amundi S&amp;P 500</span></td>
          <td><strong>100</strong><span>%</span>, <b>P</b>ostgreSQL</td>
          <td></td>
        </tr>
      </table>
    `;
    const md = htmlToCleanMarkdown(html);
    expect(md).not.toContain('avatar.png');
    expect(md).toContain('Texte utile');
    expect(md).toContain(
      '| Actif | Note |\n| --- | --- |\n| PSP5.PA Amundi S&P 500 | 100%, PostgreSQL |'
    );
  });

  it('gère les tableaux imbriqués, tfoot avant tbody, colspan et filtre svg/style dans les cellules', () => {
    const html = `
      <table>
        <tfoot><tr><td colspan="2">Total</td></tr></tfoot>
        <thead><tr><th>Nom</th><th>Lien</th></tr></thead>
        <tbody>
          <tr>
            <td><svg><title>Icône</title></svg><style>.x{}</style>API</td>
            <td><a href="https://example.com/api">Docs</a><table><tr><td>Sub</td></tr></table></td>
          </tr>
        </tbody>
      </table>
    `;
    const md = htmlToCleanMarkdown(html);
    expect(md).not.toContain('Icône');
    expect(md).not.toContain('.x{}');
    const lines = md.split('\n');
    expect(lines).toEqual([
      '| Nom | Lien |',
      '| --- | --- |',
      '| API | [Docs](https://example.com/api) Sub |',
      '| Total |  |',
    ]);
  });

  it('préserve les sauts de ligne <br> et supprime les liens vides enveloppant un SVG', () => {
    const html = `
      <p>Ligne 1<br>Ligne 2</p>
      <p><a href="https://example.com"><svg><title>Partager</title></svg></a></p>
    `;
    const md = htmlToCleanMarkdown(html);
    expect(md).toBe('Ligne 1\\\nLigne 2');
  });
});

describe('formatDocumentAsMarkdown', () => {
  it('ajoute le titre et la source en en-tête', () => {
    const md = formatDocumentAsMarkdown({
      title: 'Guide WXT',
      url: 'https://wxt.dev/guide',
      html: '<p>Contenu utile.</p>',
      source: 'readability',
    });
    expect(md).toBe('# Guide WXT\nSource : https://wxt.dev/guide\n\nContenu utile.');
  });

  it('évite la duplication du H1 quand le corps commence par le même titre', () => {
    const md = formatDocumentAsMarkdown({
      title: 'Guide WXT',
      url: 'https://wxt.dev/guide',
      html: '<h1>Guide WXT</h1><p>Contenu utile.</p>',
      source: 'fallback',
    });
    expect(md).toBe('# Guide WXT\nSource : https://wxt.dev/guide\n\nContenu utile.');
  });

  it('omet la ligne titre si doc.title est vide', () => {
    const md = formatDocumentAsMarkdown({
      title: '',
      url: 'https://wxt.dev/guide',
      html: '<p>Contenu utile.</p>',
      source: 'fallback',
    });
    expect(md).toBe('Source : https://wxt.dev/guide\n\nContenu utile.');
  });
});

describe('countWords', () => {
  it('ignore la ponctuation Markdown pure lors du comptage', () => {
    expect(countWords('')).toBe(0);
    expect(countWords('| --- | --- |')).toBe(0);
    expect(countWords('# Guide WXT\nSource : https://wxt.dev/guide\n\nContenu utile.')).toBe(6);
  });
});
