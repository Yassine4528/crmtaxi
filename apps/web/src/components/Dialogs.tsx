import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { Modal } from './Modal.tsx';

type Request =
  | { kind: 'alert'; message: string; resolve: () => void }
  | { kind: 'confirm'; message: string; danger: boolean; resolve: (ok: boolean) => void }
  | { kind: 'prompt'; message: string; value: string; password: boolean; resolve: (v: string | null) => void };

interface Dialogs {
  alert: (message: string) => Promise<void>;
  confirm: (message: string, options?: { danger?: boolean }) => Promise<boolean>;
  prompt: (message: string, value?: string, options?: { password?: boolean }) => Promise<string | null>;
  /** Exécute une écriture : affiche l'erreur éventuelle et rafraîchit les données. Retourne vrai si elle a réussi. */
  run: (action: () => Promise<unknown>) => Promise<boolean>;
}

const DialogsContext = createContext<Dialogs | null>(null);

export function useDialogs(): Dialogs {
  const dialogs = useContext(DialogsContext);
  if (!dialogs) throw new Error('useDialogs hors de DialogsProvider');
  return dialogs;
}

function PromptBody({ request, close }: { request: Extract<Request, { kind: 'prompt' }>; close: () => void }) {
  const [value, setValue] = useState(request.value);
  return (
    <Modal
      width={380}
      onClose={() => {
        request.resolve(null);
        close();
      }}
      onSubmit={() => {
        request.resolve(value);
        close();
      }}
    >
      <label>{request.message}</label>
      <input
        data-autofocus
        type={request.password ? 'password' : 'text'}
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <div className="btns">
        <button
          type="button"
          onClick={() => {
            request.resolve(null);
            close();
          }}
        >
          Annuler
        </button>
        <button className="p">Valider</button>
      </div>
    </Modal>
  );
}

export function DialogsProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [request, setRequest] = useState<Request | null>(null);
  const close = useCallback(() => setRequest(null), []);

  const dialogs = useMemo<Dialogs>(() => {
    const alert: Dialogs['alert'] = (message) =>
      new Promise((resolve) => setRequest({ kind: 'alert', message, resolve }));
    return {
      alert,
      confirm: (message, options) =>
        new Promise((resolve) => setRequest({ kind: 'confirm', message, danger: !!options?.danger, resolve })),
      prompt: (message, value = '', options) =>
        new Promise((resolve) =>
          setRequest({ kind: 'prompt', message, value, password: !!options?.password, resolve }),
        ),
      run: async (action) => {
        try {
          await action();
          await queryClient.invalidateQueries();
          return true;
        } catch (err) {
          await alert(err instanceof Error ? err.message : 'Une erreur est survenue.');
          return false;
        }
      },
    };
  }, [queryClient]);

  return (
    <DialogsContext.Provider value={dialogs}>
      {children}
      {request?.kind === 'alert' && (
        <Modal
          width={420}
          onClose={() => {
            request.resolve();
            close();
          }}
        >
          <p className="msg">{request.message}</p>
          <div className="btns">
            <button
              className="p"
              data-autofocus
              onClick={() => {
                request.resolve();
                close();
              }}
            >
              OK
            </button>
          </div>
        </Modal>
      )}
      {request?.kind === 'confirm' && (
        <Modal
          width={440}
          onClose={() => {
            request.resolve(false);
            close();
          }}
        >
          <p className="msg">{request.message}</p>
          <div className="btns">
            <button
              data-autofocus
              onClick={() => {
                request.resolve(false);
                close();
              }}
            >
              Annuler
            </button>
            <button
              className={request.danger ? 'danger' : 'p'}
              onClick={() => {
                request.resolve(true);
                close();
              }}
            >
              Confirmer
            </button>
          </div>
        </Modal>
      )}
      {request?.kind === 'prompt' && <PromptBody request={request} close={close} />}
    </DialogsContext.Provider>
  );
}
