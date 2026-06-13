import { CalendarCheck, Clock3, Power, Settings, Star, TimerReset } from "lucide-react";
import { EventList } from "../components/events/EventList";
import { Metric, PanelTitle } from "../components/ui";
import { normalizeServerUrl } from "../lib/api";
import { fmtTime, scheduleDateKey } from "../lib/date";
import type { AppState, CustomEvent, FriendRating, PresenceStatus } from "../types";

export function HomePage(props: {
  cloudLoggedIn: boolean;
  doneCount: number;
  eventCount: number;
  events: CustomEvent[];
  latestRating?: FriendRating;
  presence: PresenceStatus;
  pendingFriendRequests: number;
  pendingRatingDays: number;
  serverStatus: string;
  state: AppState;
  onLogin: () => void | Promise<void>;
  onToggleEvent: (event: CustomEvent) => void;
}) {
  const todos = [
    {
      id: "friend-requests",
      title: "处理好友申请",
      value: props.pendingFriendRequests,
      caption: props.pendingFriendRequests > 0 ? `${props.pendingFriendRequests} 个申请等待处理` : "暂时没有新的好友申请"
    },
    {
      id: "pending-ratings",
      title: "待评分日程",
      value: props.pendingRatingDays,
      caption: props.pendingRatingDays > 0 ? `${props.pendingRatingDays} 天好友日程可以补评分` : "没有待评分好友日程"
    }
  ];

  return (
    <div className="page-stack">
      <header className="page-hero">
        <span className="eyebrow">Auto sync · Delta only</span>
        <h1>当前服务器是：{normalizeServerUrl(props.state.settings.serverUrl)}</h1>
        <p>状态：{props.cloudLoggedIn ? props.serverStatus : "本地模式，登录服务器后才会同步和启用好友数据"}</p>
      </header>

      {!props.cloudLoggedIn && (
        <section className="workspace-panel cloud-login-panel">
          <div>
            <span className="section-kicker">Cloud Login</span>
            <h2>登录或注册本设备</h2>
            <p className="muted">服务器会根据本机设备标识分配账号；如果已经存在同一设备账号，会直接登录。</p>
          </div>
          <button className="primary-button" onClick={() => void props.onLogin()}>登录 / 注册本设备</button>
        </section>
      )}

      <div className="metric-row">
        <Metric icon={<Power />} label="本次启动" value={props.state.boots[0] ? fmtTime(props.state.boots[0].startedAt) : "刚刚"} />
        <Metric icon={<Clock3 />} label="NOW" value={props.presence.label} />
        <Metric icon={<Settings />} label="前台" value={props.presence.detail || "少女祈祷中"} />
        <Metric icon={<Star />} label="好友评分" value={props.latestRating?.rank ?? "暂无"} />
      </div>

      <section className="workspace-panel todo-panel">
        <PanelTitle label="Next" title="推荐待办事项" icon={<TimerReset size={20} />} />
        <div className="todo-scroll">
          {todos.map((todo) => (
            <article className={todo.value > 0 ? "todo-card hot" : "todo-card"} key={todo.id}>
              <div>
                <strong>{todo.title}</strong>
                <span>{todo.caption}</span>
              </div>
              <b>{todo.value}</b>
            </article>
          ))}
        </div>
      </section>

      <section className="workspace-panel">
        <PanelTitle label="Events" title="今日自定义日程" icon={<CalendarCheck size={20} />} />
        <EventList events={props.events.slice(0, 4)} today={scheduleDateKey()} onToggleEvent={props.onToggleEvent} />
      </section>

      <section className="workspace-panel focus-panel">
        <div>
          <span className="section-kicker">Now</span>
          <div className="presence-line">
            <span className={props.presence.online ? "presence-dot online" : "presence-dot offline"} />
            <h2>{props.presence.label}</h2>
          </div>
          <p>{props.presence.detail ? `前台：${props.presence.detail}` : "自动检测会每 20 秒更新一次。"}</p>
        </div>
      </section>

    </div>
  );
}
