import type { CustomEvent, EvidenceImage } from "../types";

export type DatedEvidenceEntry = {
  image: EvidenceImage;
  index: number;
};

export function evidenceBelongsToDate(event: CustomEvent, image: EvidenceImage, date: string) {
  return (image.date ?? event.date) === date;
}

export function evidenceEntriesForDate(event: CustomEvent, date: string): DatedEvidenceEntry[] {
  return event.evidence
    .map((image, index) => ({ image, index }))
    .filter(({ image }) => evidenceBelongsToDate(event, image, date));
}
