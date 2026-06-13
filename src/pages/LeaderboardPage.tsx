import React from "react";
import type { LeaderboardEntry, LeaderboardScope } from "../types";

export function LeaderboardPage({
  entries,
  scope,
  onScope
}: {
  entries: LeaderboardEntry[];
  scope: LeaderboardScope;
  onScope: (scope: LeaderboardScope) => void;
}) {
  return (
    <div className="page-stack">
      <header className="page-heading">
        <div>
          <span className="section-kicker">Server Ranking</span>
          <h1>服务器排行榜</h1>
        </div>
        <div className="segmented" style={{ "--seg-index": scope === "7d" ? 0 : 1, "--seg-count": 2 } as React.CSSProperties}>
          <button className={scope === "7d" ? "active" : ""} onClick={() => onScope("7d")}>7 日榜</button>
          <button className={scope === "all" ? "active" : ""} onClick={() => onScope("all")}>总榜</button>
        </div>
      </header>
      <section className="workspace-panel leaderboard-panel">
        {entries.map((entry, index) => (
          <article className="leaderboard-row" key={entry.userId}>
            <span className="place">#{index + 1}</span>
            <div>
              <strong>{entry.name}</strong>
              <small>{entry.handle} · 完成 {entry.completed} · 评分天数 {entry.ratedDays}</small>
            </div>
            <span className={`rank-badge rank-${entry.rank}`}>{entry.rank}</span>
            <strong>{Math.round(entry.score)}</strong>
          </article>
        ))}
      </section>
    </div>
  );
}
