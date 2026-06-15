import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import SwipeCard from './SwipeCard.jsx';
import ArrowIcon from './ArrowIcon.jsx';

const VISIBLE_COUNT = 3;
const BUTTON_ORDER = ['up', 'left', 'right', 'down'];

export default function SwipeDeck({ items, renderCard, actions, emptyTitle, emptyDescription }) {
  const [index, setIndex] = useState(0);
  const [toast, setToast] = useState(null);
  const [history, setHistory] = useState([]);
  const [undoing, setUndoing] = useState(false);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  const remaining = items.slice(index);
  const visible = remaining.slice(0, VISIBLE_COUNT);
  const total = items.length;

  // Desktop keyboard shortcuts: arrow keys map to the four swipe directions.
  const topId = remaining[0]?.id;
  useEffect(() => {
    const KEY_TO_DIRECTION = {
      ArrowUp: 'up',
      ArrowDown: 'down',
      ArrowLeft: 'left',
      ArrowRight: 'right',
    };
    function onKeyDown(e) {
      // Don't hijack arrows while the user is typing in a field.
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target.isContentEditable) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const direction = KEY_TO_DIRECTION[e.key];
      if (!direction || !remaining[0]) return;
      e.preventDefault();
      handleSwipe(direction);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topId]);

  async function goBack() {
    if (index === 0 || undoing) return;
    const last = history[history.length - 1];
    setIndex(i => Math.max(0, i - 1));
    setHistory(h => h.slice(0, -1));
    const action = last && actions[last.direction];
    if (action?.undo) {
      setUndoing(true);
      try {
        await action.undo(last.item);
      } catch (err) {
        setToast(`Couldn't undo ${action.label.toLowerCase()} — ${err.message}`);
      } finally {
        setUndoing(false);
      }
    }
  }

  async function handleSwipe(direction, extra) {
    const item = remaining[0];
    if (!item) return;
    const action = actions[direction];
    setIndex(i => i + 1);
    setHistory(h => [...h, { item, direction }]);
    if (!action) return;
    try {
      await action.run(item, extra);
    } catch (err) {
      setToast(`Couldn't ${action.label.toLowerCase()} — ${err.message}`);
    }
  }

  if (remaining.length === 0) {
    return (
      <div className="swipe-empty">
        <h2>{emptyTitle}</h2>
        <p>{emptyDescription}</p>
        <Link to="/" className="back-link swipe-empty__link">
          ← Back to Home
        </Link>
      </div>
    );
  }

  return (
    <div className="swipe-deck">
      <div className="swipe-progress-row">
        <button
          type="button"
          className="swipe-back-btn"
          onClick={goBack}
          disabled={index === 0 || undoing}
        >
          {undoing ? 'Undoing…' : '← Back'}
        </button>
        <p className="swipe-progress">
          {index + 1} of {total}
        </p>
      </div>

      <div className="swipe-card-stack">
        {visible.map((item, i) => (
          <SwipeCard key={item.id} active={i === 0} index={i} onSwipe={handleSwipe}>
            {renderCard(
              item,
              i === 0
                ? {
                    onComplete: () => handleSwipe('complete'),
                    onReschedule: days => handleSwipe('reschedule', { days }),
                  }
                : null
            )}
          </SwipeCard>
        ))}
      </div>

      <div className="swipe-buttons">
        {BUTTON_ORDER.map(direction => {
          const action = actions[direction];
          if (!action) return null;
          return (
            <button
              key={direction}
              type="button"
              className={`swipe-btn swipe-btn--${direction}`}
              style={{ '--btn-accent': action.color }}
              onClick={() => handleSwipe(direction)}
            >
              <ArrowIcon direction={direction} />
              <span>{action.label}</span>
            </button>
          );
        })}
      </div>

      {toast && <div className="toast toast--error">{toast}</div>}
    </div>
  );
}
