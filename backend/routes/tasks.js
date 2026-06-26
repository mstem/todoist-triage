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

router.post('/:id/keep', (req, res) => {
  recordKeep(req.params.id);
  res.json({ ok: true });
});

router.post('/:id/backlog', async (req, res) => {
  try {
    const task = { id: req.params.id, labels: req.body.labels || [] };
    await applyLabelAndClearDue(task, 'backlog');
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

// Reschedule a task `days` from today (0-3). 0 is used by the swipe deck's
// undo to restore the original due date.
router.post('/:id/reschedule', async (req, res) => {
  try {
    const { days, due } = req.body;
    if (![0, 1, 2, 3].includes(days)) {
      return res.status(400).json({ error: 'days must be 0, 1, 2, or 3' });
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
