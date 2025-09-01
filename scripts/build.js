#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

let content;
try {
  // Prefer precompiled output (tsc) in build-ts
  const compiledPath = path.join(__dirname, '..', 'build-ts', 'content.js');
  if (fs.existsSync(compiledPath)) {
    const mod = require(compiledPath);
    content = mod.content || mod.default;
  } else {
    // Fallback: on-the-fly via ts-node (dev convenience)
    try {
      require('ts-node/register');
      const tsContent = require(path.join(__dirname, '..', 'content', 'content.ts'));
      content = tsContent.content || tsContent.default;
    } catch (e) {
      console.error('Could not load TypeScript content (no compiled file, ts-node fallback failed).');
      console.error(e);
      process.exit(1);
    }
  }
} catch (e) {
  console.error('Failed to load content module', e);
  process.exit(1);
}

const root = process.cwd();
const templatePath = path.join(root, 'index.html');
const outDir = path.join(root, 'dist');
const outFile = path.join(outDir, 'index.html');

function escapeHtml(str = '') {
  return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function tokenReplace(html, map) {
  return Object.entries(map).reduce((acc, [k, v]) => acc.replace(new RegExp(k.replace(/[.*+?^${}()|[\]\\]/g, r => `\\${r}`), 'g'), v), html);
}

function buildProjectItem(item) {
  const badgeClass = item.status === 'live' ? 'badge live' : item.status === 'prototype' ? 'badge prototype' : 'badge';
  const links = (item.links || []).map(l => `<a href="${escapeHtml(l.url)}" target="_blank" class="${escapeHtml(l.type)}" data-preview="${l.type === 'repo' ? 'false' : 'true'}"><span>${escapeHtml(l.label)}</span></a>`).join('\n                        ');
  return `<li class="project-item" id="${escapeHtml(item.id)}">
                <div class="project-content">
                    <div class="project-header">
                        <span class="name">${escapeHtml(item.name)}</span>${item.badgeLabel ? `<span class="${badgeClass}">${escapeHtml(item.badgeLabel)}</span>` : ''}
                    </div>
                    <div class="project-tagline">${escapeHtml(item.tagline)}</div>
                    <div class="project-desc">${escapeHtml(item.description)}</div>
                    <div class="project-links">
                        ${links}
                    </div>
                </div>
            </li>`;
}

function main() {
  if (!fs.existsSync(templatePath)) {
    console.error('Template index.html not found.');
    process.exit(1);
  }
  let html = fs.readFileSync(templatePath, 'utf8');

  const projectsHtml = content.sections.projects.items.map(buildProjectItem).join('\n');
  const experimentsHtml = content.sections.experiments.items.map(buildProjectItem).join('\n');

  const tokens = {
    '__META_TITLE__': escapeHtml(content.meta.title),
    '__META_DESCRIPTION__': escapeHtml(content.meta.description),
    '__META_KEYWORDS__': escapeHtml(content.meta.keywords),
    '__META_AUTHOR__': escapeHtml(content.meta.author),
    '__META_ROBOTS__': escapeHtml(content.meta.robots),
    '__OG_TITLE__': escapeHtml(content.meta.og.title),
    '__OG_DESCRIPTION__': escapeHtml(content.meta.og.description),
    '__OG_TYPE__': escapeHtml(content.meta.og.type),
    '__OG_URL__': escapeHtml(content.meta.og.url),
    '__OG_IMAGE__': escapeHtml(content.meta.og.image),
    '__OG_SITE_NAME__': escapeHtml(content.meta.og.site_name),
    '__TW_CARD__': escapeHtml(content.meta.twitter.card),
    '__TW_TITLE__': escapeHtml(content.meta.twitter.title),
    '__TW_DESCRIPTION__': escapeHtml(content.meta.twitter.description),
    '__TW_IMAGE__': escapeHtml(content.meta.twitter.image),
    '__LD_NAME__': escapeHtml(content.header.name),
    '__LD_JOB_TITLE__': escapeHtml(content.header.tagline),
    '__LD_URL__': escapeHtml(content.meta.og.url),
    '<!-- SITE_NAME -->': escapeHtml(content.header.name),
    '<!-- SITE_TAGLINE -->': escapeHtml(content.header.tagline),
    '<!-- SITE_OBJECTIVE -->': escapeHtml(content.header.objective),
    '<!-- PROJECTS_TITLE -->': escapeHtml(content.sections.projects.title),
    '<!-- EXPERIMENTS_TITLE -->': escapeHtml(content.sections.experiments.title),
    '<!-- PROJECTS_INJECT -->': projectsHtml,
    '<!-- EXPERIMENTS_INJECT -->': experimentsHtml,
    '<!-- NEWSLETTER_PLACEHOLDER -->': `<input type="email" name="email" placeholder="${escapeHtml(content.newsletter.emailPlaceholder)}" required>\n                <button type="submit">${escapeHtml(content.newsletter.submitLabel)}</button>`
  };

  html = tokenReplace(html, tokens);

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(outFile, html, 'utf8');
  console.log('Built dist/index.html');
}

main();
