import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

type Print = (content: ReactNode) => void;

const PrintContext = createContext<Print | null>(null);

export function usePrint(): Print {
  const print = useContext(PrintContext);
  if (!print) throw new Error('usePrint hors de PrintProvider');
  return print;
}

/** Affiche le contenu dans la zone d'impression, puis ouvre la fenêtre d'impression du navigateur. */
export function PrintProvider({ children }: { children: ReactNode }) {
  const [content, setContent] = useState<ReactNode>(null);
  const [job, setJob] = useState(0);
  const print = useCallback<Print>((next) => {
    setContent(next);
    setJob((n) => n + 1);
  }, []);

  useEffect(() => {
    if (job > 0) window.print();
  }, [job]);

  return (
    <PrintContext.Provider value={print}>
      {children}
      <div id="printArea">{content}</div>
    </PrintContext.Provider>
  );
}
