import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  getProjectQueue,
  getProjectList,
  projectAction,
  moveProject,
  completeProjectReview,
} from '../api.js';
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
    label: 'Hide 30d',
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
  // Result of the end-of-review pass that appends @active to kept projects.
  const [tagging, setTagging] = useState(null);

  useEffect(() => {
    Promise.all([getProjectQueue(), getProjectList()])
      .then(([q, l]) =>
        setStatus({ loading: false, items: q.queue, projects: l.projects, error: null })
      )
      .catch(err => setStatus({ loading: false, items: null, projects: [], error: err.message }));
  }, []);

  // Runs once the deck empties. Only the projects swiped Keep in this session get
  // the tag — a project undone with Back is off the history by then, and one
  // decided in an earlier session was already tagged when that session ended.
  async function handleFinish(history) {
    const keptIds = history.filter(h => h.direction === 'right').map(h => h.item.id);
    if (keptIds.length === 0) return;
    setTagging({ state: 'running', count: keptIds.length });
    try {
      const result = await completeProjectReview(keptIds);
      setTagging({ state: 'done', ...result });
    } catch (err) {
      setTagging({ state: 'error', error: err.message });
    }
  }

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
          onFinish={handleFinish}
          finishNote={<TaggingNote tagging={tagging} />}
        />
      )}
    </div>
  );
}

function TaggingNote({ tagging }) {
  if (!tagging) return null;

  if (tagging.state === 'running') {
    return (
      <p className="tagging-note">
        Tagging {tagging.count} kept {tagging.count === 1 ? 'project' : 'projects'} @active…
      </p>
    );
  }

  if (tagging.state === 'error') {
    return <p className="tagging-note tagging-note--error">Couldn't tag @active: {tagging.error}</p>;
  }

  const { tagged, alreadyTagged, failed = [] } = tagging;
  const parts = [];
  if (tagged) parts.push(`@active added to ${tagged} ${tagged === 1 ? 'project' : 'projects'}`);
  if (alreadyTagged) parts.push(`${alreadyTagged} already tagged`);
  if (parts.length === 0) return null;

  return (
    <>
      <p className="tagging-note">{parts.join(' · ')}</p>
      {failed.length > 0 && (
        <p className="tagging-note tagging-note--error">
          Failed on {failed.map(f => f.name ?? f.id).join(', ')}
        </p>
      )}
    </>
  );
}
