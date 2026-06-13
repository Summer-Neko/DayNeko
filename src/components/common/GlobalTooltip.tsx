import React from "react";
import { createPortal } from "react-dom";

type TooltipState = {
  text: string;
  x: number;
  y: number;
};

function tooltipTextFor(target: EventTarget | null) {
  if (!(target instanceof Element)) return null;
  const element = target.closest<HTMLElement>("[data-tooltip], [title]");
  if (!element) return null;
  const title = element.getAttribute("title");
  if (title) {
    element.dataset.tooltip = title;
    element.dataset.nativeTitle = title;
    element.removeAttribute("title");
  }
  const text = element.dataset.tooltip?.trim();
  return text ? { element, text } : null;
}

export function GlobalTooltip() {
  const [tooltip, setTooltip] = React.useState<TooltipState | null>(null);
  const activeElement = React.useRef<HTMLElement | null>(null);

  React.useEffect(() => {
    const move = (event: PointerEvent) => {
      const next = tooltipTextFor(event.target);
      if (!next) {
        activeElement.current = null;
        setTooltip(null);
        return;
      }
      activeElement.current = next.element;
      setTooltip({ text: next.text, x: event.clientX, y: event.clientY });
    };
    const leave = (event: PointerEvent) => {
      if (activeElement.current && event.target instanceof Node && activeElement.current.contains(event.target)) {
        activeElement.current = null;
        setTooltip(null);
      }
    };
    document.addEventListener("pointermove", move, true);
    document.addEventListener("pointerleave", leave, true);
    document.addEventListener("pointerdown", leave, true);
    return () => {
      document.removeEventListener("pointermove", move, true);
      document.removeEventListener("pointerleave", leave, true);
      document.removeEventListener("pointerdown", leave, true);
    };
  }, []);

  if (!tooltip) return null;

  const left = Math.min(window.innerWidth - 18, tooltip.x + 14);
  const top = Math.min(window.innerHeight - 18, tooltip.y + 16);

  return createPortal(
    <div className="global-tooltip" style={{ left, top }}>
      {tooltip.text}
    </div>,
    document.body
  );
}
