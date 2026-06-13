import type { CustomEvent } from "../../types";
import { isRecurringEvent } from "../../lib/schedule";

export function EventList({ events, today, onToggleEvent }: { events: CustomEvent[]; today: string; onToggleEvent: (event: CustomEvent) => void }) {
  return (
    <div className="event-list">
      {events.map((event) => {
        const done = event.completedDates.includes(today);
        return (
          <button className={`schedule-item ${done ? "done" : ""}`} key={event.id} onClick={() => onToggleEvent(event)}>
            <span>{event.title}</span>
            <small>{isRecurringEvent(event) ? "每日循环" : "临时"}</small>
          </button>
        );
      })}
      {events.length === 0 && <p className="empty">今天没有事件，可以添加一个。</p>}
    </div>
  );
}
