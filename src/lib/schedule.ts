import { isArchiveClosed, todayKey } from "./date";
import type { CustomEvent, FriendRating } from "../types";

export function isDailyTemplate(event: CustomEvent) {
  return Boolean(event.isTemplate || (event.repeatDaily && !event.templateId));
}

export function isDailyInstance(event: CustomEvent) {
  return Boolean(event.templateId);
}

export function isRecurringEvent(event: CustomEvent) {
  return event.repeatDaily || isDailyInstance(event);
}

export function canEditEvent(event: CustomEvent, activeDate: string) {
  return !isDailyTemplate(event) && !isArchiveClosed(activeDate) && event.date === activeDate;
}

export function scheduleDates(events: CustomEvent[], ratings: FriendRating[]) {
  const dates = new Set<string>([todayKey()]);
  events.forEach((event) => {
    if (isDailyTemplate(event)) return;
    dates.add(event.date);
    event.completedDates.forEach((date) => dates.add(date));
  });
  ratings.forEach((rating) => dates.add(rating.date));
  return Array.from(dates).sort((a, b) => b.localeCompare(a));
}

export function eventsForDate(events: CustomEvent[], date: string) {
  return events.filter((event) => {
    if (isDailyTemplate(event)) return false;
    if (event.date === date) return true;
    return event.completedDates.includes(date);
  });
}
