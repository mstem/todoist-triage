import { useRef, useState } from 'react';
import AIButton from './AIButton.jsx';
import ParentPicker from './ParentPicker.jsx';
import { aiProject, updateTask, moveProject } from '../api.js';

// Stop pointer events from reaching the draggable swipe card so typing /
// selecting text in a field doesn't start a card drag. The card is still
// draggable by grabbing anywhere outside the inputs.
const stopDrag = e => e.stopPropagation();

export default function ProjectCard({ project, allProjects = [] }) {
  const [edits, setEdits] = useState(() =>
    Object.fromEntries(
      project.sampleTasks.map(t => [t.id, { content: t.content, description: t.description || '' }])
    )
  );
  const [status, setStatus] = useState(null); // { type: 'saving' | 'saved' | 'error', msg }
  const [parentName, setParentName] = useState(project.parentName);
  const [moveStatus, setMoveStatus] = useState(null);
  // Last-saved values, so blur only writes when something actually changed.
  const baseline = useRef(
    Object.fromEntries(
      project.sampleTasks.map(t => [t.id, { content: t.content, description: t.description || '' }])
    )
  );

  // Merge edits into the full open-task list the AI button sends.
  const openTasksForAI = project.openTasks.map(t =>
    edits[t.id] ? { ...t, ...edits[t.id] } : t
  );

  function setField(id, field, value) {
    setEdits(prev => ({ ...prev, [id]: { ...prev[id], [field]: value } }));
  }

  async function saveField(id, field) {
    const value = edits[id][field];
    if (value === baseline.current[id][field]) return; // unchanged
    if (field === 'content' && !value.trim()) {
      // Don't let a task title be blanked — revert to the last saved value.
      setField(id, 'content', baseline.current[id].content);
      return;
    }
    setStatus({ type: 'saving', msg: 'Saving…' });
    try {
      await updateTask(id, { [field]: value });
      baseline.current[id][field] = value;
      setStatus({ type: 'saved', msg: 'Saved' });
      setTimeout(() => setStatus(s => (s?.type === 'saved' ? null : s)), 1800);
    } catch (err) {
      setStatus({ type: 'error', msg: `Couldn't save — ${err.message}` });
    }
  }

  async function handleMove(target) {
    setMoveStatus({ type: 'saving', msg: `Moving under ${target.name}…` });
    try {
      await moveProject(project.id, target.id);
      setParentName(target.name);
      setMoveStatus({ type: 'saved', msg: `Moved under ${target.name}` });
      setTimeout(() => setMoveStatus(s => (s?.type === 'saved' ? null : s)), 2400);
    } catch (err) {
      setMoveStatus({ type: 'error', msg: `Couldn't move — ${err.message}` });
    }
  }

  return (
    <>
      <p className="swipe-card__eyebrow">
        {parentName ? `In: ${parentName}` : 'Top-level project'}
      </p>
      <h2 className="swipe-card__title">{project.name}</h2>
      <div className="swipe-card__body">
        {project.sampleTasks.length > 0 ? (
          <ul className="task-edit-list">
            {project.sampleTasks.map(task => (
              <li key={task.id} className="task-edit">
                <input
                  className="task-edit__title"
                  value={edits[task.id].content}
                  onChange={e => setField(task.id, 'content', e.target.value)}
                  onBlur={() => saveField(task.id, 'content')}
                  onPointerDown={stopDrag}
                  placeholder="Task title"
                  aria-label="Task title"
                />
                <textarea
                  className="task-edit__desc"
                  value={edits[task.id].description}
                  onChange={e => setField(task.id, 'description', e.target.value)}
                  onBlur={() => saveField(task.id, 'description')}
                  onPointerDown={stopDrag}
                  placeholder="Add a description…"
                  aria-label="Task description"
                  rows={2}
                />
              </li>
            ))}
          </ul>
        ) : (
          <p className="swipe-card__description">No open tasks in this project.</p>
        )}
      </div>
      {allProjects.length > 0 && (
        <div className="swipe-card__move">
          <ParentPicker allProjects={allProjects} currentId={project.id} onSelect={handleMove} />
          {moveStatus && (
            <span className={`task-edit__status task-edit__status--${moveStatus.type}`}>
              {moveStatus.msg}
            </span>
          )}
        </div>
      )}
      <div className="swipe-card__footer">
        {status && (
          <span className={`task-edit__status task-edit__status--${status.type}`}>{status.msg}</span>
        )}
        <AIButton
          name={project.name}
          onTrigger={() =>
            aiProject({
              todoistId: project.id,
              projectName: project.name,
              parentName,
              openTasks: openTasksForAI,
            })
          }
        />
      </div>
    </>
  );
}
