import { AlertCircle, CheckCircle2, Info, LoaderCircle, X } from "lucide-react";
import type { AppNotification, AppNotificationKind } from "../../hooks/useAppNotifications";

function iconFor(kind: AppNotificationKind) {
  if (kind === "success") return <CheckCircle2 size={18} />;
  if (kind === "warning" || kind === "error") return <AlertCircle size={18} />;
  if (kind === "loading") return <LoaderCircle className="app-notification-spin" size={18} />;
  return <Info size={18} />;
}

export function AppNotifications({ items, onDismiss }: { items: AppNotification[]; onDismiss: (id: string) => void }) {
  return (
    <div className="app-notification-stack" aria-live="polite" aria-label="应用消息">
      {items.map((item) => (
        <article className={`app-notification ${item.kind} ${item.exiting ? "exiting" : ""}`} key={item.id}>
          <div className="app-notification-icon">{iconFor(item.kind)}</div>
          <div>
            <strong>{item.title}</strong>
            <p>{item.message}</p>
          </div>
          <button aria-label="关闭消息" onClick={() => onDismiss(item.id)}>
            <X size={15} />
          </button>
        </article>
      ))}
    </div>
  );
}
