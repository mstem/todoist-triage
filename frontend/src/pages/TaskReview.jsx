import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getTaskQueue, getProjectList, taskAction, rescheduleTask } from '../api.js';
import SwipeDeck from '../components/SwipeDeck.jsx';
import TaskCard from '../components/TaskCard.jsx';

const ACTIONS = {
  left: {
    label: 'Backlog',
    color: 'var(--backlog)',
    run: item => taskAction(item.id, 'backlog', { labels: item.labels }),
  },
  right: {
    label: 'Keep',
    color: 'var(--keep)',
    run: item => taskAction(item.id, 'keep'),
  },
  up: {
    label: 'Someday',
    color: 'var(--someday)',
    run: item => taskAction(item.id, 'someday', { labels: item.labels }),
  },
  down: {
    label: 'Delete',
    color: 'var(--danger)',
    run: item => taskAction(item.id, 'delete'),
  },
  // Not a swipe direction (absent from BUTTON_ORDER) — triggered by the card's
  // checkbox. Closes the task in Todoist; Back reopens it.
  complete: {
    label: 'Complete',
    run: item => taskAction(item.id, 'complete'),
    undo: item => taskAction(item.id, 'reopen'),
  },
  // Not a swipe direction — triggered by the card's +1/+2/+3 buttons. Moves
  // the due date `days` out; undo restores today's date (days: 0).
  reschedule: {
    label: 'Reschedule',
    run: (item, extra) => rescheduleTask(item.id, extra.days, item.due),
    undo: item => rescheduleTask(item.id, 0, item.due),
  },
};

export default function TaskReview() {
  const [status, setStatus] = useState({ loading: true, items: null, projects: [], error: null });

  useEffect(() => {
    Promise.all([getTaskQueue(), getProjectList()])
      .then(([q, l]) =>
        setStatus({ loading: false, items: q.queue, projects: l.projects, error: null })
      )
      .catch(err => setStatus({ loading: false, items: null, projects: [], error: err.message }));
  }, []);

  return (
    <div className="page">
      <Link to="/" className="back-link">
        ← Home
      </Link>
      <h1>Do: Today Review</h1>

      {status.loading && (
        <div className="loading-state">
          <div className="spinner" aria-hidden="true" />
          <p>Loading today's tasks…</p>
        </div>
      )}

      {status.error && <p className="error-banner">Couldn't load tasks: {status.error}</p>}

      {status.items && (
        <SwipeDeck
          items={status.items}
          renderCard={(task, helpers) => (
            <TaskCard
              task={task}
              onComplete={helpers?.onComplete}
              onReschedule={helpers?.onReschedule}
              allProjects={status.projects}
            />
          )}
          actions={ACTIONS}
          emptyTitle="Today is clear"
          emptyDescription="Every task due today has been reviewed."
        />
      )}
    </div>
  );
}
