import { rankScore } from "./config";
import { dateInLast7Days } from "./date";
import type { AppState, LeaderboardEntry, LeaderboardScope, Rank } from "../types";

function scoreToRank(score: number): Rank {
  if (score >= 94) return "SSS";
  if (score >= 84) return "S";
  if (score >= 72) return "A";
  if (score >= 58) return "B";
  return "C";
}

export function buildLeaderboard(state: AppState, scope: LeaderboardScope): LeaderboardEntry[] {
  const ownRatings = state.friendRatings.filter((rating) =>
    rating.targetUserId === state.user.id && (scope === "all" || dateInLast7Days(rating.date))
  );
  const score = ownRatings.reduce((sum, rating) => sum + rankScore[rating.rank], 0);
  const completed = state.events.reduce((sum, event) => sum + event.completedDates.length, 0);
  const own: LeaderboardEntry = {
    userId: state.user.id,
    name: state.user.name,
    handle: state.user.handle,
    score,
    rank: scoreToRank(ownRatings.length ? score / ownRatings.length : 45),
    completed,
    ratedDays: ownRatings.length
  };
  // const mock: LeaderboardEntry[] = [
  //   { userId: "mira", name: "Mira", handle: "@mira", score: scope === "7d" ? 548 : 1920, rank: "S", completed: 19, ratedDays: 22 },
  //   { userId: "aki", name: "Aki", handle: "@aki", score: scope === "7d" ? 392 : 1764, rank: "A", completed: 14, ratedDays: 21 },
  //   { userId: "nora", name: "Nora", handle: "@nora", score: scope === "7d" ? 674 : 2048, rank: "SSS", completed: 22, ratedDays: 24 }
  // ];
  // return [own, ...mock].sort((a, b) => b.score - a.score);
   return [own].sort((a, b) => b.score - a.score);
}
