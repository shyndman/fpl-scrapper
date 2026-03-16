/**
 * Minimal shared contracts for persisted auth state and API discovery output.
 * Keep this file limited to shapes that genuinely cross module boundaries.
 */
export interface SessionCookies {
  [cookieName: string]: string;
}

/** JSON shape written to disk for cached FPL auth sessions. */
export interface PersistedSession {
  cookies: SessionCookies;
  expires_at: string;
}

export interface DiscoveryDictEntry {
  type: "dict";
  keys: string[];
}

export interface DiscoveryListEntry {
  type: "list";
  length: number;
  sample_keys: string[];
}

export interface DiscoveryErrorEntry {
  error: string;
}

export type DiscoveryEntry =
  | DiscoveryDictEntry
  | DiscoveryListEntry
  | DiscoveryErrorEntry;

/** Map of probed endpoint names to their summarized discovery result. */
export interface DiscoveryResult {
  [endpointName: string]: DiscoveryEntry;
}
