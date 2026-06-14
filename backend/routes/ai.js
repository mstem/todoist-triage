import express from 'express';
import { spawnHeadlessSession } from '../services/claudeSession.js';
import { buildProjectPrompt, buildTaskPrompt } from '../services/promptTemplates.js';

const router = express.Router();

router.post('/project', (req, res) => {
  try {
    const { todoistId, projectName, parentName, openTasks } = req.body;
    if (!todoistId || !projectName) {
      return res.status(400).json({ error: 'todoistId and projectName are required' });
    }
    const prompt = buildProjectPrompt({ todoistId, projectName, parentName, openTasks });
    const { sessionId, logFile } = spawnHeadlessSession(prompt);
    res.json({ ok: true, sessionId, logFile });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/task', (req, res) => {
  try {
    const { todoistId, content, description, projectName, parentProjectName } = req.body;
    if (!todoistId || !content) {
      return res.status(400).json({ error: 'todoistId and content are required' });
    }
    const prompt = buildTaskPrompt({ todoistId, content, description, projectName, parentProjectName });
    const { sessionId, logFile } = spawnHeadlessSession(prompt);
    res.json({ ok: true, sessionId, logFile });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
