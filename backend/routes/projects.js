import express from 'express';
import {
  getProjects,
  getAllTasks,
  getOrCreateTopLevelProject,
  moveProjectToParent,
  archiveProject,
  unarchiveProject,
  updateProjectColor,
  updateProjectDescription,
  collectDescendantIds,
} from '../services/todoist.js';
import {
  recordKeep,
  getRecentlyKeptIds,
  recordBacklogged,
  clearBacklogged,
  getBackloggedEntry,
  getBackloggedIds,
  recordHide,
  clearHide,
  getHiddenIds,
} from '../services/projectDecisions.js';

const router = express.Router();

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
    const backlogged = getBackloggedIds();
    const hidden = getHiddenIds();

    // The CTFG tree is big enough to swamp a review session, so it sinks to the
    // end of the queue regardless of how the rest sorts.
    const ctfgRoots = projects.filter(p => p.name.trim().toLowerCase() === 'ctfg').map(p => p.id);
    const ctfg = collectDescendantIds(projects, ctfgRoots);

    const reviewable = projects
      .filter(p => !excluded.has(p.id) && !p.is_archived && !recentlyKept.has(p.id) && !backlogged.has(p.id) && !hidden.has(p.id))
      // CTFG last, then top-level (no-parent) projects first, then most recently created first within each group.
      .sort((a, b) => {
        const aCtfg = ctfg.has(a.id) ? 1 : 0;
        const bCtfg = ctfg.has(b.id) ? 1 : 0;
        if (aCtfg !== bCtfg) return aCtfg - bCtfg;
        const aTop = a.parent_id ? 1 : 0;
        const bTop = b.parent_id ? 1 : 0;
        if (aTop !== bTop) return aTop - bTop;
        return (b.created_at ?? '').localeCompare(a.created_at ?? '');
      });

    // One sweep of all active tasks, grouped locally, instead of a /tasks call
    // per project — that fan-out was ~150 concurrent requests per load and drew
    // 502s from Todoist's rate limiter.
    const tasksByProject = new Map();
    for (const task of await getAllTasks()) {
      const bucket = tasksByProject.get(task.project_id);
      if (bucket) bucket.push(task);
      else tasksByProject.set(task.project_id, [task]);
    }

    const queue = reviewable.map(project => {
      const tasks = tasksByProject.get(project.id) ?? [];
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

// Called once when the review deck runs out, with the ids swiped "Keep" during
// that session. Each kept project gets `@active` appended to its Todoist
// description, leaving whatever was already written there in place. Projects
// that already carry the tag are left untouched, so re-reviewing a project
// week after week doesn't stack up copies.
const ACTIVE_TAG = '@active';
const ACTIVE_TAG_PATTERN = /(^|\s)@active(\s|$)/i;

router.post('/review-complete', async (req, res) => {
  try {
    const { projectIds } = req.body ?? {};
    if (!Array.isArray(projectIds)) {
      return res.status(400).json({ error: 'projectIds must be an array' });
    }
    const ids = [...new Set(projectIds.filter(id => typeof id === 'string'))];
    if (ids.length === 0) {
      return res.json({ tagged: 0, alreadyTagged: 0, failed: [] });
    }

    const byId = new Map((await getProjects()).map(p => [p.id, p]));
    let tagged = 0;
    let alreadyTagged = 0;
    const failed = [];

    for (const id of ids) {
      const project = byId.get(id);
      if (!project) {
        failed.push({ id, error: 'project not found' });
        continue;
      }
      const current = project.description ?? '';
      if (ACTIVE_TAG_PATTERN.test(current)) {
        alreadyTagged++;
        continue;
      }
      const next = current.trim() ? `${current.trimEnd()} ${ACTIVE_TAG}` : ACTIVE_TAG;
      try {
        await updateProjectDescription(id, next);
        tagged++;
      } catch (err) {
        failed.push({ id, name: project.name, error: err.message });
      }
    }

    res.json({ tagged, alreadyTagged, failed });
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
    const projects = await getProjects();
    const project = projects.find(p => p.id === req.params.id);
    const originalColor = project?.color ?? null;
    await updateProjectColor(req.params.id, 'charcoal');
    recordBacklogged(req.params.id, { type: 'backlog', originalColor });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/hide', (req, res) => {
  try {
    recordHide(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/unhide', (req, res) => {
  try {
    clearHide(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/unbacklog', async (req, res) => {
  try {
    const entry = getBackloggedEntry(req.params.id);
    if (entry?.originalColor) {
      await updateProjectColor(req.params.id, entry.originalColor);
    }
    clearBacklogged(req.params.id);
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
