export const nowIso = () => new Date().toISOString();
export const uid = () => crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
export const todayKey = () => new Date().toISOString().slice(0, 10);
export const dateKeyInBeijing = (date: Date) =>
  new Date(date.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);

export const scheduleDateKey = () => {
  const beijing = new Date(Date.now() + 8 * 60 * 60 * 1000);
  if (beijing.getUTCHours() < 2) beijing.setUTCDate(beijing.getUTCDate() - 1);
  return beijing.toISOString().slice(0, 10);
};

export const monthKey = (date = scheduleDateKey()) => date.slice(0, 7);

export function shiftMonth(month: string, offset: number) {
  const [yearText, monthText] = month.split("-");
  const year = Number(yearText);
  const monthIndex = Number(monthText) - 1;
  if (!Number.isFinite(year) || !Number.isFinite(monthIndex)) return monthKey();
  const date = new Date(Date.UTC(year, monthIndex + offset, 1));
  return date.toISOString().slice(0, 7);
}

export function monthLabel(month: string) {
  const [yearText, monthText] = month.split("-");
  const year = Number(yearText);
  const monthIndex = Number(monthText) - 1;
  if (!Number.isFinite(year) || !Number.isFinite(monthIndex)) return month;
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long" }).format(new Date(Date.UTC(year, monthIndex, 1)));
}

export const yesterdayKey = () => {
  const date = new Date(`${scheduleDateKey()}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
};

export const minutesBetween = (start: string, end?: string) => {
  const finish = end ? new Date(end).getTime() : Date.now();
  return Math.max(1, Math.round((finish - new Date(start).getTime()) / 60000));
};

export const fmtTime = (value: string) =>
  new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));

export function canRateYesterday() {
  const hour = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Shanghai",
      hour: "2-digit",
      hour12: false
    }).format(new Date())
  );
  return hour >= 2;
}

export function isArchiveClosed(date: string) {
  return date < scheduleDateKey();
}

export function dateInLast7Days(date: string) {
  const at = new Date(`${date}T00:00:00`).getTime();
  return at >= Date.now() - 7 * 86400000;
}
