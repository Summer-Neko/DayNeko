import React from "react";
import { DateChoicePicker } from "./common/DateChoicePicker";
import { mergeActivitySegments } from "../lib/activity";
import type { ActivityEntry, BootEvent } from "../types";

const scheduleDateKey = () => {
  const beijing = new Date(Date.now() + 8 * 60 * 60 * 1000);
  if (beijing.getUTCHours() < 2) beijing.setUTCDate(beijing.getUTCDate() - 1);
  return beijing.toISOString().slice(0, 10);
};

const beijingDateKey = (value: string) => new Date(new Date(value).getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);

const minutesBetween = (start: string, end?: string) => {
  const finish = end ? new Date(end).getTime() : Date.now();
  return Math.max(1, Math.round((finish - new Date(start).getTime()) / 60000));
};

function formatDuration(minutes: number) {
  if (minutes < 60) return `${minutes}m`;
  const hours = minutes / 60;
  return `${Number.isInteger(hours) ? hours.toFixed(0) : hours.toFixed(1)}h`;
}

function clampPercent(value: number) {
  return Math.max(0, Math.min(100, value));
}

function shortClock(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function overlapMinutes(start: string, end: string | undefined, rangeStart: number, rangeEnd: number) {
  const from = Math.max(new Date(start).getTime(), rangeStart);
  const to = Math.min(end ? new Date(end).getTime() : Date.now(), rangeEnd);
  return Math.max(0, Math.round((to - from) / 60000));
}

function compactActivityLabel(label: string) {
  return label
    .replace(/^正在/, "")
    .replace(/^玩/, "")
    .replace(/^听/, "")
    .trim()
    .slice(0, 4) || label.slice(0, 2);
}

function segmentStyle(start: string, end: string | undefined, now: number, rangeStart: number, rangeEnd: number) {
  const startTime = new Date(start).getTime();
  const endTime = end ? new Date(end).getTime() : now;
  const left = clampPercent(((Math.max(startTime, rangeStart) - rangeStart) / (rangeEnd - rangeStart)) * 100);
  const width = clampPercent(((Math.min(endTime, rangeEnd) - Math.max(startTime, rangeStart)) / (rangeEnd - rangeStart)) * 100);
  return { left: `${left}%`, width: `${Math.max(1.4, width)}%` };
}

export function TimePage({ activities, boots }: { activities: ActivityEntry[]; boots: BootEvent[] }) {
  return <TimeDashboard activities={activities} boots={boots} title="时间地图" ownerLabel="我的" />;
}

export function TimeDashboard({
  activities,
  availableDates = [],
  boots,
  embedded = false,
  ownerLabel,
  title
}: {
  activities: ActivityEntry[];
  availableDates?: string[];
  boots: BootEvent[];
  embedded?: boolean;
  ownerLabel: string;
  title: string;
}) {
  const [view, setView] = React.useState<"today" | "overview">("today");
  const [overviewScope, setOverviewScope] = React.useState<"7d" | "all">("7d");
  const now = Date.now();
  const currentDate = scheduleDateKey();

  const dateChoices = React.useMemo(() => {
    const fromActivities = activities.flatMap((activity) => [
      beijingDateKey(activity.startedAt),
      activity.endedAt ? beijingDateKey(activity.endedAt) : ""
    ]);
    const fromBoots = boots.flatMap((boot) => [
      beijingDateKey(boot.startedAt),
      boot.endedAt ? beijingDateKey(boot.endedAt) : ""
    ]);
    const baseDates = embedded ? [] : [currentDate];
    return Array.from(new Set([...baseDates, ...availableDates, ...fromActivities, ...fromBoots].filter(Boolean))).sort((a, b) => b.localeCompare(a));
  }, [activities, availableDates, boots, currentDate, embedded]);

  const [selectedDate, setSelectedDate] = React.useState(() => availableDates[0] ?? currentDate);

  React.useEffect(() => {
    if (!dateChoices.includes(selectedDate)) setSelectedDate(dateChoices[0] ?? currentDate);
  }, [currentDate, dateChoices, selectedDate]);

  const dayStart = new Date(`${selectedDate}T00:00:00+08:00`).getTime();
  const rangeStart = dayStart;
  const rangeEnd = dayStart + 24 * 60 * 60 * 1000;
  const displayActivities = React.useMemo(() => mergeActivitySegments(activities), [activities]);
  const todayActivities = displayActivities.filter((activity) => overlapMinutes(activity.startedAt, activity.endedAt, rangeStart, rangeEnd) > 0);
  const bootIntervals = boots
    .filter((boot) => overlapMinutes(boot.startedAt, boot.endedAt, rangeStart, rangeEnd) > 0)
    .sort((a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime());
  const bootMinutes = bootIntervals.reduce((sum, boot) => sum + overlapMinutes(boot.startedAt, boot.endedAt, rangeStart, rangeEnd), 0);
  const axisTicks = Array.from({ length: 25 }, (_, index) => {
    const at = rangeStart + index * 60 * 60 * 1000;
    return {
      left: (index / 24) * 100,
      label: shortClock(new Date(at).toISOString())
    };
  });
  const hourLabels = axisTicks.filter((_, index) => index % 4 === 0);
  const lanes = Array.from(new Set(todayActivities.map((activity) => activity.label))).map((label) => ({
    label,
    minutes: todayActivities
      .filter((activity) => activity.label === label)
      .reduce((sum, activity) => sum + overlapMinutes(activity.startedAt, activity.endedAt, rangeStart, rangeEnd), 0),
    segments: todayActivities.filter((activity) => activity.label === label)
  })).sort((a, b) => b.minutes - a.minutes);
  const overviewStart = overviewScope === "7d" ? now - 7 * 24 * 60 * 60 * 1000 : 0;
  const overview = Array.from(displayActivities.reduce((map, activity) => {
    if ((activity.endedAt ? new Date(activity.endedAt).getTime() : now) < overviewStart) return map;
    const current = map.get(activity.label) ?? { label: activity.label, minutes: 0, count: 0 };
    current.minutes += (
        overviewScope === "7d"
          ? overlapMinutes(activity.startedAt, activity.endedAt, overviewStart, now)
          : minutesBetween(activity.startedAt, activity.endedAt)
      );
    current.count += 1;
    map.set(activity.label, current);
    return map;
  }, new Map<string, { label: string; minutes: number; count: number }>()).values()).sort((a, b) => b.minutes - a.minutes);
  const totalActivityMinutes = overview.reduce((sum, item) => sum + item.minutes, 0);
  const longest = Math.max(...overview.map((item) => item.minutes), 1);

  return (
    <div className={embedded ? "embedded-time-dashboard" : "page-stack"}>
      <header className="page-heading">
        <div>
          <span className="section-kicker">Time Map</span>
          <h1>{title}</h1>
          <p>{ownerLabel}记录，痕迹会自然留下来。</p>
        </div>
        <div className="segmented" style={{ "--seg-index": view === "today" ? 0 : 1, "--seg-count": 2 } as React.CSSProperties}>
          <button className={view === "today" ? "active" : ""} onClick={() => setView("today")}>当天</button>
          <button className={view === "overview" ? "active" : ""} onClick={() => setView("overview")}>总览</button>
        </div>
      </header>

      {view === "today" && (
        <section className="workspace-panel time-today-panel">
          <div className="time-axis-head">
            <div>
              <span className="section-kicker">Today</span>
              <DateChoicePicker dates={dateChoices} label="查看日期" value={selectedDate} onChange={setSelectedDate} />
              <p></p>
            </div>
            <strong>{Math.round((rangeEnd - rangeStart) / 60 / 60 / 1000)}h</strong>
          </div>
          <div className="time-ruler" aria-hidden="true">
            {hourLabels.map((tick, index) => <span key={`${tick.label}-${index}`} style={{ left: `${tick.left}%` }}>{tick.label}</span>)}
          </div>
          <div className="boot-axis">
            <div className="time-lane-label">
              <strong>应用</strong>
              <span>{bootIntervals.length ? `已启动 ${bootIntervals.length} 次 · ${formatDuration(bootMinutes)}` : "今天还没有启动记录"}</span>
            </div>
            <div className="boot-axis-line">
              {axisTicks.map((tick, index) => <b key={`${tick.label}-${index}`} style={{ left: `${tick.left}%` }} />)}
              {bootIntervals.map((boot) => (
                <i
                  key={boot.id}
                  style={segmentStyle(boot.startedAt, boot.endedAt, now, rangeStart, rangeEnd)}
                  title={`应用运行 · ${shortClock(boot.startedAt)} - ${boot.endedAt ? shortClock(boot.endedAt) : "现在"}`}
                />
              ))}
            </div>
          </div>
          <div className="time-lane-list">
            {lanes.map((lane) => (
              <article className="time-lane" key={lane.label}>
                <div className="time-lane-label">
                  <strong>{lane.label}</strong>
                  <span>{formatDuration(lane.minutes)}</span>
                </div>
                <div className="time-lane-track">
                  {axisTicks.map((tick, index) => <b key={`${tick.label}-${index}`} style={{ left: `${tick.left}%` }} />)}
                  {lane.segments.map((activity) => (
                    <span
                      className="time-segment"
                      key={activity.id}
                      style={segmentStyle(activity.startedAt, activity.endedAt, now, rangeStart, rangeEnd)}
                      title={`${activity.label} · ${shortClock(activity.startedAt)} - ${activity.endedAt ? shortClock(activity.endedAt) : "现在"}`}
                    />
                  ))}
                </div>
              </article>
            ))}
            {lanes.length === 0 && <p className="empty">今天还没有可记录的明确活动。未知状态会显示在首页，但不会写入时间记录。</p>}
          </div>
        </section>
      )}

      {view === "overview" && (
        <section className="workspace-panel time-overview-panel">
          <div className="time-overview-hero">
            <div>
              <span className="section-kicker">Overview</span>
              <strong>活动类型排行榜</strong>
              <small>{overviewScope === "7d" ? "近 7 天" : "全部"}累计 {formatDuration(totalActivityMinutes)}</small>
            </div>
            <div className="segmented compact" style={{ "--seg-index": overviewScope === "7d" ? 0 : 1, "--seg-count": 2 } as React.CSSProperties}>
              <button className={overviewScope === "7d" ? "active" : ""} onClick={() => setOverviewScope("7d")}>近 7 天</button>
              <button className={overviewScope === "all" ? "active" : ""} onClick={() => setOverviewScope("all")}>全部</button>
            </div>
          </div>
          <div className="time-orbit">
            {overview.slice(0, 8).map((item, index) => (
              <span
                key={item.label}
                style={{
                  "--orbit-x": `${50 + Math.cos((index / Math.max(1, Math.min(8, overview.length))) * Math.PI * 2 - Math.PI / 2) * 34}%`,
                  "--orbit-y": `${50 + Math.sin((index / Math.max(1, Math.min(8, overview.length))) * Math.PI * 2 - Math.PI / 2) * 34}%`,
                  "--orbit-size": `${Math.max(42, 42 + (item.minutes / longest) * 64)}px`
                } as React.CSSProperties}
                title={`${item.label} · ${formatDuration(item.minutes)}`}
              >
                {compactActivityLabel(item.label)}
              </span>
            ))}
          </div>
          <div className="time-rank-list">
            {overview.map((item) => (
              <article className="time-rank-row" key={item.label}>
                <div>
                  <strong>{item.label}</strong>
                  <span>{item.count} 段记录</span>
                </div>
                <div className="time-rank-bar">
                  <span style={{ width: `${Math.max(4, (item.minutes / longest) * 100)}%` }} />
                </div>
                <b>{formatDuration(item.minutes)}</b>
              </article>
            ))}
            {overview.length === 0 && <p className="empty">有明确活动记录后，总览会展示活动分布。</p>}
          </div>
        </section>
      )}
    </div>
  );
}
