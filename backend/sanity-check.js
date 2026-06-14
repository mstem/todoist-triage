import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const envPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.env');
for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) process.env[m[1].trim()] = m[2].trim();
}

const { getProjects, getTasksForProject, getTasksDueToday, collectDescendantIds } = await import('./services/todoist.js');

const projects = await getProjects();
console.log(`Total projects: ${projects.length}`);

const inbox = projects.find(p => p.is_inbox_project || p.name.toLowerCase() === 'inbox');
console.log(`Inbox: ${inbox ? inbox.name + ' (' + inbox.id + ')' : 'not found'}`);

const backlog = projects.find(p => !p.parent_id && p.name.toLowerCase() === 'backlog');
const someday = projects.find(p => !p.parent_id && p.name.toLowerCase() === 'someday');
console.log(`Backlog top-level project: ${backlog ? backlog.id : 'none yet'}`);
console.log(`Someday top-level project: ${someday ? someday.id : 'none yet'}`);

const excludeRoots = [inbox, backlog, someday].filter(Boolean).map(p => p.id);
const excluded = collectDescendantIds(projects, excludeRoots);
const reviewable = projects.filter(p => !excluded.has(p.id));
console.log(`Excluded (inbox/backlog/someday + descendants): ${excluded.size}`);
console.log(`Reviewable projects: ${reviewable.length}`);
console.log('Sample reviewable:', reviewable.slice(0, 5).map(p => ({ id: p.id, name: p.name, parent_id: p.parent_id })));

// sample tasks for first reviewable project
if (reviewable[0]) {
  const tasks = await getTasksForProject(reviewable[0].id);
  console.log(`\nTasks in "${reviewable[0].name}": ${tasks.length}`);
  const sample = [...tasks].sort((a, b) => a.order - b.order).slice(0, 3);
  console.log('Sample 3:', sample.map(t => ({ content: t.content, order: t.order, labels: t.labels })));
}

const today = await getTasksDueToday();
console.log(`\nTasks due today: ${today.length}`);
console.log('Sample:', today.slice(0, 3).map(t => ({ id: t.id, content: t.content, project_id: t.project_id, labels: t.labels, due: t.due })));
