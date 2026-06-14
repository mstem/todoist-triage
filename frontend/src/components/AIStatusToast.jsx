import { useEffect } from 'react';

export default function AIStatusToast({ message, variant = 'info', onDone }) {
  useEffect(() => {
    const timer = setTimeout(onDone, 5000);
    return () => clearTimeout(timer);
  }, [onDone]);

  return <div className={`toast toast--${variant}`}>{message}</div>;
}
