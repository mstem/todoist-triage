import { useMemo, useRef, useState } from 'react';

// Keep pointer events off the draggable swipe card so typing/clicking the
// picker doesn't start a card drag.
const stopDrag = e => e.stopPropagation();

const MAX_RESULTS = 50;

export default function ParentPicker({ allProjects, currentId, onSelect }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const blurTimer = useRef(null);

  // Exclude the project itself and all its descendants — Todoist rejects cycles.
  const excluded = useMemo(() => {
    const set = new Set([currentId]);
    let frontier = new Set([currentId]);
    while (frontier.size) {
      const kids = allProjects.filter(p => frontier.has(p.parentId)).map(p => p.id);
      const fresh = kids.filter(id => !set.has(id));
      fresh.forEach(id => set.add(id));
      frontier = new Set(fresh);
    }
    return set;
  }, [allProjects, currentId]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return allProjects
      .filter(p => !excluded.has(p.id))
      .filter(
        p => !q || p.name.toLowerCase().includes(q) || (p.path && p.path.toLowerCase().includes(q))
      )
      .slice(0, MAX_RESULTS);
  }, [allProjects, excluded, query]);

  function choose(p) {
    setQuery('');
    setOpen(false);
    onSelect(p);
  }

  function onKeyDown(e) {
    if (!open) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive(a => Math.min(a + 1, matches.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive(a => Math.max(a - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (matches[active]) choose(matches[active]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  return (
    <div className="parent-picker" onPointerDown={stopDrag}>
      <input
        className="parent-picker__input"
        type="text"
        value={query}
        placeholder="Move under another project…"
        aria-label="Move under another project"
        onChange={e => {
          setQuery(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          blurTimer.current = setTimeout(() => setOpen(false), 120);
        }}
        onKeyDown={onKeyDown}
      />
      {open && (
        <ul className="parent-picker__list">
          {matches.length === 0 ? (
            <li className="parent-picker__empty">No matching project</li>
          ) : (
            matches.map((p, i) => (
              <li
                key={p.id}
                className={`parent-picker__option${i === active ? ' is-active' : ''}`}
                onMouseDown={e => e.preventDefault()}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(p)}
              >
                <span className="parent-picker__name">{p.name}</span>
                {p.path && <span className="parent-picker__path">{p.path}</span>}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
