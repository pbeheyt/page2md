import { describe, expect, it } from 'vitest';
import {
  countWords,
  formatDocumentAsMarkdown,
  htmlToCleanMarkdown,
} from '@/lib/markdown';

describe('markdown', () => {
  it('convertit titres, code avec langage et tableaux GFM', () => {
    const html = `
      <h2>Exemple</h2>
      <pre><code class="language-ts">const x = 42;</code></pre>
      <table>
        <tr><th>Nom</th><th>Valeur</th></tr>
        <tr><td>Latence</td><td>12ms</td></tr>
      </table>
    `;
    const md = htmlToCleanMarkdown(html);
    expect(md).toContain('## Exemple');
    expect(md).toContain('```ts\nconst x = 42;\n```');
    expect(md).toContain('| Nom | Valeur |\n| --- | --- |\n| Latence | 12ms |');
  });

  it('supprime les images, sépare les spans en cellule et retire les colonnes vides', () => {
    const html = `
      <p><img src="https://example.com/avatar.png" alt="Avatar" />Texte utile</p>
      <table>
        <tr><th></th><th>Actif</th><th>Valeur</th><th></th></tr>
        <tr><td></td><td><span>PSP5.PA</span><span>Amundi S&amp;P 500</span></td><td><span>10,367 €</span></td><td></td></tr>
      </table>
    `;
    const md = htmlToCleanMarkdown(html);
    expect(md).not.toContain('avatar.png');
    expect(md).toContain('Texte utile');
    expect(md).toContain('| Actif | Valeur |\n| --- | --- |\n| PSP5.PA Amundi S&P 500 | 10,367 € |');
  });

  it('ajoute le titre et la source en en-tête', () => {
    const md = formatDocumentAsMarkdown({
      title: 'Guide WXT',
      url: 'https://wxt.dev/guide',
      html: '<p>Contenu utile.</p>',
      source: 'readability',
    });
    expect(md).toBe('# Guide WXT\nSource : https://wxt.dev/guide\n\nContenu utile.');
    expect(countWords(md)).toBeGreaterThan(5);
  });
});
