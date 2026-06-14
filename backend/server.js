import fs from 'fs';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';

// Load .env explicitly so it overrides any inherited env vars
const envPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) process.env[m[1].trim()] = m[2].trim();
  }
}

import projectsRouter from './routes/projects.js';
import tasksRouter from './routes/tasks.js';
import aiRouter from './routes/ai.js';
import { ensureLabelExists } from './services/todoist.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

app.use('/api/projects', projectsRouter);
app.use('/api/tasks', tasksRouter);
app.use('/api/ai', aiRouter);

// Serve built frontend in production
const publicDir = path.join(__dirname, '..', 'public');
app.use(express.static(publicDir));
app.get('*', (req, res) => {
  const index = path.join(publicDir, 'index.html');
  res.sendFile(index, err => {
    if (err) res.status(404).send('Not found');
  });
});

app.listen(PORT, () => {
  console.log(`Todoist Triage server running on http://localhost:${PORT}`);
});

// Make sure the labels we apply during task triage exist (non-blocking)
ensureLabelExists('backlog');
ensureLabelExists('someday');
