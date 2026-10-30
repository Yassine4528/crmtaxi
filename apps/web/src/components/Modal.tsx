import { useEffect, useRef, type FormEvent, type ReactNode } from 'react';

interface ModalProps {
  title?: ReactNode;
  width?: number;
  onClose: () => void;
  onSubmit?: () => void;
  children: ReactNode;
}

/** Fenêtre modale native : piège le focus, se ferme avec Échap et s'empile au-dessus des autres. */
export function Modal({ title, width, onClose, onSubmit, children }: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current!;
    if (!dialog.open) dialog.showModal();
    // showModal() donne le focus au premier champ : on le place sur celui choisi par le formulaire
    dialog.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    return () => dialog.close();
  }, []);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit?.();
  };

  return (
    <dialog
      ref={ref}
      className="box"
      style={width ? { width } : undefined}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      {onSubmit ? (
        <form onSubmit={handleSubmit}>
          {title && <h2>{title}</h2>}
          {children}
        </form>
      ) : (
        <>
          {title && <h2>{title}</h2>}
          {children}
        </>
      )}
    </dialog>
  );
}
