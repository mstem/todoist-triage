import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getBacklog, taskAction, restoreTask } from '../api.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatAdded(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return `${d.getDate()} ${MONTHS[d.getMonth()]}${sameYear ? '' : ` ${d.getFullYear()}`}`;
}

function projectPath(item) {
  return [item.parentProjectName, item.projectName].filter(Boolean).join(' · ');
}

// Delete is the one action here with no undo, so the button asks twice: the first
// click arms it, a click anywhere else disarms it again.
function BacklogRow({ item, limit, busy, armed, onArm, onRestore, onComplete, onDelete }) {
  const added = formatAdded(item.addedAt);
  const title = item.stalled
    ? `Pushed forward ${item.postponedCount} times, past the limit of ${limit}`
    : `Pushed forward ${item.postponedCount} times`;
  return (
    <li className="backlog-row" data-busy={busy}>
      <span className="backlog-row__count" data-stalled={item.stalled} title={title}>
        {item.postponedCount}&times;
      </span>
      <div className="backlog-row__body">
        <p className="backlog-row__content">{item.content}</p>
        <p className="backlog-row__meta">
          {projectPath(item) || 'Inbox'}
          {added && <> &middot; added {added}</>}
        </p>
      </div>
      <div className="backlog-row__actions">
        <button type="button" className="row-btn" disabled={busy} onClick={onRestore}>
          Back to today
        </button>
        <button type="button" className="row-btn row-btn--done" disabled={busy} onClick={onComplete}>
          Done
        </button>
        <button
          type="button"
          className="row-btn row-btn--danger"
          disabled={busy}
          onClick={armed ? onDelete : onArm}
        >
          {armed ? 'Really delete' : 'Delete'}
        </button>
      </div>
    </li>
  );
}

export default function Backlog() {
  const [status, setStatus] = useState({ loading: true, items: null, limit: 21, error: null });
  const [busyId, setBusyId] = useState(null);
  const [armedId, setArmedId] = useState(null);
  const [actionError, setActionError] = useState(null);

  useEffect(() => {
    getBacklog()
      .then(d =>
        setStatus({ loading: false, items: d.items, limit: d.rolloverLimit ?? 21, error: null })
      )
      .catch(err => setStatus({ loading: false, items: null, limit: 21, error: err.message }));
  }, []);

  const run = (item, fn) => async () => {
    setBusyId(item.id);
    setArmedId(null);
    setActionError(null);
    try {
      await fn();
      setStatus(s => ({ ...s, items: s.items.filter(i => i.id !== item.id) }));
    } catch (err) {
      setActionError(`${item.content}: ${err.message}`);
    } finally {
      setBusyId(null);
    }
  };

  const items = status.items;
  const stalled = items ? items.filter(i => i.stalled).length : 0;

  return (
    <div className="page" onClick={() => setArmedId(null)}>
      <Link to="/" className="back-link">
        ← Home
      </Link>
      <header className="backlog-header">
        <h1>Backlog</h1>
        {items && items.length > 0 && (
          <span className="backlog-count">{items.length}</span>
        )}
      </header>
      <p className="backlog-intro">
        Off the today deck but not done — swiped here, or pushed to tomorrow more than{' '}
        {status.limit} times until the nightly roll-forward stopped moving them.
        {stalled > 0 && <> {stalled} of these stalled their way here, marked in amber.</>}{' '}
        Ordered by how many times each has been pushed.
      </p>

      {status.loading && (
        <div className="loading-state">
          <div className="spinner" aria-hidden="true" />
          <p>Loading the backlog…</p>
        </div>
      )}

      {status.error && <p className="error-banner">Couldn't load the backlog: {status.error}</p>}
      {actionError && <p className="error-banner">{actionError}</p>}

      {items && items.length === 0 && (
        <div className="placeholder">
          <h2>The backlog is empty</h2>
          <p>Nothing has been swiped off the today deck or left to stall on it.</p>
        </div>
      )}

      {items && items.length > 0 && (
        <ul className="backlog-list">
          {items.map(item => (
            <BacklogRow
              key={item.id}
              item={item}
              limit={status.limit}
              busy={busyId === item.id}
              armed={armedId === item.id}
              onArm={e => {
                e.stopPropagation();
                setArmedId(item.id);
              }}
              onRestore={run(item, () => restoreTask(item.id, item.labels))}
              onComplete={run(item, () => taskAction(item.id, 'complete'))}
              onDelete={run(item, () => taskAction(item.id, 'delete'))}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
