import { useEffect, useRef, useState } from 'react';
import AIButton from './AIButton.jsx';
import ParentPicker from './ParentPicker.jsx';
import { aiTask, moveTask, updateTask } from '../api.js';

const MD_LINK = /\[([^\]]+)\]\(([^)]+)\)/g;

// Todoist stores titled links as markdown: "[GitHub - …](https://github.com/…)".
// Pull those out so the title can show the clean text while we still keep the
// URLs to (a) render as clickable chips and (b) re-wrap on save.
function parseLinks(content = '') {
  const links = [];
  const display = content.replace(MD_LINK, (_, text, url) => {
    links.push({ text, url });
    return text;
  });
  return { links, display };
}

// Rebuild the markdown from the edited clean title. Each link's display text is
// re-wrapped in place; if the user edited a link's text away, its URL is
// appended rather than silently dropped.
function toRawContent(display, links) {
  let raw = display;
  for (const { text, url } of links) {
    const idx = raw.indexOf(text);
    if (idx !== -1) {
      raw = `${raw.slice(0, idx)}[${text}](${url})${raw.slice(idx + text.length)}`;
    } else {
      raw = `${raw} [${text}](${url})`.trim();
    }
  }
  return raw;
}

// Strip the protocol for a more compact chip label; the href keeps the full URL.
function linkLabel(url) {
  return url.replace(/^https?:\/\//, '');
}

// Only allow web/mail schemes as a clickable href — a "javascript:" (or other)
// URI from a task title would execute on click. Returns null for anything else
// so the caller can fall back to plain text. The raw URL is still kept for the
// save round-trip; this guards rendering only.
function safeHref(url) {
  try {
    const u = new URL(url, window.location.href);
    return ['http:', 'https:', 'mailto:'].includes(u.protocol) ? u.href : null;
  } catch {
    return null;
  }
}

export default function TaskCard({ task, onComplete, onReschedule, allProjects = [] }) {
  // Parse the title's markdown links once — the URLs are intrinsic to the task
  // and don't change as the user edits the clean title text.
  const parsed = useRef(parseLinks(task.content)).current;
  // Track the task's project locally so the "In:" eyebrow, the picker's
  // exclusion, and the AI payload all reflect a move immediately.
  const [loc, setLoc] = useState({
    projectId: task.projectId,
    projectName: task.projectName,
    parentProjectName: task.parentProjectName,
  });
  const [moveStatus, setMoveStatus] = useState(null);

  const [edits, setEdits] = useState({
    content: parsed.display,
    description: task.description || '',
  });
  const [editStatus, setEditStatus] = useState(null);
  // Last-saved values, so blur only writes when something actually changed.
  const baseline = useRef({ content: parsed.display, description: task.description || '' });

  const location = [loc.parentProjectName, loc.projectName].filter(Boolean).join(' / ');

  // The title is a textarea sized to fit its content (long titles wrap
  // across multiple lines instead of being clipped like a single-line input).
  const titleRef = useRef(null);
  function resizeTitle() {
    const el = titleRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }
  useEffect(resizeTitle, []);

  function setField(field, value) {
    setEdits(prev => ({ ...prev, [field]: value }));
  }

  async function saveField(field) {
    const value = edits[field];
    if (value === baseline.current[field]) return; // unchanged
    if (field === 'content' && !value.trim()) {
      // Don't let the title be blanked — revert to the last saved value.
      setField('content', baseline.current.content);
      return;
    }
    setEditStatus({ type: 'saving', msg: 'Saving…' });
    try {
      // The title is edited as clean text; re-wrap any links back into markdown
      // before writing so the URLs survive the round-trip.
      const payload =
        field === 'content' ? toRawContent(value, parsed.links) : value;
      await updateTask(task.id, { [field]: payload });
      baseline.current[field] = value;
      setEditStatus({ type: 'saved', msg: 'Saved' });
      setTimeout(() => setEditStatus(s => (s?.type === 'saved' ? null : s)), 1800);
    } catch (err) {
      setEditStatus({ type: 'error', msg: `Couldn't save — ${err.message}` });
    }
  }

  async function handleMove(target) {
    setMoveStatus({ type: 'saving', msg: `Moving to ${target.name}…` });
    try {
      await moveTask(task.id, target.id);
      const segs = target.path ? target.path.split(' / ') : [];
      setLoc({
        projectId: target.id,
        projectName: target.name,
        parentProjectName: segs.length ? segs[segs.length - 1] : null,
      });
      setMoveStatus({ type: 'saved', msg: `Moved to ${target.name}` });
      setTimeout(() => setMoveStatus(s => (s?.type === 'saved' ? null : s)), 2400);
    } catch (err) {
      setMoveStatus({ type: 'error', msg: `Couldn't move — ${err.message}` });
    }
  }

  return (
    <>
      <div className="task-card__head">
        {onComplete && (
          <button
            type="button"
            className="task-check"
            title="Complete task"
            aria-label="Complete task"
            onPointerDown={e => e.stopPropagation()}
            onClick={onComplete}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </button>
        )}
        <div className="task-card__heading">
          {location && <p className="swipe-card__eyebrow">In: {location}</p>}
          <textarea
            ref={titleRef}
            className="task-edit__title task-edit__title--main"
            value={edits.content}
            onChange={e => {
              setField('content', e.target.value);
              resizeTitle();
            }}
            onBlur={() => saveField('content')}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                e.target.blur();
              }
            }}
            onPointerDown={e => e.stopPropagation()}
            aria-label="Task title"
            rows={1}
          />
          {parsed.links.length > 0 && (
            <div className="task-card__links">
              {parsed.links.map(({ url }, i) => {
                const href = safeHref(url);
                const icon = (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                  </svg>
                );
                // Unsafe scheme (e.g. javascript:) — show the text, but not as a link.
                if (!href) {
                  return (
                    <span key={`${url}-${i}`} className="task-card__link task-card__link--unsafe" title={url}>
                      {icon}
                      <span className="task-card__link-text">{linkLabel(url)}</span>
                    </span>
                  );
                }
                return (
                  <a
                    key={`${url}-${i}`}
                    className="task-card__link"
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={url}
                    onPointerDown={e => e.stopPropagation()}
                  >
                    {icon}
                    <span className="task-card__link-text">{linkLabel(url)}</span>
                  </a>
                );
              })}
            </div>
          )}
        </div>
      </div>
      <div className="swipe-card__body">
        <textarea
          className="task-edit__desc task-edit__desc--main"
          value={edits.description}
          onChange={e => setField('description', e.target.value)}
          onBlur={() => saveField('description')}
          onPointerDown={e => e.stopPropagation()}
          placeholder="Add a description…"
          aria-label="Task description"
          rows={3}
        />
        {editStatus && (
          <span className={`task-card__edit-status task-edit__status--${editStatus.type}`}>
            {editStatus.msg}
          </span>
        )}
      </div>
      {allProjects.length > 0 && (
        <div className="swipe-card__move">
          <ParentPicker
            allProjects={allProjects}
            currentId={loc.projectId}
            onSelect={handleMove}
            label="Move to another project…"
            excludeDescendants={false}
          />
          {moveStatus && (
            <span className={`task-edit__status task-edit__status--${moveStatus.type}`}>
              {moveStatus.msg}
            </span>
          )}
        </div>
      )}
      <div className="swipe-card__footer">
        {task.due?.string && <span className="swipe-card__due">Due {task.due.string}</span>}
        {onReschedule && (
          <div className="reschedule-group" role="group" aria-label="Reschedule task">
            <button
              type="button"
              className="reschedule-btn"
              title="Reschedule to tomorrow"
              aria-label="Reschedule to tomorrow"
              onPointerDown={e => e.stopPropagation()}
              onClick={() => onReschedule(1)}
            >
              +1
            </button>
            <button
              type="button"
              className="reschedule-btn"
              title="Reschedule to two days from now"
              aria-label="Reschedule to two days from now"
              onPointerDown={e => e.stopPropagation()}
              onClick={() => onReschedule(2)}
            >
              +2
            </button>
            <button
              type="button"
              className="reschedule-btn"
              title="Reschedule to three days from now"
              aria-label="Reschedule to three days from now"
              onPointerDown={e => e.stopPropagation()}
              onClick={() => onReschedule(3)}
            >
              +3
            </button>
          </div>
        )}
        <AIButton
          name={edits.content}
          onTrigger={() =>
            aiTask({
              todoistId: task.id,
              content: edits.content,
              description: edits.description,
              projectName: loc.projectName,
              parentProjectName: loc.parentProjectName,
            })
          }
        />
      </div>
    </>
  );
}
