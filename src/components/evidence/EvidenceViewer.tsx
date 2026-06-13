import { evidenceEntriesForDate } from "../../lib/evidence";
import type { CustomEvent, EvidenceSelection } from "../../types";

export function EvidenceViewer({
  events,
  onClose,
  onMove,
  selection
}: {
  events: CustomEvent[];
  onClose: () => void;
  onMove: (selection: EvidenceSelection) => void;
  selection: EvidenceSelection | null;
}) {
  if (!selection) return null;
  const event = events.find((item) => item.id === selection.eventId);
  const entries = event
    ? selection.date
      ? evidenceEntriesForDate(event, selection.date)
      : event.evidence.map((image, index) => ({ image, index }))
    : [];
  const selectedPosition = Math.max(0, entries.findIndex((entry) => entry.index === selection.index));
  const images = entries.map((entry) => entry.image);
  const image = images[selectedPosition];
  if (!event || !image) return null;
  const move = (direction: -1 | 1) => {
    const nextPosition = (selectedPosition + direction + entries.length) % entries.length;
    onMove({ eventId: event.id, index: entries[nextPosition].index, date: selection.date });
  };
  return (
    <div className="lightbox" role="dialog" aria-modal="true">
      <button className="lightbox-backdrop" onClick={onClose} />
      <div className="lightbox-panel">
        <header>
          <div>
            <strong>{event.title}</strong>
            <span>{selectedPosition + 1} / {images.length} · {image.name}</span>
          </div>
          <button onClick={onClose}>关闭</button>
        </header>
        <div className="lightbox-body">
          {images.length > 1 && <button onClick={() => move(-1)}>‹</button>}
          <img src={image.dataUrl} alt={image.name} />
          {images.length > 1 && <button onClick={() => move(1)}>›</button>}
        </div>
      </div>
    </div>
  );
}
