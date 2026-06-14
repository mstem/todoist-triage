import express from 'express';
import {
  getTasksDueToday,
  getProjects,
  applyLabelAndClearDue,
  deleteTask,
  updateTask,
  closeTask,
  reopenTask,
} from '../services/todoist.js';

const router = express.Router();

router.get('/review-queue', async (req, res) => {
  try {
    const [tasks, projects] = await Promise.all([getTasksDueToday(), getProjects()]);
    const byId = new Map(projects.map(p => [p.id, p]));

    const queue = tasks
      .filter(t => !t.checked)
      .map(t => {
        const project = byId.get(t.project_id);
        const parent = project?.parent_id ? byId.get(project.parent_id) : null;
        return {
          id: t.id,
          content: t.content,
          description: t.description,
          due: t.due,
          labels: t.labels,
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

router.post('/:id/delete', async (req, res) => {
  try {
    await deleteTask(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
