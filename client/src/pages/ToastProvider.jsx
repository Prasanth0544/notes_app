import { createContext, useContext, useState, useRef, useCallback } from 'react';

const ToastContext = createContext();

export function useToast() { return useContext(ToastContext); }

export default function ToastProvider({ children }) {
  const [toastQueue, setToastQueue] = useState([]);
  const toastIdRef = useRef(0);

  const showToastMsg = useCallback((msg, duration = 2400) => {
    const id = ++toastIdRef.current;
    setToastQueue(prev => [...prev.slice(-4), { id, msg }]);
    setTimeout(() => setToastQueue(prev => prev.filter(t => t.id !== id)), duration);
  }, []);

  return (
    <ToastContext.Provider value={showToastMsg}>
      {children}
      <div style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', zIndex: 9999, display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center', pointerEvents: 'none' }}>
        {toastQueue.map(t => (
          <div key={t.id} className="toast show">{t.msg}</div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
