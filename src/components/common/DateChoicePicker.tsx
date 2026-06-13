import { ChoicePicker } from "./ChoicePicker";

function uniqueSortedDates(dates: string[]) {
  return Array.from(new Set(dates.filter(Boolean))).sort((a, b) => b.localeCompare(a));
}

export function DateChoicePicker({
  dates,
  onChange,
  value
}: {
  dates: string[];
  label?: string;
  onChange: (date: string) => void;
  value: string;
}) {
  const choices = uniqueSortedDates([value, ...dates]);
  return <ChoicePicker className="date-choice" options={choices.map((date) => ({ label: date, value: date }))} value={value} onChange={onChange} />;
}
