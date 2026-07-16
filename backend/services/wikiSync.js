import fs from 'fs';
import path from 'path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  getProjects,
  getArchivedProjects,
  getCompletedTasks,
  getComments,
  getSections,
  getUser,
  getCollaborators,
} from './todoist.js';
import {
  wikiRoot,
  loadSyncState,
  saveSyncState,
  loadAllShards,
  saveShard,
  newShard,
  upsertCompletion,
  completionKey,
} from './wikiStore.js';
import { regenerate } from './okf.js';

const execFileP = promisify(execFile);

const WINDOW_DAYS = 89; // Todoist caps completed-task queries at 3 months
const TRAILING_DAYS = 7; // periodic tick always re-scans this far back (heals downtime)
const DAY_MS = 86_400_000;
const THROTTLE_MS = 1_000; // pacing for bulk passes — ~60 req/min, well under 1000/15min

const sleep = ms => new Promise(r => setTimeout(r, ms));
const iso = ms => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

// Backfill and the periodic tick share the same import path (upsertItems →
// idempotent upsertCompletion keyed taskId|completedAt), so re-scanning any
// window is always safe. This flag just keeps them from interleaving.
let isSyncing = false;

function applyProjectMeta(ctx, project, archived) {
  let shard = ctx.shards.get(project.id);
  if (!shard) {
    shard = newShard(project);
    shard.project.archived = archived;
    ctx.shards.set(project.id, shard);
    ctx.dirty.add(project.id);
    return;
  }
  const next = {
    id: project.id,
    name: project.name,
    parentId: project.parent_id ?? null,
    archived,
    deleted: false,
  };
  if (JSON.stringify(shard.project) !== JSON.stringify(next)) {
    shard.project = next;
    ctx.dirty.add(project.id);
  }
}

// Upsert feed items into shards; returns the set of "projectId|taskId|completedAt"
// keys seen, for reopen reconciliation.
function upsertItems(ctx, items) {
  const seen = new Set();
  for (const item of items) {
    let shard = ctx.shards.get(item.project_id);
    if (!shard) {
      // Completion in a project we have no metadata for (deleted long ago) —
      // renders under _unknown/ until/unless the project resolves.
      shard = newShard({ id: item.project_id, name: null });
      ctx.shards.set(item.project_id, shard);
    }
    if (upsertCompletion(shard, item)) ctx.dirty.add(item.project_id);
    seen.add(`${item.project_id}|${completionKey(item)}`);
  }
  return seen;
}

// A stored completion inside the freshly re-scanned window that the feed no
// longer returns was reopened (and not re-completed). Soft-flag it — never
// hard-delete. Only for projects in the current ACTIVE list: archived and
// deleted projects are excluded from the unfiltered feed by design, so their
// absence means nothing.
function reconcileReopens(ctx, sinceIso, untilIso, seen, activeIds) {
  for (const id of activeIds) {
    const shard = ctx.shards.get(id);
    if (!shard) continue;
    for (const [key, c] of Object.entries(shard.completions)) {
      if (c.reopened) continue;
      if (c.completedAt >= sinceIso && c.completedAt < untilIso && !seen.has(`${id}|${key}`)) {
        c.reopened = true;
        ctx.dirty.add(id);
      }
    }
  }
}

async function refreshSections(ctx, { throttleMs = 0 } = {}) {
  for (const shard of ctx.shards.values()) {
    const unresolved = new Set(
      Object.values(shard.completions)
        .map(c => c.sectionId)
        .filter(sid => sid && !(sid in shard.sections))
    );
    if (!unresolved.size) continue;
    if (throttleMs) await sleep(throttleMs);
    try {
      const sections = await getSections(shard.project.id);
      for (const s of sections) shard.sections[s.id] = s.name;
    } catch (err) {
      console.warn(`[wiki] sections lookup failed for ${shard.project.id}: ${err.message}`);
    }
    // Cache misses as null (best-effort — section may be deleted); avoids
    // refetching every tick.
    for (const sid of unresolved) {
      if (!(sid in shard.sections)) shard.sections[sid] = null;
    }
    ctx.dirty.add(shard.project.id);
  }
}

async function refreshComments(ctx, { throttleMs = 0, log = () => {} } = {}) {
  let fetched = 0;
  for (const shard of ctx.shards.values()) {
    for (const c of Object.values(shard.completions)) {
      if ((c.noteCount ?? 0) === 0 || (c.commentsFetchedFor ?? 0) >= c.noteCount) continue;
      if (throttleMs) await sleep(throttleMs);
      try {
        const comments = await getComments(c.taskId);
        c.comments = comments
          .map(cm => ({ postedAt: cm.posted_at ?? '', content: cm.content ?? '' }))
          .sort((a, b) => a.postedAt.localeCompare(b.postedAt));
        c.commentsFetchedFor = c.noteCount;
        ctx.dirty.add(shard.project.id);
        fetched++;
      } catch (err) {
        console.warn(`[wiki] comments fetch failed for task ${c.taskId}: ${err.message}`);
      }
    }
  }
  if (fetched) log(`  fetched comments for ${fetched} task(s)`);
  return fetched;
}

async function loadIdentity() {
  const [user, collaborators] = await Promise.all([getUser(), getCollaborators()]);
  const names = new Map(collaborators.map(c => [c.id, c.full_name || c.email]));
  return { ownerUid: user?.id ?? null, names };
}

async function gitCommit(root, message) {
  if ((process.env.WIKI_GIT_AUTOCOMMIT ?? 'true') === 'false') return;
  try {
    if (!fs.existsSync(path.join(root, '.git'))) {
      await execFileP('git', ['-C', root, 'init']);
    }
    await execFileP('git', ['-C', root, 'add', '-A']);
    try {
      await execFileP('git', ['-C', root, 'diff', '--cached', '--quiet']);
      return; // nothing staged
    } catch {
      // staged changes exist
    }
    await execFileP('git', ['-C', root, 'commit', '-m', message]);
  } catch (err) {
    console.warn(`[wiki] git auto-commit failed: ${err.message}`);
  }
}

function saveDirty(ctx) {
  for (const id of ctx.dirty) saveShard(ctx.shards.get(id));
  ctx.dirty.clear();
}

async function regenerateAndCommit(ctx, root, message) {
  const identity = await loadIdentity();
  const changed = regenerate(ctx.shards, root, identity);
  if (changed) await gitCommit(root, message);
  return changed;
}

// Periodic tick: re-scan a trailing window of the completed-task feed (wide
// enough to patch anything missed while the server was down), refresh project
// metadata, and regenerate the wiki if anything changed.
export async function runSyncTick() {
  if (isSyncing) return { skipped: true };
  isSyncing = true;
  try {
    const root = wikiRoot();
    fs.mkdirSync(root, { recursive: true });
    const state = loadSyncState();
    const now = Date.now();
    const nowIso = iso(now);
    const ctx = { shards: loadAllShards(), dirty: new Set() };

    const projects = await getProjects();
    const activeIds = new Set(projects.map(p => p.id));
    for (const p of projects) applyProjectMeta(ctx, p, false);

    const sinceMs = Math.min(
      state.lastSyncAt ? Date.parse(state.lastSyncAt) : now,
      now - TRAILING_DAYS * DAY_MS
    );
    const sinceIso = iso(sinceMs);
    const seen = new Set();
    for (let w0 = sinceMs; w0 < now; w0 += WINDOW_DAYS * DAY_MS) {
      const w1 = Math.min(w0 + WINDOW_DAYS * DAY_MS, now);
      const items = await getCompletedTasks({ since: iso(w0), until: iso(w1) });
      for (const k of upsertItems(ctx, items)) seen.add(k);
    }
    reconcileReopens(ctx, sinceIso, nowIso, seen, activeIds);

    // Daily: refresh the archived list (also the only way to tell archived
    // apart from deleted). Weekly: per-archived-project trailing scan, since
    // archived projects' completions never appear in the unfiltered feed.
    if (!state.lastArchivedScanAt || now - Date.parse(state.lastArchivedScanAt) > DAY_MS) {
      const archived = await getArchivedProjects();
      const archivedIds = new Set(archived.map(p => p.id));
      for (const p of archived) applyProjectMeta(ctx, p, true);
      for (const shard of ctx.shards.values()) {
        const p = shard.project;
        if (p.name != null && !p.deleted && !activeIds.has(p.id) && !archivedIds.has(p.id)) {
          p.deleted = true;
          ctx.dirty.add(p.id);
        }
      }
      state.lastArchivedScanAt = nowIso;

      if (!state.lastArchivedDeepScanAt || now - Date.parse(state.lastArchivedDeepScanAt) > 7 * DAY_MS) {
        console.log(`[wiki] weekly trailing scan of ${archived.length} archived project(s)`);
        for (const p of archived) {
          await sleep(THROTTLE_MS);
          const items = await getCompletedTasks({
            projectId: p.id,
            since: iso(now - WINDOW_DAYS * DAY_MS),
            until: nowIso,
          });
          upsertItems(ctx, items);
        }
        state.lastArchivedDeepScanAt = nowIso;
      }
    }

    await refreshSections(ctx);
    await refreshComments(ctx);

    const dirtyCount = ctx.dirty.size;
    saveDirty(ctx);
    let filesChanged = false;
    if (dirtyCount > 0 || !fs.existsSync(path.join(root, 'bible.md'))) {
      filesChanged = await regenerateAndCommit(ctx, root, `Sync completed tasks (${nowIso})`);
    }
    state.lastSyncAt = nowIso;
    saveSyncState(state);
    if (filesChanged) console.log(`[wiki] sync updated ${dirtyCount} project(s)`);
    return { changed: filesChanged, dirtyProjects: dirtyCount };
  } catch (err) {
    console.error(`[wiki] sync tick failed: ${err.message}`);
    return { error: err.message };
  } finally {
    isSyncing = false;
  }
}

// One-time (re-runnable, idempotent) backfill of all retrievable history.
// Pass 1: the unfiltered feed covers every non-archived project, sliding
//   3-month windows back from now until a year of empty windows (or the floor).
// Pass 2: archived projects are invisible to the unfiltered feed, so each is
//   queried directly over its created_at → updated_at lifespan (an archived
//   project can't gain completions after archival, which bumps updated_at).
// Pass 3: comments for every completion that has notes.
export async function backfillAll({ since, dryRun = false, log = console.log } = {}) {
  if (isSyncing) throw new Error('a wiki sync is already running');
  isSyncing = true;
  try {
    const root = wikiRoot();
    if (!dryRun) fs.mkdirSync(root, { recursive: true });
    const now = Date.now();
    const nowIso = iso(now);
    const floorMs = Date.parse(since ?? '2007-01-01T00:00:00Z');
    if (Number.isNaN(floorMs)) throw new Error(`invalid --since date: ${since}`);
    const ctx = { shards: dryRun ? new Map() : loadAllShards(), dirty: new Set() };
    const persist = () => { if (!dryRun) saveDirty(ctx); };

    const projects = await getProjects();
    for (const p of projects) applyProjectMeta(ctx, p, false);
    const archived = await getArchivedProjects();
    for (const p of archived) applyProjectMeta(ctx, p, true);
    persist();
    log(`${projects.length} active + ${archived.length} archived projects${dryRun ? ' (dry run — nothing will be written)' : ''}`);

    log('Pass 1: unfiltered completed-task feed, 3-month windows back from now');
    let emptyStreak = 0;
    let total = 0;
    for (let until = now; until > floorMs && emptyStreak < 4; ) {
      const w0 = Math.max(until - WINDOW_DAYS * DAY_MS, floorMs);
      await sleep(THROTTLE_MS);
      const items = await getCompletedTasks({ since: iso(w0), until: iso(until) });
      emptyStreak = items.length ? 0 : emptyStreak + 1;
      total += items.length;
      upsertItems(ctx, items);
      log(`  ${iso(w0).slice(0, 10)} → ${iso(until).slice(0, 10)}: ${items.length}`);
      persist();
      until = w0;
    }
    log(`Pass 1 done: ${total} completions${emptyStreak >= 4 ? ' (stopped after 4 empty windows)' : ''}`);

    log(`Pass 2: ${archived.length} archived project(s), scanned over each one's lifespan`);
    for (const p of archived) {
      const start = Math.max(floorMs, (Date.parse(p.created_at) || floorMs) - WINDOW_DAYS * DAY_MS);
      const end = Math.min(now, (Date.parse(p.updated_at) || now) + TRAILING_DAYS * DAY_MS);
      let count = 0;
      for (let w0 = start; w0 < end; w0 += WINDOW_DAYS * DAY_MS) {
        const w1 = Math.min(w0 + WINDOW_DAYS * DAY_MS, end);
        await sleep(THROTTLE_MS);
        const items = await getCompletedTasks({ projectId: p.id, since: iso(w0), until: iso(w1) });
        count += items.length;
        upsertItems(ctx, items);
      }
      total += count;
      if (count) log(`  ${p.name}: ${count}`);
      persist();
    }

    log('Pass 3: comments for completions with notes');
    const withNotes = await refreshComments(ctx, { throttleMs: THROTTLE_MS, log });
    await refreshSections(ctx, { throttleMs: THROTTLE_MS });
    persist();

    if (dryRun) {
      log(`Dry run complete: ${total} completions across ${ctx.shards.size} project(s), ${withNotes} with comments.`);
      return { total, dryRun: true };
    }

    await regenerateAndCommit(ctx, root, `Backfill completed-task wiki (${nowIso})`);
    const state = loadSyncState();
    state.lastSyncAt = nowIso;
    state.lastArchivedScanAt = nowIso;
    state.lastArchivedDeepScanAt = nowIso;
    state.backfillDone = true;
    saveSyncState(state);
    log(`Backfill complete: ${total} completions → ${root}`);
    return { total };
  } finally {
    isSyncing = false;
  }
}

export function startWikiSyncTimer() {
  if (process.env.WIKI_ENABLED === 'false') {
    console.warn('[wiki] WIKI_ENABLED=false — completed-task wiki sync disabled');
    return;
  }
  const minutes = Number(process.env.WIKI_SYNC_INTERVAL_MINUTES) || 15;
  // First run shortly after boot so downtime gaps heal promptly.
  setTimeout(runSyncTick, 30_000);
  setInterval(runSyncTick, minutes * 60_000);
  console.log(`[wiki] syncing completed tasks to ${wikiRoot()} every ${minutes}m`);
}
