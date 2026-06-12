import React from "react";
import { mergeActivitySegments } from "../lib/activity";
import type { ActivityEntry, BootEvent } from "../types";

const scheduleDateKey = () => {
  const beijing = new Date(Date.now() + 8 * 60 * 60 * 1000);
  if (beijing.getUTCHours() < 2) beijing.setUTCDate(beijing.getUTCDate() - 1);
  return beijing.toISOString().slice(0, 10);
};

const minutesBetween = (start: string, end?: string) => {
  const finish = end ? new Date(end).getTime() : Date.now();
  return Math.max(1, Math.round((finish - new Date(start).getTime()) / 60000));
};

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

export function TimePage({ activities, boots }: { activities: ActivityEntry[]; boots: BootEvent[] }) {
  return <TimeDashboard activities={activities} boots={boots} title="时间地图" ownerLabel="我的" />;
}

export function TimeDashboard({
  activities,
  boots,
  embedded = false,
  ownerLabel,
  title
}: {
  activities: ActivityEntry[];
  boots: BootEvent[];
  embedded?: boolean;
  ownerLabel: string;
  title: string;
}) {
  const [view, setView] = React.useState<"today" | "overview">("today");
  const [overviewScope, setOverviewScope] = React.useState<"7d" | "all">("7d");
  const now = Date.now();
  const today = scheduleDateKey();
  const lastBoot = boots[0];
  const dayStart = new Date(`${today}T00:00:00+08:00`).getTime();
  const rangeStart = dayStart;
  const rangeEnd = dayStart + 24 * 60 * 60 * 1000;
  const totalRangeMinutes = Math.max(1, Math.round((rangeEnd - rangeStart) / 60000));
  const displayActivities = mergeActivitySegments(activities);
  const todayActivities = displayActivities.filter((activity) => overlapMinutes(activity.startedAt, activity.endedAt, rangeStart, rangeEnd) > 0);
  const bootStart = lastBoot ? new Date(lastBoot.startedAt).getTime() : 0;
  const bootEnd = now;
  const bootLeft = lastBoot ? clampPercent(((Math.max(bootStart, rangeStart) - rangeStart) / (rangeEnd - rangeStart)) * 100) : 0;
  const bootWidth = lastBoot ? clampPercent(((Math.min(bootEnd, rangeEnd) - Math.max(bootStart, rangeStart)) / (rangeEnd - rangeStart)) * 100) : 0;
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
  const overviewActivities = displayActivities.filter((activity) => (activity.endedAt ? new Date(activity.endedAt).getTime() : now) >= overviewStart);
  const overview = Array.from(new Set(overviewActivities.map((activity) => activity.label))).map((label) => {
    const items = overviewActivities.filter((activity) => activity.label === label);
    return {
      label,
      minutes: items.reduce((sum, activity) => sum + (
        overviewScope === "7d"
          ? overlapMinutes(activity.startedAt, activity.endedAt, overviewStart, now)
          : minutesBetween(activity.startedAt, activity.endedAt)
      ), 0),
      count: items.length
    };
  }).sort((a, b) => b.minutes - a.minutes);
  const totalActivityMinutes = overview.reduce((sum, item) => sum + item.minutes, 0);
  const longest = Math.max(...overview.map((item) => item.minutes), 1);

  return (
    <div className={embedded ? "embedded-time-dashboard" : "page-stack"}>
      <header className="page-heading">
        <div>
          <span className="section-kicker">Time Map</span>
          <h1>{title}</h1>
          <p>{ownerLabel}的活动时间会按启动时间轴定位，空隙会自然留下来。</p>
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
              <h2>{today}</h2>
              <p>按小时展示，基准范围为 00:00 - 24:00。</p>
            </div>
            <strong>{Math.round(totalRangeMinutes / 60)}h</strong>
          </div>
          <div className="time-ruler" aria-hidden="true">
            {hourLabels.map((tick, index) => <span key={`${tick.label}-${index}`} style={{ left: `${tick.left}%` }}>{tick.label}</span>)}
          </div>
          <div className="boot-axis">
            <div className="time-lane-label">
              <strong>启动</strong>
              <span>{lastBoot ? "应用运行基准线" : "今天还没有启动记录"}</span>
            </div>
            <div className="boot-axis-line">
              {axisTicks.map((tick, index) => <b key={`${tick.label}-${index}`} style={{ left: `${tick.left}%` }} />)}
              {lastBoot && <i style={{ left: `${bootLeft}%`, width: `${Math.max(1.4, bootWidth)}%` }} />}
            </div>
          </div>
          <div className="time-lane-list">
            {lanes.map((lane) => (
              <article className="time-lane" key={lane.label}>
                <div className="time-lane-label">
                  <strong>{lane.label}</strong>
                  <span>{lane.minutes}m</span>
                </div>
                <div className="time-lane-track">
                  {axisTicks.map((tick, index) => <b key={`${tick.label}-${index}`} style={{ left: `${tick.left}%` }} />)}
                  {lane.segments.map((activity) => {
                    const start = new Date(activity.startedAt).getTime();
                    const end = activity.endedAt ? new Date(activity.endedAt).getTime() : now;
                    const left = clampPercent(((Math.max(start, rangeStart) - rangeStart) / (rangeEnd - rangeStart)) * 100);
                    const width = clampPercent(((Math.min(end, rangeEnd) - Math.max(start, rangeStart)) / (rangeEnd - rangeStart)) * 100);
                    return (
                      <span
                        className="time-segment"
                        key={activity.id}
                        style={{ left: `${left}%`, width: `${Math.max(1.6, width)}%` }}
                        title={`${activity.label} · ${shortClock(activity.startedAt)} - ${activity.endedAt ? shortClock(activity.endedAt) : "现在"}`}
                      />
                    );
                  })}
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
              <small>{overviewScope === "7d" ? "近 7 天" : "全部"}累计 {totalActivityMinutes} 分钟</small>
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
                title={`${item.label} · ${item.minutes}m`}
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
                <b>{item.minutes}m</b>
              </article>
            ))}
            {overview.length === 0 && <p className="empty">有明确活动记录后，总览会展示活动分布。</p>}
          </div>
        </section>
      )}
    </div>
  );
}
