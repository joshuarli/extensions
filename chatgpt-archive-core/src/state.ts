import { Schema } from "effect";
import type { ArchiveState } from "./types.ts";

export const ARCHIVE_STATE_FORMAT = "chatgpt-archive-state";
export const ARCHIVE_STATE_VERSION = 1;

const ScanCheckpointSchema = Schema.Struct({
  complete: Schema.Boolean,
  scanned: Schema.Number,
});

const ArchiveStateSchema = Schema.Struct({
  format: Schema.Literal(ARCHIVE_STATE_FORMAT),
  version: Schema.Literal(ARCHIVE_STATE_VERSION),
  accountId: Schema.String,
  scopes: Schema.Struct({
    active: ScanCheckpointSchema,
    archived: ScanCheckpointSchema,
  }),
});

export function emptyArchiveState(accountId: string): ArchiveState {
  return {
    format: ARCHIVE_STATE_FORMAT,
    version: ARCHIVE_STATE_VERSION,
    accountId,
    scopes: {
      active: { complete: false, scanned: 0 },
      archived: { complete: false, scanned: 0 },
    },
  };
}

export function encodeArchiveState(state: ArchiveState): string {
  return JSON.stringify(state, null, 2) + "\n";
}

export function decodeArchiveState(text: string): ArchiveState | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  try {
    const state = Schema.decodeUnknownSync(ArchiveStateSchema)(value);
    for (const scope of [state.scopes.active, state.scopes.archived]) {
      if (!Number.isFinite(scope.scanned) || scope.scanned < 0) return null;
    }
    return state;
  } catch {
    return null;
  }
}
