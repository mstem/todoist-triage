import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getProjectQueue, getTaskQueue, getBacklog } from '../api.js';

const initialStatus = { loading: true, count: null, error: null };

function DeckCard({ to, title, description, status, accentVar, cta = 'Start review →' }) {
  return (
    <Link to={to} className="deck-card" style={{ '--deck-accent': `var(${accentVar})` }}>
      <div className="deck-card__count">
        {status.loading ? (
          <span className="skeleton skeleton--count" aria-label="Loading count" />
        ) : status.error ? (
          '—'
        ) : (
          status.count
        )}
      </div>
      <h2 className="deck-card__title">{title}</h2>
      <p className="deck-card__description">{description}</p>
      {status.error && <p className="deck-card__error">Couldn't load count: {status.error}</p>}
      <span className="deck-card__cta">{cta}</span>
    </Link>
  );
}

export default function Home() {
  const [projectStatus, setProjectStatus] = useState(initialStatus);
  const [taskStatus, setTaskStatus] = useState(initialStatus);
  const [backlogStatus, setBacklogStatus] = useState(initialStatus);

  useEffect(() => {
    getProjectQueue()
      .then(d => setProjectStatus({ loading: false, count: d.queue.length, error: null }))
      .catch(err => setProjectStatus({ loading: false, count: null, error: err.message }));

    getTaskQueue()
      .then(d => setTaskStatus({ loading: false, count: d.queue.length, error: null }))
      .catch(err => setTaskStatus({ loading: false, count: null, error: err.message }));

    getBacklog()
      .then(d => setBacklogStatus({ loading: false, count: d.items.length, error: null }))
      .catch(err => setBacklogStatus({ loading: false, count: null, error: err.message }));
  }, []);

  return (
    <div className="page">
      <header className="home-header">
        <h1>Todoist Triage</h1>
        <p className="home-tagline">
          Swipe through what's piled up. Keep what matters, clear out the rest.
        </p>
      </header>

      <div className="deck-grid">
        <DeckCard
          to="/projects"
          title="Weekly Project Review"
          description="Go through every active project — keep it, push it to Backlog, hide it for 120 days, or archive it."
          status={projectStatus}
          accentVar="--hide"
        />
        <DeckCard
          to="/tasks"
          title="Do: Today Review"
          description="Go through everything due today — keep it on today, push it off, or delete it."
          status={taskStatus}
          accentVar="--accent"
        />
        <DeckCard
          to="/backlog"
          title="Backlog"
          description="Tasks pushed forward more than 21 times. The roll-forward stopped moving them and the today deck no longer asks about them."
          status={backlogStatus}
          accentVar="--backlog"
          cta="Open list →"
        />
      </div>
    </div>
  );
}
