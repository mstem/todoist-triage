import fs from 'fs';
import path from 'path';
import os from 'os';

// State for the completed-task wiki lives INSIDE the wiki repo (.state/) so
// the bundle is self-contained and recoverable — unlike backend/data/, which
// holds app triage decisions.
export function wikiRoot() {
  const raw = process.env.WIKI_PATH || '~/Projects/bible.md';
  return raw.startsWith('~') ? path.join(os.homedir(), raw.slice(1)) : raw;
}

const stateDir = () => path.join(wikiRoot(), '.state');
const shardsDir = () => path.join(stateDir(), 'projects');
const syncFile = () => path.join(stateDir(), 'sync.json');
const manifestFile = () => path.join(stateDir(), 'manifest.json');

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

export function loadSyncState() {
  return readJson(syncFile(), {});
}

export function saveSyncState(state) {
  writeJson(syncFile(), state);
}

export function loadManifest() {
  return readJson(manifestFile(), { files: [] });
}

export function saveManifest(manifest) {
  writeJson(manifestFile(), manifest);
}

export function loadShard(projectId) {
  return readJson(path.join(shardsDir(), `${projectId}.json`), null);
}

export function saveShard(shard) {
  writeJson(path.join(shardsDir(), `${shard.project.id}.json`), shard);
}

export function loadAllShards() {
  let files;
  try {
    files = fs.readdirSync(shardsDir()).filter(f => f.endsWith('.json'));
  } catch {
    return new Map();
  }
  const shards = new Map();
  for (const f of files) {
    const shard = readJson(path.join(shardsDir(), f), null);
    if (shard?.project?.id) shards.set(shard.project.id, shard);
  }
  return shards;
}

export function newShard(project) {
  return {
    project: {
      id: project.id,
      name: project.name,
      parentId: project.parent_id ?? null,
      archived: !!project.is_archived,
      deleted: false,
    },
    sections: {},
    completions: {},
  };
}

export function completionKey(item) {
  return `${item.id}|${item.completed_at}`;
}

// Upsert one completed-task feed item into its shard. Returns true if the
// stored record changed (new completion, edited content, or a note_count
// bump that flags comments for re-fetch).
export function upsertCompletion(shard, item) {
  const key = completionKey(item);
  const existing = shard.completions[key];
  const record = {
    taskId: item.id,
    content: item.content,
    description: item.description || '',
    completedAt: item.completed_at,
    completedByUid: item.completed_by_uid ?? null,
    sectionId: item.section_id ?? null,
    noteCount: item.note_count ?? 0,
    comments: existing?.comments ?? [],
    // note_count we last fetched comments at — avoids refetch loops when the
    // API returns fewer comments than note_count claims (deleted comments)
    commentsFetchedFor: existing?.commentsFetchedFor ?? 0,
    reopened: false,
  };
  if (existing && JSON.stringify(existing) === JSON.stringify(record)) return false;
  shard.completions[key] = record;
  return true;
}
