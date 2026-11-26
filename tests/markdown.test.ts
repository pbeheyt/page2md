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

  it('préserve les sauts de ligne <br> sans backslash résiduel et supprime les liens vides enveloppant un SVG', () => {
    const html = `
      <p>Ligne 1<br>Ligne 2</p>
      <p><a href="https://example.com"><svg><title>Partager</title></svg></a></p>
    `;
    const md = htmlToCleanMarkdown(html);
    expect(md).toBe('Ligne 1\nLigne 2');
  });

  it('sépare les spans adjacents sans casser les décimales ni la ponctuation et n’échappe pas les nombres négatifs', () => {
    const html = `
      <div><span>11 positions</span><span>valued 01:40 PM</span></div>
      <div><span>Jan</span><span>-1.6%</span></div>
      <p><span>30,</span><span>2 %</span> (<strong>5 titres</strong>) <strong>A :</strong><strong>B</strong> d’<a href="https://example.com/e">État</a></p>
      <p><del>49,99 €</del> 29,99 €</p>
    `;
    const md = htmlToCleanMarkdown(html);
    expect(md).toContain('11 positions valued 01:40 PM');
    expect(md).toContain('Jan -1.6%');
    expect(md).not.toContain('\\-1.6%');
    expect(md).toContain('30,2 % (**5 titres**) **A :** **B** d’[État](https://example.com/e)');
    expect(md).toContain('~~49,99 €~~ 29,99 €');
  });

  it('nettoie les URLs de tracking, supprime les URLs opaques >250 car., les puces/titres vides et les titres imbriqués', () => {
    const longTracker = `https://ads.example.com/clk?p=${'a'.repeat(300)}`;
    const html = `
      <h1><div><h2>Résultats</h2></div></h1>
      <h3>1. Source</h3>
      <h3></h3>
      <ol><li><img src="x.png" /></li><li><a href="https://example.com/item?utm_source=x&amp;id=42">Produit\n\nPhare</a></li><li><a href="${longTracker}">Offre</a></li></ol>
      <p><a href="#section">#</a></p>
    `;
    const md = htmlToCleanMarkdown(html);
    expect(md.split('\n')).toContain('# Résultats');
    expect(md).not.toContain('# ##');
    expect(md).toContain('### 1. Source');
    expect(md).toContain('1. [Produit Phare](https://example.com/item?id=42)');
    expect(md).toContain('2. Offre');
    expect(md).not.toContain('ads.example.com');
    expect(md).not.toContain('[#]');
  });

  it('durcit les tableaux GFM (pipes LaTeX, décimales, <del>, <code> avec backticks, rowspan par section et tableaux imbriqués)', () => {
    const html = `
      <table>
        <thead>
          <tr><th rowspan="5">Section</th><th>Détail</th></tr>
        </thead>
        <tbody>
          <tr>
            <td rowspan="0"><span>30,</span><span>2 %</span> d’<a href="https://example.com/e">État [FR]</a><a href="#top">#</a></td>
            <td><code>a \` b</code> <del>ancien</del> <span data-page2md-math="inline">\\|x\\|</span></td>
          </tr>
          <tr>
            <td><table><tr><td>A</td><td>B</td></tr></table></td>
          </tr>
        </tbody>
      </table>
    `;
    const lines = htmlToCleanMarkdown(html).split('\n');
    expect(lines).toEqual([
      '| Section | Détail |',
      '| --- | --- |',
      '| 30,2 % d’[État \\[FR\\]](https://example.com/e) | ``a ` b`` ~~ancien~~ $\\\\\\|x\\\\\\|$ |',
      '|  | A B |',
    ]);
  });

  it('indente correctement les listes <ol>, valide start, et supprime les blockquotes/pre vides', () => {
    const html = `
      <ol start="10">
        <li><p>Premier paragraphe</p><p>Second paragraphe</p></li>
        <li>Suivant</li>
      </ol>
      <ol start="invalid"><li>Un</li></ol>
      <blockquote><img src="x.png" alt="vide" /></blockquote>
      <pre><img src="x.png" /></pre>
      <pre data-lang="" data-language="ts extra\`bad"><code>const ok = true;</code></pre>
    `;
    const md = htmlToCleanMarkdown(html);
    expect(md).toContain('10. Premier paragraphe\n\n    Second paragraphe\n11. Suivant');
    expect(md).toContain('1. Un');
    expect(md).not.toContain('NaN.');
    expect(md).not.toMatch(/^>\s*$/m);
    expect(md).toContain('```ts\nconst ok = true;\n```');
  });

  it('gère les suffixes de liens, préfixes monétaires, emphases synonymes, liens à titres/titles échappés et HTML inerte', () => {
    const html = `
      <p>Les <a href="https://example.com/api">API</a>s coûtent <span>$</span><span>100</span> ou <strong>gras</strong><b>suite</b>.</p>
      <p><a href="https://example.com/doc" title="Guide &quot;v1&quot; \\"><h3>Documentation</h3></a></p>
      <p><img src="x" onerror="window.__xss=1" />Propre</p>
    `;
    const md = htmlToCleanMarkdown(html);
    expect(md).toContain('[API](https://example.com/api)s');
    expect(md).toContain('$100');
    expect(md).toContain('**gras** **suite**');
    expect(md).toContain('[Documentation](https://example.com/doc "Guide \\"v1\\" \\\\")');
    expect(md).not.toContain('[### Documentation]');
    expect(Reflect.get(window, '__xss')).toBeUndefined();
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

  it('évite la duplication du H1 y compris pour C# ou un titre avec crochets', () => {
    const csharp = formatDocumentAsMarkdown({
      title: 'Guide C#',
      url: 'https://example.com/csharp?utm_source=test',
      html: '<h1>Guide C#</h1><p>Contenu utile.</p>',
      source: 'fallback',
    });
    expect(csharp).toBe('# Guide C#\nSource : https://example.com/csharp\n\nContenu utile.');

    const bracketed = formatDocumentAsMarkdown({
      title: 'Note [2026]',
      url: 'https://example.com/note',
      html: '<h1>Note [2026]</h1><p>Texte.</p>',
      source: 'fallback',
    });
    expect(bracketed).toBe('# Note [2026]\nSource : https://example.com/note\n\nTexte.');
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
