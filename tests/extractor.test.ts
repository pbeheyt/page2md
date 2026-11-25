import { describe, expect, it } from 'vitest';
import { extractDocumentContent } from '@/lib/extractor';

function createDoc(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html');
}

describe('extractDocumentContent', () => {
  it('extrait le contenu principal via Readability et ignore nav/footer', () => {
    const doc = createDoc(
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

  it('utilise le fallback nettoyé quand la page est courte et ignore les éléments cachés', () => {
    const doc = createDoc(
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
});
