import express from 'express';
import {
  getProjects,
  getTasksForProject,
  getOrCreateTopLevelProject,
  moveProjectToParent,
  archiveProject,
  unarchiveProject,
  collectDescendantIds,
} from '../services/todoist.js';
import { recordKeep, getRecentlyKeptIds } from '../services/projectDecisions.js';

const router = express.Router();

const TASK_FETCH_CONCURRENCY = 15;

async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const i = nextIndex++;
      results[i] = await fn(items[i]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

router.get('/review-queue', async (req, res) => {
  try {
    const projects = await getProjects();
    const byId = new Map(projects.map(p => [p.id, p]));

    const inbox = projects.find(p => p.inbox_project);
    const backlog = projects.find(p => !p.parent_id && p.name.toLowerCase() === 'backlog');
    const someday = projects.find(p => !p.parent_id && p.name.toLowerCase() === 'someday');

    const excludeRoots = [inbox, backlog, someday].filter(Boolean).map(p => p.id);
    const excluded = collectDescendantIds(projects, excludeRoots);

    // Skip projects the user already swiped "Keep" on within the last 7 days,
    // so a re-run later the same week doesn't re-ask about them.
    const recentlyKept = getRecentlyKeptIds();

    const reviewable = projects
      .filter(p => !excluded.has(p.id) && !p.is_archived && !recentlyKept.has(p.id))
      // Top-level (no-parent) projects first, then most recently created first within each group.
      .sort((a, b) => {
        const aTop = a.parent_id ? 1 : 0;
        const bTop = b.parent_id ? 1 : 0;
        if (aTop !== bTop) return aTop - bTop;
        return (b.created_at ?? '').localeCompare(a.created_at ?? '');
      });

    const queue = await mapWithConcurrency(reviewable, TASK_FETCH_CONCURRENCY, async project => {
      const tasks = await getTasksForProject(project.id);
      const sampleTasks = [...tasks]
        .sort((a, b) => a.child_order - b.child_order)
        .slice(0, 3)
        .map(t => ({ id: t.id, content: t.content, description: t.description ?? '' }));
      const parentName = project.parent_id ? (byId.get(project.parent_id)?.name ?? null) : null;
      return {
        id: project.id,
        name: project.name,
        parentId: project.parent_id ?? null,
        parentName,
        sampleTasks,
        openTasks: tasks.map(t => ({
          id: t.id,
          content: t.content,
          description: t.description ?? '',
        })),
      };
    });

    res.json({ queue });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Flat list of all live projects with their ancestor path — feeds the
// "move under a parent" picker on each review card.
router.get('/list', async (req, res) => {
  try {
    const projects = await getProjects();
    const byId = new Map(projects.map(p => [p.id, p]));
    const list = projects
      .filter(p => !p.is_archived && !p.inbox_project)
      .map(p => {
        const ancestors = [];
        let cur = p.parent_id ? byId.get(p.parent_id) : null;
        let guard = 0;
        while (cur && guard++ < 20) {
          ancestors.unshift(cur.name);
          cur = cur.parent_id ? byId.get(cur.parent_id) : null;
        }
        return { id: p.id, name: p.name, parentId: p.parent_id ?? null, path: ancestors.join(' / ') };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
    res.json({ projects: list });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Move a project under a parent. parentId null/omitted = move to top level
// (the Back-button undo relies on this to restore an originally top-level project).
router.post('/:id/move', async (req, res) => {
  try {
    const { parentId = null } = req.body;
    if (parentId === req.params.id) {
      return res.status(400).json({ error: 'a project cannot be its own parent' });
    }
    await moveProjectToParent(req.params.id, parentId);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/keep', (req, res) => {
  recordKeep(req.params.id);
  res.json({ ok: true });
});

router.post('/:id/backlog', async (req, res) => {
  try {
    const backlog = await getOrCreateTopLevelProject('Backlog');
    await moveProjectToParent(req.params.id, backlog.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/someday', async (req, res) => {
  try {
    const someday = await getOrCreateTopLevelProject('Someday');
    await moveProjectToParent(req.params.id, someday.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Archiving a project in Todoist cascades to its sub-projects, so promote any
// direct children up to this project's own parent (or top-level) first —
// that way the archive only ever affects the single project being archived.
router.post('/:id/archive', async (req, res) => {
  try {
    const projects = await getProjects();
    const project = projects.find(p => p.id === req.params.id);
    const children = projects.filter(p => p.parent_id === req.params.id);
    for (const child of children) {
      await moveProjectToParent(child.id, project?.parent_id ?? null);
    }
    await archiveProject(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Undo helper for the Back button. Archiving clears parent_id, so optionally
// pass the project's pre-archive parentId (captured in the review queue) to
// restore it to its original spot — null means it was top-level.
router.post('/:id/unarchive', async (req, res) => {
  try {
    await unarchiveProject(req.params.id);
    const { parentId } = req.body;
    if (parentId !== undefined) {
      await moveProjectToParent(req.params.id, parentId);
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
