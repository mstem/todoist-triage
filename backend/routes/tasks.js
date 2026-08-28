import express from 'express';
import {
  getTasksDueToday,
  getProjects,
  applyLabelAndClearDue,
  clearDueDate,
  deleteTask,
  updateTask,
  closeTask,
  reopenTask,
  moveTaskToProject,
  rescheduleTask,
  getBacklogTasks,
  restoreBacklogTask,
  BACKLOG_LABEL,
  ROLLOVER_LIMIT,
} from '../services/todoist.js';
import { recordKeep, getRecentlyKeptIds } from '../services/taskDecisions.js';

const router = express.Router();

router.get('/review-queue', async (req, res) => {
  try {
    const [tasks, projects] = await Promise.all([getTasksDueToday(), getProjects()]);
    const byId = new Map(projects.map(p => [p.id, p]));

    // Skip tasks the user already swiped "Keep" on today, so reloading the
    // deck later the same day doesn't re-ask about them.
    const recentlyKept = getRecentlyKeptIds();

    const queue = tasks
      .filter(t => !t.checked && !recentlyKept.has(t.id))
      // Backlogged tasks belong on the Backlog page, not in the deck. Backlogging
      // clears the due date, so date:today normally won't return them anyway — this
      // catches the window between the label landing and the date being cleared.
      .filter(t => !(t.labels || []).includes(BACKLOG_LABEL))
      .map(t => {
        const project = byId.get(t.project_id);
        const parent = project?.parent_id ? byId.get(project.parent_id) : null;
        return {
          id: t.id,
          content: t.content,
          description: t.description,
          due: t.due,
          labels: t.labels,
          projectId: t.project_id,
          projectName: project?.name ?? null,
          parentProjectName: parent?.name ?? null,
        };
      });

    res.json({ queue });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// The Backlog: everything off the today list but not done, whether swiped there by hand
// or dropped by the nightly roll-forward after too many pushes. One label covers both, so
// they can't be told apart — but ordering by push count, worst first, puts what has been
// dying on the today list longest at the top, and `stalled` marks what crossed the limit.
router.get('/backlog', async (req, res) => {
  try {
    const [tasks, projects] = await Promise.all([getBacklogTasks(), getProjects()]);
    const byId = new Map(projects.map(p => [p.id, p]));

    const items = tasks
      .filter(t => !t.checked)
      .map(t => {
        const project = byId.get(t.project_id);
        const parent = project?.parent_id ? byId.get(project.parent_id) : null;
        return {
          id: t.id,
          content: t.content,
          labels: t.labels,
          priority: t.priority,
          postponedCount: t.postponed_count ?? 0,
          stalled: (t.postponed_count ?? 0) > ROLLOVER_LIMIT,
          addedAt: t.added_at,
          projectId: t.project_id,
          projectName: project?.name ?? null,
          parentProjectName: parent?.name ?? null,
        };
      })
      .sort((a, b) => b.postponedCount - a.postponedCount);

    res.json({ items, rolloverLimit: ROLLOVER_LIMIT });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Put one back on today's list: drops the label and sets today's date.
router.post('/:id/restore', async (req, res) => {
  try {
    const task = { id: req.params.id, labels: req.body.labels || [] };
    const result = await restoreBacklogTask(task);
    res.json({ ok: true, ...result });
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
    const task = { id: req.params.id, labels: req.body.labels || [] };
    await applyLabelAndClearDue(task, BACKLOG_LABEL);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/someday', async (req, res) => {
  try {
    const task = { id: req.params.id, labels: req.body.labels || [] };
    await applyLabelAndClearDue(task, 'someday');
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/remove-date', async (req, res) => {
  try {
    await clearDueDate(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/update', async (req, res) => {
  try {
    const { content, description } = req.body;
    if (content === undefined && description === undefined) {
      return res.status(400).json({ error: 'content or description is required' });
    }
    if (content !== undefined && !content.trim()) {
      return res.status(400).json({ error: 'content cannot be empty' });
    }
    await updateTask(req.params.id, { content, description });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/complete', async (req, res) => {
  try {
    await closeTask(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/reopen', async (req, res) => {
  try {
    await reopenTask(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Move a task to a different project. projectId is required — a task always
// belongs to a project (there is no top-level / parentless task).
router.post('/:id/move', async (req, res) => {
  try {
    const { projectId } = req.body;
    if (!projectId) {
      return res.status(400).json({ error: 'projectId is required' });
    }
    await moveTaskToProject(req.params.id, projectId);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Reschedule a task `days` from today. 0 is used by the swipe deck's undo to
// restore the original due date; the card's date picker can send any offset
// inside a year either side of today.
router.post('/:id/reschedule', async (req, res) => {
  try {
    const { days, due } = req.body;
    if (!Number.isInteger(days) || days < -365 || days > 365) {
      return res.status(400).json({ error: 'days must be a whole number between -365 and 365' });
    }
    const result = await rescheduleTask(req.params.id, days, due);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/delete', async (req, res) => {
  try {
    await deleteTask(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
