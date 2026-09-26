import fs from 'fs';
import path from 'path';
import { loadManifest, saveManifest } from './wikiStore.js';

// Deterministic Open Knowledge Format (v0.1) rendering of completed-task
// state shards into a markdown bundle. Pages are regenerated wholesale from
// state every sync — never append-edited — so re-imports and project
// renames/moves can't corrupt or duplicate markdown.

export function slugify(name) {
  const slug = (name || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip combining accents left by NFKD
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return slug || 'untitled';
}

// Keep Todoist content from breaking markdown structure: titles become bold
// bullet text, so newlines collapse and *, _, `, [ etc. get escaped.
export function escapeMd(text) {
  return (text || '')
    .replace(/\s+/g, ' ')
    .replace(/([\\`*_[\]<>#|])/g, '\\$1')
    .trim();
}

function yamlString(value) {
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ')}"`;
}

export function renderFrontmatter(fields) {
  const lines = ['---'];
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      lines.push(`${key}: [${value.join(', ')}]`);
    } else if (key === 'okf_version') {
      lines.push(`${key}: "${value}"`);
    } else {
      lines.push(`${key}: ${yamlString(value)}`);
    }
  }
  lines.push('---', '');
  return lines.join('\n');
}

function visibleCompletions(shard) {
  return Object.values(shard.completions).filter(c => !c.reopened);
}

// Compute each renderable project's directory path (array of slugs) by
// walking parent ids — same ancestor walk as routes/projects.js /list, with
// the same cycle guard. Only projects with visible completions (or with a
// descendant that has some) become tree nodes; shards whose project metadata
// was never resolvable render under _unknown/.
export function buildTree(shards) {
  const withCompletions = new Set(
    [...shards.values()].filter(s => visibleCompletions(s).length > 0).map(s => s.project.id)
  );

  // A project is included if it, or any descendant, has completions.
  const included = new Set();
  for (const id of withCompletions) {
    let cur = shards.get(id);
    let guard = 0;
    while (cur && guard++ < 20 && !included.has(cur.project.id)) {
      included.add(cur.project.id);
      cur = cur.project.parentId ? shards.get(cur.project.parentId) : null;
    }
  }

  const nodes = new Map(); // id -> { shard, children: [], dirParts: [] }
  for (const id of included) {
    nodes.set(id, { shard: shards.get(id), children: [] });
  }
  const roots = [];
  for (const node of nodes.values()) {
    const { parentId, name } = node.shard.project;
    const parent = parentId && nodes.get(parentId);
    node.unknown = name == null;
    if (parent && !node.unknown) parent.children.push(node);
    else roots.push(node);
  }

  const byName = (a, b) => (a.shard.project.name || '').localeCompare(b.shard.project.name || '');
  const assignPaths = (siblings, parentParts) => {
    siblings.sort(byName);
    const used = new Set();
    for (const node of siblings) {
      const p = node.shard.project;
      let slug = node.unknown ? `project-${p.id}` : slugify(p.name);
      if (used.has(slug)) slug = `${slug}-${p.id.slice(-6).toLowerCase()}`;
      used.add(slug);
      node.dirParts = node.unknown ? ['_unknown', slug] : [...parentParts, slug];
      assignPaths(node.children, node.dirParts);
    }
  };
  assignPaths(roots, []);

  return { roots, nodes };
}

function dateOf(iso) {
  return (iso || '').slice(0, 10);
}

function timeOf(iso) {
  return (iso || '').slice(11, 16);
}

function completionStats(shard) {
  const stamps = visibleCompletions(shard).map(c => c.completedAt).sort();
  const newest = stamps[stamps.length - 1];
  return { count: stamps.length, first: dateOf(stamps[0]), last: dateOf(newest), newest };
}

function projectTags(project) {
  const tags = ['todoist-project'];
  if (project.archived) tags.push('archived');
  if (project.deleted) tags.push('deleted');
  return tags;
}

function describe(shard) {
  const { count, last } = completionStats(shard);
  if (!count) return 'Todoist project (no completed tasks recorded).';
  return `Todoist project — ${count} completed task${count === 1 ? '' : 's'}, most recent ${last}.`;
}

// names: Map<uid, display name>; ownerUid: account owner — attribution is
// shown only for completions by someone else.
export function renderLogPage(node, { names, ownerUid }) {
  const { shard } = node;
  const completions = visibleCompletions(shard)
    .sort((a, b) => b.completedAt.localeCompare(a.completedAt));
  const title = shard.project.name ?? `Unknown project ${shard.project.id}`;

  const lines = [
    renderFrontmatter({
      type: 'log',
      title: `${title} — completed tasks`,
      timestamp: completions[0]?.completedAt,
    }),
    `# ${escapeMd(title)} — completed tasks`,
    '',
  ];

  let currentDate = null;
  for (const c of completions) {
    const day = dateOf(c.completedAt);
    if (day !== currentDate) {
      currentDate = day;
      lines.push(`## ${day}`, '');
    }
    let entry = `- **${escapeMd(c.content)}**`;
    const sectionName = c.sectionId && shard.sections[c.sectionId];
    if (sectionName) entry += ` *(Section: ${escapeMd(sectionName)})*`;
    entry += ` — completed ${timeOf(c.completedAt)} UTC`;
    if (c.completedByUid && ownerUid && c.completedByUid !== ownerUid) {
      entry += `, by ${escapeMd(names.get(c.completedByUid) || `user ${c.completedByUid}`)}`;
    }
    lines.push(entry);
    if (c.description) {
      for (const dl of c.description.split('\n')) {
        lines.push(`  > ${dl.replace(/([\\`#|])/g, '\\$1')}`);
      }
    }
    if (c.comments.length) {
      lines.push('  - Comments:');
      for (const cm of c.comments) {
        lines.push(`    - ${dateOf(cm.postedAt)}: ${escapeMd(cm.content)}`);
      }
    }
    lines.push('');
  }

  if (!completions.length) lines.push('_No completed tasks recorded._', '');
  return lines.join('\n');
}

export function renderIndexPage(node, { parentName }) {
  const { shard, children, dirParts } = node;
  const p = shard.project;
  const title = p.name ?? `Unknown project ${p.id}`;
  const stats = completionStats(shard);
  const dir = `/${dirParts.join('/')}`;

  const lines = [
    renderFrontmatter({
      type: 'concept',
      title,
      description: describe(shard),
      tags: projectTags(p),
      resource: p.name != null && !p.deleted
        ? `https://app.todoist.com/app/project/${p.id}` : undefined,
      // Newest completion, not "now" — keeps no-op regenerations byte-identical
      timestamp: stats.newest,
    }),
    `# ${escapeMd(title)}`,
    '',
  ];

  const flags = [p.archived && 'archived', p.deleted && 'deleted in Todoist'].filter(Boolean);
  let intro = parentName ? `Todoist project under **${escapeMd(parentName)}**.` : 'Todoist project.';
  if (flags.length) intro += ` (${flags.join(', ')})`;
  if (stats.count) {
    intro += ` ${stats.count} task${stats.count === 1 ? '' : 's'} completed between ${stats.first} and ${stats.last}.`;
  }
  lines.push(intro, '');

  if (stats.count) {
    lines.push(`* [Completed task log](${dir}/log.md) - chronological record of everything done`);
  }
  for (const child of children) {
    lines.push(`* [${escapeMd(child.shard.project.name)}](/${child.dirParts.join('/')}/index.md) - ${describe(child.shard)}`);
  }
  lines.push('');
  return lines.join('\n');
}

export function renderRoot(roots, { newest }) {
  const lines = [
    renderFrontmatter({
      okf_version: '0.1',
      type: 'index',
      title: 'Completed-task bible',
      description: 'Auto-maintained record of completed Todoist tasks, organized by project.',
      // Newest completion anywhere, not "now" — no-op syncs stay byte-identical
      timestamp: newest,
    }),
    '# Completed-task bible',
    '',
    'A record of everything completed in Todoist, one directory per project,',
    'mirroring the Todoist project hierarchy (archived projects included, tagged',
    '`archived`). Each project has an `index.md` and a chronological `log.md`.',
    'Maintained automatically by todoist-triage — do not edit by hand.',
    '',
    '# Projects',
    '',
  ];
  const real = roots.filter(n => !n.unknown);
  const unknown = roots.filter(n => n.unknown);
  for (const node of real) {
    lines.push(`* [${escapeMd(node.shard.project.name)}](/${node.dirParts.join('/')}/index.md) - ${describe(node.shard)}`);
  }
  if (unknown.length) {
    lines.push('', '# Unresolved projects', '');
    for (const node of unknown) {
      lines.push(`* [${node.dirParts[1]}](/${node.dirParts.join('/')}/index.md) - ${describe(node.shard)}`);
    }
  }
  lines.push('');
  return lines.join('\n');
}

// Render every page, write only byte-changed files, delete files that the
// previous manifest generated but this pass didn't (renames/moves), prune
// empty directories. Returns true if anything on disk changed.
export function regenerate(shards, root, { names, ownerUid }) {
  const { roots, nodes } = buildTree(shards);

  let newest;
  for (const shard of shards.values()) {
    for (const c of Object.values(shard.completions)) {
      if (!c.reopened && (!newest || c.completedAt > newest)) newest = c.completedAt;
    }
  }

  const pages = new Map(); // relPath -> content
  pages.set('bible.md', renderRoot(roots, { newest }));
  for (const node of nodes.values()) {
    const dir = node.dirParts.join('/');
    const parent = node.shard.project.parentId && nodes.get(node.shard.project.parentId);
    pages.set(`${dir}/index.md`, renderIndexPage(node, {
      parentName: node.unknown ? null : parent?.shard.project.name ?? null,
    }));
    if (visibleCompletions(node.shard).length) {
      pages.set(`${dir}/log.md`, renderLogPage(node, { names, ownerUid }));
    }
  }

  let changed = false;
  for (const [rel, content] of pages) {
    const abs = path.join(root, rel);
    let existing = null;
    try {
      existing = fs.readFileSync(abs, 'utf8');
    } catch {}
    if (existing !== content) {
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, content);
      changed = true;
    }
  }

  const manifest = loadManifest();
  for (const rel of manifest.files) {
    if (pages.has(rel)) continue;
    try {
      fs.unlinkSync(path.join(root, rel));
      changed = true;
    } catch {}
    // Prune now-empty parent directories up to the wiki root.
    let dir = path.dirname(path.join(root, rel));
    while (dir.startsWith(root) && dir !== root) {
      try {
        fs.rmdirSync(dir); // throws if non-empty — that's the stop condition
      } catch {
        break;
      }
      dir = path.dirname(dir);
    }
  }
  saveManifest({ files: [...pages.keys()].sort() });

  return changed;
}
