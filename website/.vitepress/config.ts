import { defineConfig } from 'vitepress';

const REPO = 'https://github.com/Avinash-Baraiya/Pragma';

/**
 * Links in the shared docs point at repository files outside the site (for
 * example `../SECURITY.md`). Send those to GitHub instead of a dead page.
 */
const REPO_FILE_LINK = /^(?:\.\.\/)+((?:SECURITY|CONTRIBUTING|LICENSE|README)(?:\.md)?)$/;

/**
 * GitHub Pages serves the site under /Pragma/; Vercel (and most other hosts)
 * serve it from the domain root. `PRAGMA_BASE` overrides both.
 */
const base = process.env['PRAGMA_BASE'] ?? (process.env['VERCEL'] ? '/' : '/Pragma/');

/** The canonical home of the docs; mirrors (Vercel) point search engines here. */
const CANONICAL = 'https://pragma-docs.vercel.app/';

export default defineConfig({
  title: 'Pragma',
  description:
    'Natural-language queries for data tables, as a validated, library-agnostic TableQuery.',
  base,
  lang: 'en-US',
  cleanUrls: true,
  // The screenshot stage only exists while `pnpm screenshots` runs.
  srcExclude: process.env['PRAGMA_SCREENSHOTS'] ? [] : ['screenshot-stage.md'],
  lastUpdated: true,
  sitemap: { hostname: CANONICAL },
  // Every page names its canonical URL, so copies on other hosts never compete in search.
  transformPageData(pageData) {
    const path = pageData.relativePath.replace(/(^|\/)index\.md$/, '$1').replace(/\.md$/, '');
    pageData.frontmatter['head'] ??= [];
    (pageData.frontmatter['head'] as unknown[]).push(
      ['link', { rel: 'canonical', href: `${CANONICAL}${path}` }],
      ['meta', { property: 'og:url', content: `${CANONICAL}${path}` }],
    );
  },
  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: `${base}favicon.svg` }],
    ['meta', { name: 'theme-color', content: '#4f46e5' }],
    // Google Search Console ownership (the HTML file in public/ verifies it too).
    [
      'meta',
      { name: 'google-site-verification', content: '_7zW3bWdhj9Gf-yFCHK-vInCHF52WNHRaO1fGAvg1Kc' },
    ],
    [
      'meta',
      {
        name: 'keywords',
        content:
          'pragma, natural language query, natural language to filter, nl2query, table filter, data table, TanStack Table, React table search, LLM query builder, AI table filter, TypeScript',
      },
    ],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:site_name', content: 'Pragma' }],
    ['meta', { name: 'twitter:card', content: 'summary_large_image' }],
    [
      'script',
      { type: 'application/ld+json' },
      JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'SoftwareSourceCode',
        name: 'Pragma',
        description:
          'Natural-language queries for data tables: a validated, library-agnostic TableQuery for search, filters, sort and pagination.',
        codeRepository: REPO,
        programmingLanguage: 'TypeScript',
        license: 'https://opensource.org/licenses/MIT',
        url: CANONICAL,
      }),
    ],
    ['meta', { property: 'og:title', content: 'Pragma — natural-language table queries' }],
    [
      'meta',
      {
        property: 'og:description',
        content:
          'Schema + instruction in, validated TableQuery out. Works with any table library and any AI model.',
      },
    ],
    [
      'meta',
      {
        property: 'og:image',
        content: `${REPO.replace('github.com', 'raw.githubusercontent.com')}/main/website/public/screenshots/results.png`,
      },
    ],
  ],
  markdown: {
    config(md) {
      md.core.ruler.push('pragma-repo-links', (state) => {
        for (const token of state.tokens) {
          for (const child of token.children ?? []) {
            if (child.type !== 'link_open') continue;
            const href = child.attrGet('href');
            const match = href ? REPO_FILE_LINK.exec(href) : null;
            if (match) child.attrSet('href', `${REPO}/blob/main/${match[1]}`);
          }
        }
      });
    },
  },
  themeConfig: {
    logo: { src: '/logo.svg', alt: 'Pragma' },
    nav: [
      { text: 'Guide', link: '/guide/introduction', activeMatch: '/guide/' },
      { text: 'Playground', link: '/guide/playground' },
      { text: 'Reference', link: '/reference/protocol', activeMatch: '/reference/' },
      { text: 'npm', link: 'https://www.npmjs.com/org/avinash-baraiya' },
    ],
    sidebar: {
      '/guide/': [
        {
          text: 'Guide',
          items: [
            { text: 'What is Pragma?', link: '/guide/introduction' },
            { text: 'Getting started', link: '/guide/getting-started' },
            { text: 'Adding an AI model', link: '/guide/ai-models' },
            { text: 'Playground', link: '/guide/playground' },
            { text: 'Feature tour', link: '/guide/screenshots' },
          ],
        },
        { text: 'Reference', items: referenceItems() },
      ],
      '/reference/': [
        { text: 'Reference', items: referenceItems() },
        { text: 'Decisions', items: adrItems() },
      ],
    },
    socialLinks: [{ icon: 'github', link: REPO }],
    search: { provider: 'local' },
    editLink: { pattern: `${REPO}/edit/main/website/:path`, text: 'Edit this page on GitHub' },
    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright © 2026 Avinash Baraiya',
    },
    outline: [2, 3],
  },
  vite: {
    // Workspace packages resolve to their TypeScript sources; the playground is React (TSX).
    resolve: { conditions: ['@pragma/source'] },
    esbuild: { jsx: 'automatic' },
    ssr: { noExternal: [/^@avinash-baraiya\//] },
  },
});

function referenceItems() {
  return [
    { text: 'Architecture', link: '/reference/architecture' },
    { text: 'Protocol', link: '/reference/protocol' },
    { text: 'Schema', link: '/reference/schema' },
    { text: 'Operators', link: '/reference/operators' },
    { text: 'Errors & warnings', link: '/reference/errors' },
    { text: 'Ambiguity', link: '/reference/ambiguity' },
    { text: 'Integration', link: '/reference/integration' },
    { text: 'AI models', link: '/reference/llm' },
    { text: 'Security', link: '/reference/security' },
    { text: 'Performance', link: '/reference/performance' },
    { text: 'Testing', link: '/reference/testing' },
    { text: 'Versioning', link: '/reference/versioning' },
  ];
}

function adrItems() {
  return [
    {
      text: '1. Mutations, not final queries',
      link: '/reference/adr/0001-mutations-not-final-state',
    },
    { text: '2. Filter tree', link: '/reference/adr/0002-filter-tree' },
    { text: '3. Relative dates', link: '/reference/adr/0003-relative-dates-in-protocol' },
    { text: '4. Server-registered schemas', link: '/reference/adr/0004-server-registered-schemas' },
    {
      text: '5. Validator is the authority',
      link: '/reference/adr/0005-validator-is-the-authority',
    },
    {
      text: '6. Deterministic parser first',
      link: '/reference/adr/0006-deterministic-parser-first',
    },
  ];
}
