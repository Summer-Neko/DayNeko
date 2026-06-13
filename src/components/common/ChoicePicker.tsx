import React from "react";
import { createPortal } from "react-dom";
import { ChevronDown } from "lucide-react";

export type ChoiceOption<T extends string | number = string> = {
  label: string;
  value: T;
};

function useFloatingRect(open: boolean, ref: React.RefObject<HTMLElement | null>) {
  const [rect, setRect] = React.useState<DOMRect | null>(null);
  React.useLayoutEffect(() => {
    if (!open) return;
    const update = () => setRect(ref.current?.getBoundingClientRect() ?? null);
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open, ref]);
  return rect;
}

export function ChoicePicker<T extends string | number>({
  className = "",
  onChange,
  options,
  value
}: {
  className?: string;
  onChange: (value: T) => void;
  options: Array<ChoiceOption<T>>;
  value: T;
}) {
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const menuRef = React.useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = React.useState(false);
  const rect = useFloatingRect(open, rootRef);
  const current = options.find((option) => option.value === value) ?? options[0];
  const currentIndex = Math.max(0, options.findIndex((option) => option.value === value));
  const menuHeight = Math.min(230, Math.max(44, options.length * 42 + 12));
  const spaceBelow = rect ? window.innerHeight - rect.bottom - 10 : 0;
  const openUp = rect ? spaceBelow < menuHeight && rect.top > menuHeight : false;

  React.useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  const move = (direction: -1 | 1) => {
    if (options.length === 0) return;
    const nextIndex = Math.max(0, Math.min(options.length - 1, currentIndex + direction));
    onChange(options[nextIndex].value);
  };

  return (
    <div
      className={`choice-picker ${open ? "open" : ""} ${className}`}
      ref={rootRef}
      onWheel={(event) => {
        event.preventDefault();
        move(event.deltaY > 0 ? 1 : -1);
      }}
    >
      <button className="choice-trigger" type="button" onClick={() => setOpen((value) => !value)}>
        <strong>{current?.label ?? value}</strong>
        <ChevronDown size={16} />
      </button>
      {open && rect && createPortal(
        <div
          className="choice-menu"
          ref={menuRef}
          role="listbox"
          onPointerDown={(event) => event.stopPropagation()}
          style={{
            left: rect.left,
            top: openUp ? rect.top - menuHeight - 8 : rect.bottom + 8,
            width: Math.max(rect.width, 220),
            maxHeight: menuHeight
          }}
        >
          {options.map((option) => (
            <button
              className={option.value === value ? "active" : ""}
              key={String(option.value)}
              role="option"
              type="button"
              aria-selected={option.value === value}
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
            >
              {option.label}
            </button>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
}
