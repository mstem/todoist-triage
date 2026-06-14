import { useState } from 'react';
import AIStatusToast from './AIStatusToast.jsx';

const LABELS = {
  idle: 'Plan with AI',
  sending: 'Thinking…',
  sent: 'Plan requested',
  error: 'Try again',
};

export default function AIButton({ name, onTrigger }) {
  const [state, setState] = useState('idle');
  const [toast, setToast] = useState(null);

  async function handleClick(e) {
    e.stopPropagation();
    if (state === 'sending') return;
    setState('sending');
    try {
      await onTrigger();
      setState('sent');
      setToast(`AI is planning "${name}" — check Todoist comments in a minute.`);
    } catch (err) {
      setState('error');
      setToast(`Couldn't start AI session — ${err.message}`);
    }
  }

  return (
    <>
      <button
        type="button"
        className={`ai-button ai-button--${state}`}
        onClick={handleClick}
        onPointerDown={e => e.stopPropagation()}
        disabled={state === 'sending'}
      >
        {state === 'sending' ? (
          <span className="ai-button__spinner" aria-hidden="true" />
        ) : state === 'sent' ? (
          <CheckIcon />
        ) : (
          <SparkleIcon />
        )}
        <span>{LABELS[state]}</span>
      </button>
      {toast && (
        <AIStatusToast
          message={toast}
          variant={state === 'error' ? 'error' : 'info'}
          onDone={() => setToast(null)}
        />
      )}
    </>
  );
}

function SparkleIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}
