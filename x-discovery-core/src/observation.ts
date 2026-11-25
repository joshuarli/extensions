import { randomUUID } from "node:crypto";
import { Schema } from "effect";

export const FeedSchema = Schema.Literals(["home-for-you", "home-following", "profile", "following", "followers"]);
export type Feed = Schema.Schema.Type<typeof FeedSchema>;

export interface ObservationRun {
  runId: string;
  accountId: string;
  feed: Feed;
  startedAt: string;
  endedAt: string | null;
  stopReason: string | null;
  budgetPages: number;
}

export interface FeedObservation {
  runId: string;
  entryId: string;
  position: number;
  tweetId: string | null;
  authorId: string | null;
  authorHandle: string | null;
  relationship: string;
  observedAt: string;
}

export function newRun(accountId: string, feed: Feed, budgetPages: number, at: string = new Date().toISOString()): ObservationRun {
  if (!/^\d+$/u.test(accountId)) throw new Error("Invalid X account id.");
  if (!Number.isInteger(budgetPages) || budgetPages < 1) throw new Error("A run needs a positive page budget.");
  return {
    runId: randomUUID(),
    accountId,
    feed,
    startedAt: at,
    endedAt: null,
    stopReason: null,
    budgetPages,
  };
}
