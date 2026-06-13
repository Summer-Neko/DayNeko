import React from "react";
import { CalendarCheck, ImagePlus, Plus, Trash2 } from "lucide-react";
import { PanelTitle, Toggle } from "../components/ui";
import { evidenceEntriesForDate } from "../lib/evidence";
import { canEditEvent, eventsForDate, isRecurringEvent, scheduleDates } from "../lib/schedule";
import type { CustomEvent, FriendRating } from "../types";

export function EventsPage(props: {
  events: CustomEvent[];
  allEvents: CustomEvent[];
  dailyTemplates: CustomEvent[];
  ratings: FriendRating[];
  today: string;
  onAddEvent: (title: string, repeatDaily: boolean) => boolean;
  onEvidence: (event: CustomEvent, files: FileList | null) => void;
  onOpenEvidence: (event: CustomEvent, index: number, date: string) => void;
  onStartEvidence: (event: CustomEvent) => void;
  onRemoveDailyTemplate: (event: CustomEvent) => void;
  onRemoveEvent: (event: CustomEvent) => void;
  onToggleEvent: (event: CustomEvent) => void;
}) {
  const dates = scheduleDates(props.allEvents, props.ratings);
  const [visibleDays, setVisibleDays] = React.useState(30);
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [eventTitle, setEventTitle] = React.useState("");
  const [repeatDaily, setRepeatDaily] = React.useState(false);
  const visibleDates = dates.slice(0, visibleDays);

  React.useEffect(() => {
    setVisibleDays(30);
  }, [props.allEvents.length, props.ratings.length]);

  const submitEvent = () => {
    const ok = props.onAddEvent(eventTitle, repeatDaily);
    if (!ok) return;
    setEventTitle("");
    setRepeatDaily(false);
    setDialogOpen(false);
  };

  return (
    <div className="page-stack">
      <header className="page-heading">
        <div>
          <span className="section-kicker">Custom Schedule</span>
          <h1>日程</h1>
        </div>
        <button className="schedule-add-button" onClick={() => setDialogOpen(true)} aria-label="添加日程">
          <Plus size={22} />
        </button>
      </header>

      {dialogOpen && (
        <div className="schedule-dialog" role="dialog" aria-modal="true">
          <div className="schedule-dialog-panel">
            <header>
              <div>
                <span className="section-kicker">Add Schedule</span>
                <strong>添加日程</strong>
              </div>
              <button type="button" onClick={() => setDialogOpen(false)}>关闭</button>
            </header>
            <div className="schedule-dialog-form">
              <input
                autoFocus
                placeholder="添加一个待办"
                value={eventTitle}
                onChange={(event) => setEventTitle(event.target.value)}
                onKeyDown={(event) => event.key === "Enter" && submitEvent()}
              />
              <Toggle checked={repeatDaily} label="每日循环" onChange={setRepeatDaily} compact />
              <button className="primary-button" type="button" onClick={submitEvent}>
                <Plus size={16} />
                添加
              </button>
            </div>
            <section className="daily-template-list">
              <div>
                <strong>已有每日循环</strong>
                <span>删除后只停止未来自动添加，历史日程保留。</span>
              </div>
              {props.dailyTemplates.map((template) => (
                <article key={template.id}>
                  <div>
                    <strong>{template.title}</strong>
                    <span>从 {template.date} 开始</span>
                  </div>
                  <button type="button" onClick={() => props.onRemoveDailyTemplate(template)}>
                    <Trash2 size={16} />
                  </button>
                </article>
              ))}
              {props.dailyTemplates.length === 0 && <p className="empty">还没有每日循环待办。</p>}
            </section>
          </div>
        </div>
      )}

      <section className="workspace-panel">
        <PanelTitle label="Schedule Logs" title="日程记录" icon={<CalendarCheck size={20} />} />
        <p className="muted">今天也要元气满满</p>
        <div className="schedule-day-list">
          {visibleDates.map((date) => {
            const events = eventsForDate(props.allEvents, date);
            const ratings = props.ratings.filter((rating) => rating.date === date);
            const isToday = date === props.today;
            return (
              <section className="schedule-day" key={date}>
                {ratings[0] && <div className={`rank-ghost rank-${ratings[0].rank}`}>{ratings[0].rank}</div>}
                <div className="schedule-day-head">
                  <div>
                    <strong>{isToday ? "今日待办" : date}</strong>
                    <span>{events.length} 个待办 · {ratings.length} 条好友评分</span>
                  </div>
                  {ratings[0] && <span className={`rank-badge rank-${ratings[0].rank}`}>{ratings[0].rank}</span>}
                </div>
                <div className="event-list rich">
                  {events.map((event) => {
                    const editable = canEditEvent(event, props.today) && isToday;
                    const done = event.completedDates.includes(date);
                    const evidenceEntries = evidenceEntriesForDate(event, date);
                    return (
                      <article className={`event-card ${done ? "done" : ""} ${editable ? "" : "locked"}`} key={`${date}-${event.id}`}>
                        <div className="event-main">
                          <div>
                            <strong>{event.title}</strong>
                            <span>{isRecurringEvent(event) ? "每日循环" : "当天临时"} · 证据 {evidenceEntries.length} {editable ? "" : "· 已锁定"}</span>
                          </div>
                          <button className="done-control" disabled={!editable} onClick={() => props.onToggleEvent(event)}>
                            <strong>{done ? "已完成" : "待完成"}</strong>
                          </button>
                        </div>
                        <div className="event-actions">
                          <button className={`icon-upload ${editable ? "" : "disabled"}`} disabled={!editable} onClick={() => props.onStartEvidence(event)}>
                            <ImagePlus size={16} />
                          </button>
                          <button disabled={!editable} onClick={() => props.onRemoveEvent(event)}>
                            <Trash2 size={16} />
                          </button>
                        </div>
                        {evidenceEntries.length > 0 && (
                          <div className="evidence-strip">
                            {evidenceEntries.map(({ image, index }) => (
                              <button className="evidence-thumb" key={image.id} onClick={() => props.onOpenEvidence(event, index, date)}>
                                <img src={image.dataUrl} alt={image.name} />
                              </button>
                            ))}
                          </div>
                        )}
                      </article>
                    );
                  })}
                  {events.length === 0 && <p className="empty">这天没有日程</p>}
                </div>
                {ratings.map((rating) => (
                  <article className="rating-card" key={rating.id}>
                    <span className={`rank-badge rank-${rating.rank}`}>{rating.rank}</span>
                    <div>
                      <strong>好友评分 · {rating.date}</strong>
                      <p>{rating.comment}</p>
                    </div>
                  </article>
                ))}
              </section>
            );
          })}
          {visibleDates.length < dates.length && (
            <button className="primary-button subtle" onClick={() => setVisibleDays((value) => value + 30)}>
              加载更早记录
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
