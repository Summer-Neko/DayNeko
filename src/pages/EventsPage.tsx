import React from "react";
import { CalendarCheck, ChevronLeft, ChevronRight, ImagePlus, Plus, Trash2 } from "lucide-react";
import { PanelTitle, Toggle } from "../components/ui";
import { monthKey, monthLabel, shiftMonth } from "../lib/date";
import { evidenceEntriesForDate } from "../lib/evidence";
import { canEditEvent, eventsForDate, isRecurringEvent, scheduleDates } from "../lib/schedule";
import type { CustomEvent, Friend, FriendRating } from "../types";

export function EventsPage(props: {
  events: CustomEvent[];
  allEvents: CustomEvent[];
  dailyTemplates: CustomEvent[];
  friends: Friend[];
  ratings: FriendRating[];
  month: string;
  today: string;
  onAddEvent: (title: string, repeatDaily: boolean) => boolean;
  onEvidence: (event: CustomEvent, files: FileList | null) => void;
  onOpenEvidence: (event: CustomEvent, index: number, date: string) => void;
  onMonthChange: (month: string) => void;
  onRemoveEvidence: (event: CustomEvent, imageId: string) => void;
  onStartEvidence: (event: CustomEvent) => void;
  onRemoveDailyTemplate: (event: CustomEvent) => void;
  onRemoveEvent: (event: CustomEvent) => void;
  onToggleEvent: (event: CustomEvent) => void;
}) {
  const monthRatings = props.ratings.filter((rating) => rating.date.startsWith(props.month));
  const dates = scheduleDates(props.allEvents, monthRatings).filter((date) => date.startsWith(props.month));
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [eventTitle, setEventTitle] = React.useState("");
  const [repeatDaily, setRepeatDaily] = React.useState(false);
  const friendNameById = React.useMemo(() => {
    return new Map(props.friends.map((friend) => [friend.id, friend.name || friend.handle]));
  }, [props.friends]);
  const currentMonth = monthKey(props.today);
  const canGoNextMonth = props.month < currentMonth;
  const monthEventCount = props.allEvents.filter((event) => event.date.startsWith(props.month)).length;
  const monthDoneCount = props.allEvents.filter((event) => event.completedDates.some((date) => date.startsWith(props.month))).length;

  const raterName = (rating: FriendRating) => {
    return friendNameById.get(rating.raterFriendId) ?? `好友 ${rating.raterFriendId.slice(0, 6)}`;
  };

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
        <div className="schedule-log-head">
          <div>
            <PanelTitle label="Schedule Logs" title="日程记录" icon={<CalendarCheck size={20} />} />
            <p className="muted">按月查看待办与好友评分，只读取当前月份的数据。</p>
          </div>
          <div className="schedule-month-control">
            <button type="button" onClick={() => props.onMonthChange(shiftMonth(props.month, -1))} aria-label="上一月">
              <ChevronLeft size={18} />
            </button>
            <strong>{monthLabel(props.month)}</strong>
            <button
              type="button"
              disabled={!canGoNextMonth}
              onClick={() => canGoNextMonth && props.onMonthChange(shiftMonth(props.month, 1))}
              aria-label="下一月"
            >
              <ChevronRight size={18} />
            </button>
            {props.month !== currentMonth && (
              <button className="schedule-month-today" type="button" onClick={() => props.onMonthChange(currentMonth)}>
                本月
              </button>
            )}
          </div>
        </div>
        <div className="schedule-month-summary">
          <span>{monthEventCount} 个待办</span>
          <span>{monthDoneCount} 个完成记录</span>
          <span>{monthRatings.length} 条好友评分</span>
        </div>
        <div className="schedule-day-list">
          {dates.map((date) => {
            const events = eventsForDate(props.allEvents, date);
            const ratings = monthRatings.filter((rating) => rating.date === date);
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
                <div className="schedule-day-scroll">
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
                                <div className="evidence-thumb" key={image.id}>
                                  <button className="evidence-preview" type="button" onClick={() => props.onOpenEvidence(event, index, date)}>
                                    <img src={image.dataUrl} alt={image.name} />
                                  </button>
                                  {editable && (
                                    <button
                                      className="evidence-remove"
                                      type="button"
                                      aria-label="删除证据图片"
                                      onClick={() => props.onRemoveEvidence(event, image.id)}
                                    >
                                      <Trash2 size={12} />
                                    </button>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                        </article>
                      );
                    })}
                    {events.length === 0 && <p className="empty">这天没有日程</p>}
                  </div>
                  {ratings.length > 0 && (
                    <div className="schedule-rating-list">
                      {ratings.map((rating) => (
                        <article className="schedule-rating-card" key={rating.id}>
                          <span className={`rank-badge rank-${rating.rank}`}>{rating.rank}</span>
                          <div>
                            <strong>{raterName(rating)} · {rating.date}</strong>
                            <p>{rating.comment}</p>
                          </div>
                        </article>
                      ))}
                    </div>
                  )}
                </div>
              </section>
            );
          })}
          {dates.length === 0 && <p className="empty">这个月还没有日程记录。</p>}
        </div>
      </section>
    </div>
  );
}
