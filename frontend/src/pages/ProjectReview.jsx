import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getProjectQueue, getProjectList, projectAction, moveProject } from '../api.js';
import SwipeDeck from '../components/SwipeDeck.jsx';
import ProjectCard from '../components/ProjectCard.jsx';

// `undo` reverses the action when the user hits Back: backlog colors the project
// and records it locally (undo restores color via unbacklog); hide records locally
// only (undo clears via unhide); archive is reversed by unarchiving. Keep is a no-op.
const ACTIONS = {
  left: {
    label: 'Backlog',
    color: 'var(--backlog)',
    run: item => projectAction(item.id, 'backlog'),
    undo: item => projectAction(item.id, 'unbacklog'),
  },
  right: {
    label: 'Keep',
    color: 'var(--keep)',
    run: item => projectAction(item.id, 'keep'),
  },
  up: {
    label: 'Hide 120d',
    color: 'var(--hide)',
    run: item => projectAction(item.id, 'hide'),
    undo: item => projectAction(item.id, 'unhide'),
  },
  down: {
    label: 'Archive',
    color: 'var(--danger)',
    run: item => projectAction(item.id, 'archive'),
    undo: item => projectAction(item.id, 'unarchive', { parentId: item.parentId ?? null }),
  },
};

export default function ProjectReview() {
  const [status, setStatus] = useState({ loading: true, items: null, projects: [], error: null });

  useEffect(() => {
    Promise.all([getProjectQueue(), getProjectList()])
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
      <h1>Weekly Project Review</h1>

      {status.loading && (
        <div className="loading-state">
          <div className="spinner" aria-hidden="true" />
          <p>Loading your projects — this can take a minute the first time.</p>
        </div>
      )}

      {status.error && <p className="error-banner">Couldn't load projects: {status.error}</p>}

      {status.items && (
        <SwipeDeck
          items={status.items}
          renderCard={project => <ProjectCard project={project} allProjects={status.projects} />}
          actions={ACTIONS}
          emptyTitle="All caught up"
          emptyDescription="Every active project has been reviewed."
        />
      )}
    </div>
  );
}
