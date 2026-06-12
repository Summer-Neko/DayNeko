import React from "react";

export function FloatingScrollbar({ targetRef }: { targetRef: React.RefObject<HTMLElement | null> }) {
  const [metrics, setMetrics] = React.useState({ visible: false, top: 0, height: 0 });
  const hideTimer = React.useRef<number | null>(null);
  const dragState = React.useRef<{ startY: number; startScrollTop: number } | null>(null);

  const update = React.useCallback((show = false) => {
    const target = targetRef.current;
    if (!target) return;
    const { scrollTop, scrollHeight, clientHeight } = target;
    const scrollable = scrollHeight > clientHeight + 2;
    if (!scrollable) {
      setMetrics({ visible: false, top: 0, height: 0 });
      return;
    }
    const viewportHeight = window.innerHeight;
    const thumbHeight = Math.max(54, (clientHeight / scrollHeight) * viewportHeight);
    const maxTop = viewportHeight - thumbHeight - 12;
    const top = 6 + (scrollTop / (scrollHeight - clientHeight)) * maxTop;
    setMetrics({ visible: show || metrics.visible, top, height: thumbHeight });
    if (show) {
      if (hideTimer.current) window.clearTimeout(hideTimer.current);
      hideTimer.current = window.setTimeout(() => {
        setMetrics((prev) => ({ ...prev, visible: false }));
      }, 1100);
    }
  }, [metrics.visible, targetRef]);

  React.useEffect(() => {
    const target = targetRef.current;
    if (!target) return;
    const onScroll = () => update(true);
    const onResize = () => update(false);
    target.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize);
    update(false);
    return () => {
      target.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
      if (hideTimer.current) window.clearTimeout(hideTimer.current);
    };
  }, [targetRef, update]);

  React.useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      const target = targetRef.current;
      const drag = dragState.current;
      if (!target || !drag) return;
      const scrollable = target.scrollHeight - target.clientHeight;
      const track = window.innerHeight - metrics.height - 12;
      const delta = event.clientY - drag.startY;
      target.scrollTop = drag.startScrollTop + (delta / Math.max(1, track)) * scrollable;
      update(true);
    };
    const onPointerUp = () => {
      dragState.current = null;
    };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, [metrics.height, targetRef, update]);

  if (!metrics.height) return null;
  return (
    <div className={`floating-scrollbar ${metrics.visible ? "visible" : ""}`} aria-hidden="true">
      <button
        className="floating-scrollbar-thumb"
        style={{ height: metrics.height, transform: `translateY(${metrics.top}px)` }}
        onPointerDown={(event) => {
          const target = targetRef.current;
          if (!target) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          dragState.current = { startY: event.clientY, startScrollTop: target.scrollTop };
          update(true);
        }}
      />
    </div>
  );
}

export function Toggle({
  checked,
  compact = false,
  label,
  onChange
}: {
  checked: boolean;
  compact?: boolean;
  label: string;
  onChange: (value: boolean) => void;
}) {
  return (
    <button className={`toggle-row ${compact ? "compact" : ""}`} type="button" onClick={() => onChange(!checked)}>
      <span>{label}</span>
      <span className={`switch ${checked ? "on" : ""}`} aria-hidden="true">
        <span />
      </span>
    </button>
  );
}

export function NavButton({ active, icon, label, onClick }: { active: boolean; icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button className={`nav-button ${active ? "active" : ""}`} onClick={onClick}>
      {icon}
      <span>{label}</span>
    </button>
  );
}

export function PanelTitle({ icon, label, title }: { icon: React.ReactNode; label: string; title: string }) {
  return (
    <div className="section-title">
      <div>
        <span>{label}</span>
        <h2>{title}</h2>
      </div>
      {icon}
    </div>
  );
}

export function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="metric-card">
      <div className="metric-icon">{icon}</div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
