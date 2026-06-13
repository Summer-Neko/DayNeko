import React from "react";
import { CalendarCheck, ImagePlus, MessageSquareText, Plus, TimerReset, UsersRound } from "lucide-react";
import { TimeDashboard } from "../components/TimeDashboard";
import { DateChoicePicker } from "../components/common/DateChoicePicker";
import { PanelTitle } from "../components/ui";
import { ranks } from "../lib/config";
import { isArchiveClosed, yesterdayKey } from "../lib/date";
import { evidenceEntriesForDate } from "../lib/evidence";
import { isRecentlyOnline } from "../lib/presence";
import type { CustomEvent, Friend, FriendDay, FriendRating, FriendRequest, Rank, UserProfile } from "../types";

function FriendEvidenceStrip({
  date,
  event,
  onOpenEvidence
}: {
  date: string;
  event: CustomEvent;
  onOpenEvidence: (event: CustomEvent, index: number, date: string) => void;
}) {
  const evidenceEntries = evidenceEntriesForDate(event, date);
  if (evidenceEntries.length === 0) return null;

  return (
    <div className="evidence-strip compact-evidence">
      {evidenceEntries.map(({ image, index }) => (
        <button className="evidence-thumb" key={image.id} onClick={() => onOpenEvidence(event, index, date)}>
          <img src={image.dataUrl} alt={image.name} />
        </button>
      ))}
    </div>
  );
}

export function FriendsPage(props: {
  currentUser: UserProfile;
  friendHandle: string;
  friends: Friend[];
  friendRequests: FriendRequest[];
  friendStatus: string;
  friendDays: FriendDay[];
  friendDaysLoading: boolean;
  friendNextCursor: string | null;
  ratings: FriendRating[];
  selectedFriend: string;
  ratingRank: Rank;
  ratingComment: string;
  onAddFriend: () => void | Promise<void>;
  onAddRating: (date: string) => void | Promise<void>;
  onHandleRequest: (requestId: string, action: "accept" | "reject") => void;
  onFriendHandle: (value: string) => void;
  onLoadMoreDays: () => void;
  onOpenEvidence: (event: CustomEvent, index: number, date: string) => void;
  onRatingComment: (value: string) => void;
  onRatingRank: (value: Rank) => void;
  onSelectFriend: (id: string) => void;
}) {
  const selected = props.friends.find((friend) => friend.id === props.selectedFriend) ?? props.friends[0];
  const [ratingDate, setRatingDate] = React.useState(yesterdayKey());
  const [friendTab, setFriendTab] = React.useState<"schedule" | "time">("schedule");
  const selectedRatings = props.ratings.filter((rating) => rating.targetUserId === selected?.id);
  const selectedDateRatings = selectedRatings.filter((rating) => rating.date === ratingDate);
  const incomingRequests = props.friendRequests.filter((request) => request.toUserId === props.currentUser.id && request.status === "pending");
  const outgoingRequests = props.friendRequests.filter((request) => request.fromUserId === props.currentUser.id && request.status === "pending");
  const closedDays = props.friendDays.filter((day) => isArchiveClosed(day.date));
  const ratingDates = Array.from(new Set([ratingDate, ...closedDays.map((day) => day.date), ...selectedRatings.map((rating) => rating.date)])).filter(Boolean);
  const ratingDay = props.friendDays.find((day) => day.date === ratingDate);
  const hasRatingEvents = Boolean(ratingDay && ratingDay.events.length > 0);
  const canSubmitRating = Boolean(selected && isArchiveClosed(ratingDate) && hasRatingEvents);

  return (
    <div className="page-stack">
      <header className="page-heading">
        <div>
          <span className="section-kicker">Friends</span>
          <h1>好友</h1>
        </div>
        <div className="inline-form">
          <input
            placeholder="@handle 加好友"
            value={props.friendHandle}
            onChange={(event) => props.onFriendHandle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void props.onAddFriend();
            }}
          />
          <button onClick={() => void props.onAddFriend()}>
            <Plus size={16} />
          </button>
        </div>
      </header>

      <div className="friend-page-grid">
        <section className="workspace-panel friend-network-panel">
          <PanelTitle label="Network" title="好友与申请" icon={<UsersRound size={20} />} />
          <p className="muted">{props.friendStatus}</p>
          {incomingRequests.length > 0 && (
            <div className="request-list">
              <strong>待处理申请</strong>
              {incomingRequests.map((request) => (
                <article className="request-card" key={request.id}>
                  <div>
                    <span>{request.fromName}</span>
                    <small>{request.fromHandle}</small>
                  </div>
                  <button onClick={() => props.onHandleRequest(request.id, "reject")}>拒绝</button>
                  <button className="primary-button mini" onClick={() => props.onHandleRequest(request.id, "accept")}>同意</button>
                </article>
              ))}
            </div>
          )}
          {outgoingRequests.length > 0 && (
            <div className="request-list">
              <strong>已发送申请</strong>
              {outgoingRequests.map((request) => (
                <article className="request-card pending" key={request.id}>
                  <div>
                    <span>{request.toName}</span>
                    <small>{request.toHandle}</small>
                  </div>
                  <em>等待对方同意</em>
                </article>
              ))}
            </div>
          )}
          <div className="friend-list">
            {props.friends.map((friend) => (
              <button className={`friend-item ${props.selectedFriend === friend.id ? "selected" : ""}`} key={friend.id} onClick={() => props.onSelectFriend(friend.id)}>
                <div className="avatar">{friend.avatar ? <img src={friend.avatar} alt="" /> : friend.name.slice(0, 1).toUpperCase()}</div>
                <div>
                  <strong className="friend-name-line">
                    <span className={isRecentlyOnline(friend.lastSeen) ? "presence-dot online" : "presence-dot offline"} />
                    {friend.name}
                  </strong>
                  <span>{friend.status}</span>
                </div>
                <small>{friend.mood}</small>
              </button>
            ))}
            {props.friends.length === 0 && <p className="empty">还没有正式好友。搜索对方 handle 并发送申请，对方同意后才会出现在这里。</p>}
          </div>
        </section>

        <section className="workspace-panel friend-rating-panel">
          <div className={`rank-ghost rank-${props.ratingRank}`}>{props.ratingRank}</div>
          <PanelTitle label="Friend Rating" title="给好友评分" icon={<MessageSquareText size={20} />} />
          {/* <p className="muted">先查看好友当天日程和证据，再写评语并选择等级。只有已经封档的日期可以补评分或修改评分。</p> */}
          <label className="field">
            <span>评分日期</span>
            <DateChoicePicker dates={ratingDates} label="评分日期" value={ratingDate} onChange={setRatingDate} />
          </label>
          <div className="rating-day-events">
            <strong>{ratingDate} 的好友日程</strong>
            {ratingDay?.events.map((event) => {
              const done = event.completedDates.includes(ratingDate);
              const evidenceEntries = evidenceEntriesForDate(event, ratingDate);
              return (
                <article className={done ? "done" : ""} key={event.id}>
                  <div>
                    <span>{event.title}</span>
                    <small>{done ? "已完成" : "未完成"} · 证据 {evidenceEntries.length}</small>
                  </div>
                  <span className={`done-control readonly ${done ? "done" : ""}`}><strong>{done ? "已完成" : "未完成"}</strong></span>
                  <FriendEvidenceStrip date={ratingDate} event={event} onOpenEvidence={props.onOpenEvidence} />
                </article>
              );
            })}
            {!hasRatingEvents && <p className="empty">这天没有待办，不能评分。</p>}
          </div>
          <label className="field">
            <span>评语</span>
            <textarea value={props.ratingComment} onChange={(event) => props.onRatingComment(event.target.value)} />
          </label>
          <div className="rank-row compact-ranks">
            {ranks.map((rank) => (
              <button className={`rank-pill rank-${rank} ${props.ratingRank === rank ? "active" : ""}`} key={rank} onClick={() => props.onRatingRank(rank)}>
                {rank}
              </button>
            ))}
          </div>
          <button className="primary-button" disabled={!canSubmitRating} onClick={() => void props.onAddRating(ratingDate)}>
            {selectedRatings.some((rating) => rating.date === ratingDate) ? "修改评分" : "提交评分"}
          </button>
          {!hasRatingEvents && <p className="muted">这天不能评分，因为没有日程</p>}
          <div className="rating-feed">
            {selectedDateRatings.map((rating) => (
              <article className="rating-card" key={rating.id}>
                <span className={`rank-badge rank-${rating.rank}`}>{rating.rank}</span>
                <div>
                  <strong>{props.currentUser.name} 给 {selected?.name ?? "好友"} · {rating.date}</strong>
                  <p>{rating.comment}</p>
                </div>
              </article>
            ))}
            {selectedDateRatings.length === 0 && <p className="empty">这一天还没有写评语。</p>}
          </div>
        </section>
      </div>

      <section className="workspace-panel friend-detail-panel">
        <div className="friend-detail-head">
          <PanelTitle label="Friend Detail" title={`${selected?.name ?? "选择好友"} 的记录`} icon={<CalendarCheck size={20} />} />
          <div className="segmented compact" style={{ "--seg-index": friendTab === "schedule" ? 0 : 1, "--seg-count": 2 } as React.CSSProperties}>
            <button className={friendTab === "schedule" ? "active" : ""} onClick={() => setFriendTab("schedule")}>日程</button>
            <button className={friendTab === "time" ? "active" : ""} onClick={() => setFriendTab("time")}>时长</button>
          </div>
        </div>
        {!selected && <p className="empty">选择一个好友后，可以按周查看对方的日程记录和每日时长。</p>}
        {selected && friendTab === "schedule" && (
          <div className="schedule-day-list">
            {props.friendDays.map((day) => {
              const rating = selectedRatings.find((item) => item.date === day.date) ?? day.ratings.find((item) => item.raterFriendId === props.currentUser.id);
              return (
                <section className="schedule-day" key={day.date}>
                  {rating && <div className={`rank-ghost rank-${rating.rank}`}>{rating.rank}</div>}
                  <div className="schedule-day-head">
                    <div>
                      <strong>{day.date}</strong>
                      <span>{day.events.length} 个待办 · {rating ? "已评分" : "未评分"}</span>
                    </div>
                    {rating && <span className={`rank-badge rank-${rating.rank}`}>{rating.rank}</span>}
                  </div>
                  <div className="event-list rich">
                    {day.events.map((event) => {
                      const done = event.completedDates.includes(day.date);
                      const evidenceEntries = evidenceEntriesForDate(event, day.date);
                      return (
                        <article className={`event-card ${done ? "done" : ""} locked`} key={event.id}>
                          <div className="event-main">
                            <div>
                              <strong>{event.title}</strong>
                              <span>{done ? "已完成" : "未完成"} · 证据 {evidenceEntries.length}</span>
                            </div>
                            <span className={`done-control readonly ${done ? "done" : ""}`}>
                              <strong>{done ? "已完成" : "未完成"}</strong>
                            </span>
                          </div>
                          <FriendEvidenceStrip date={day.date} event={event} onOpenEvidence={props.onOpenEvidence} />
                        </article>
                      );
                    })}
                    {day.events.length === 0 && <p className="empty">这天没有日程</p>}
                  </div>
                  {!rating && isArchiveClosed(day.date) && <button className="primary-button subtle" onClick={() => setRatingDate(day.date)}>选择这天评分</button>}
                </section>
              );
            })}
            {props.friendDays.length === 0 && !props.friendDaysLoading && <p className="empty">还没有可展示的好友日程。好友需要先同步数据到服务器。</p>}
          </div>
        )}
        {selected && friendTab === "time" && (
          <div className="friend-time-list">
            <TimeDashboard
              availableDates={props.friendDays.map((day) => day.date)}
              activities={props.friendDays.flatMap((day) => day.activities)}
              boots={[]}
              embedded
              ownerLabel={selected.name}
              title={`${selected.name} 的时间地图`}
            />
            {props.friendDays.map((day) => (
              <article className="friend-time-card" key={day.date}>
                <div>
                  <strong>{day.date}</strong>
                  <span>{day.activities.length} 段活动</span>
                </div>
                <b>{Math.round(day.totalMinutes / 60 * 10) / 10}h</b>
                <div className="time-mini-bars">
                  {day.activities.slice(0, 8).map((activity) => (
                    <span
                      key={activity.id}
                      title={`${activity.label} · ${activity.minutes ?? 1} 分钟`}
                      style={{ height: `${Math.max(14, Math.min(86, activity.minutes ?? 1))}%` }}
                    />
                  ))}
                </div>
                {day.activities.length === 0 && <p className="empty">这天没有同步到活动时长。</p>}
              </article>
            ))}
            {props.friendDays.length === 0 && !props.friendDaysLoading && <p className="empty">还没有可展示的每日时长。</p>}
          </div>
        )}
        {selected && (
          <button className="primary-button subtle" disabled={props.friendDaysLoading || !props.friendNextCursor} onClick={props.onLoadMoreDays}>
            {props.friendDaysLoading ? "加载中..." : props.friendNextCursor ? "加载上一周" : "没有更早记录"}
          </button>
        )}
      </section>
    </div>
  );
}
