import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getTaskQueue, taskAction } from '../api.js';
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
};

export default function TaskReview() {
  const [status, setStatus] = useState({ loading: true, items: null, error: null });

  useEffect(() => {
    getTaskQueue()
      .then(d => setStatus({ loading: false, items: d.queue, error: null }))
      .catch(err => setStatus({ loading: false, items: null, error: err.message }));
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
          renderCard={task => <TaskCard task={task} />}
          actions={ACTIONS}
          emptyTitle="Today is clear"
          emptyDescription="Every task due today has been reviewed."
        />
      )}
    </div>
  );
}
