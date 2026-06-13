import React from "react";

export type AppNotificationKind = "info" | "success" | "warning" | "error" | "loading";

export type AppNotification = {
  id: string;
  title: string;
  message: string;
  kind: AppNotificationKind;
  exiting?: boolean;
};

export type NotifyOptions = {
  kind?: AppNotificationKind;
  title: string;
};

function inferKind(message: string): AppNotificationKind {
  if (/正在|中\.\.\.|同步 \d+ 条/.test(message)) return "loading";
  if (/失败|无法|离线|错误|异常/.test(message)) return "error";
  if (/请先|不能|没有可下载|保留|尚未|未登录/.test(message)) return "warning";
  if (/已|成功|正常|最新|发送|登录/.test(message)) return "success";
  return "info";
}

export function useAppNotifications() {
  const [items, setItems] = React.useState<AppNotification[]>([]);
  const timers = React.useRef(new Map<string, number>());
  const exitTimers = React.useRef(new Map<string, number>());

  const remove = React.useCallback((id: string) => {
    const timer = timers.current.get(id);
    if (timer) window.clearTimeout(timer);
    timers.current.delete(id);

    const exitTimer = exitTimers.current.get(id);
    if (exitTimer) window.clearTimeout(exitTimer);
    exitTimers.current.delete(id);

    setItems((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const dismiss = React.useCallback((id: string) => {
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, exiting: true } : item)));

    if (exitTimers.current.has(id)) return;
    const exitTimer = window.setTimeout(() => remove(id), 220);
    exitTimers.current.set(id, exitTimer);
  }, [remove]);

  const notify = React.useCallback((message: string, options: NotifyOptions) => {
    const text = message.trim();
    if (!text) return;

    const id = `${Date.now()}:${Math.random().toString(36).slice(2)}`;
    const kind = options.kind ?? inferKind(text);
    setItems((prev) => [{ id, title: options.title, message: text, kind }, ...prev].slice(0, 5));

    const timeout = kind === "loading" ? 1000 : 2000;
    const timer = window.setTimeout(() => dismiss(id), timeout);
    timers.current.set(id, timer);
  }, [dismiss]);

  React.useEffect(() => {
    return () => {
      timers.current.forEach((timer) => window.clearTimeout(timer));
      exitTimers.current.forEach((timer) => window.clearTimeout(timer));
      timers.current.clear();
      exitTimers.current.clear();
    };
  }, []);

  return { dismiss, items, notify };
}

export function useNotifiedStatus(initialValue: string, title: string, notify: (message: string, options: NotifyOptions) => void) {
  const [value, setValue] = React.useState(initialValue);

  const setNotifiedValue = React.useCallback<React.Dispatch<React.SetStateAction<string>>>((nextValue) => {
    setValue((prev) => {
      const resolved = typeof nextValue === "function" ? nextValue(prev) : nextValue;
      if (resolved !== prev) notify(resolved, { title });
      return resolved;
    });
  }, [notify, title]);

  return [value, setNotifiedValue] as const;
}
