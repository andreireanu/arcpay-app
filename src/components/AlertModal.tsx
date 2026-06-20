import { useEscapeKey } from "../hooks/useEscapeKey";
import s from "../styles/dashboard.module.css";

interface Props {
  // The message to show; the modal is hidden when null.
  message: string | null;
  onClose: () => void;
  title?: string;
}

// Minimal informational popup (e.g. an action the backend refused). Shared so any
// page can surface an error the same way.
export default function AlertModal({ message, onClose, title = "Heads up" }: Props) {
  useEscapeKey(!!message, onClose);
  if (!message) return null;
  return (
    <div className={s.modalOverlay} onClick={onClose}>
      <div className={s.modal} onClick={(e) => e.stopPropagation()}>
        <h2 className={s.modalTitle}>{title}</h2>
        <p className={s.modalDescription}>{message}</p>
        <div className={s.modalActions}>
          <button className={s.modalSubmitButton} onClick={onClose}>
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
