/**
 * Stable row-model layer for FPL payloads.
 * Each class normalizes raw API payloads into schema-aligned properties and an
 * explicit database tuple whose ordering matches the current SQLite tables.
 */

type RawRecord = Record<string, unknown>;
type DbValue = string | number | null;

function hasValue(record: RawRecord, key: string): boolean {
  return (
    Object.prototype.hasOwnProperty.call(record, key) &&
    record[key] !== undefined
  );
}

function getOrDefault(
  record: RawRecord,
  key: string,
  fallback: unknown,
): unknown {
  return hasValue(record, key) ? record[key] : fallback;
}

function pythonString(value: unknown): string {
  return value === null ? "None" : String(value);
}

function pythonTruthy(value: unknown): boolean {
  if (value === null || value === undefined) {
    return false;
  }

  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    return value !== 0 && !Number.isNaN(value);
  }

  if (typeof value === "bigint") {
    return value !== 0n;
  }

  if (typeof value === "string") {
    return value.length > 0;
  }

  if (Array.isArray(value)) {
    return value.length > 0;
  }

  if (value instanceof Map || value instanceof Set) {
    return value.size > 0;
  }

  if (value instanceof Date) {
    return true;
  }

  if (typeof value === "object") {
    return Object.keys(value as Record<string, unknown>).length > 0;
  }

  return Boolean(value);
}

function roundToTwo(value: number): number {
  return Number(value.toFixed(2));
}

function jsonBlob(value: unknown): string | null {
  return pythonTruthy(value) ? JSON.stringify(value) : null;
}

function requiredInt(value: unknown, fieldName: string): number {
  const parsed = _int(value);
  if (parsed === null) {
    throw new TypeError(`Expected integer for ${fieldName}`);
  }
  return parsed;
}

function requiredString(value: unknown, fieldName: string): string {
  if (value === null || value === undefined) {
    throw new TypeError(`Expected value for ${fieldName}`);
  }
  return pythonString(value);
}

function optionalString(value: unknown, fallback = ""): string {
  return pythonString(value === undefined ? fallback : value);
}

/** Trim string-ish values and collapse blanks to null. */
export function _str(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  const normalized = pythonString(value).trim();
  return normalized.length > 0 ? normalized : null;
}

/** Parse Python-style integers without accepting float or exponent strings. */
export function _int(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "boolean") {
    return value ? 1 : 0;
  }

  if (typeof value === "number") {
    return Number.isInteger(value) ? value : null;
  }

  if (typeof value === "bigint") {
    const asNumber = Number(value);
    return Number.isSafeInteger(asNumber) ? asNumber : null;
  }

  const normalized = pythonString(value).trim();
  if (!/^[+-]?\d+$/u.test(normalized)) {
    return null;
  }

  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

/** Preserve FPL numeric-string fields as trimmed strings instead of coercing them. */
export function _float_str(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  const normalized = pythonString(value).trim();
  return normalized.length > 0 ? normalized : null;
}

/** Parse float-like values and return null when the payload is blank or invalid. */
export function _float(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  const normalized = pythonString(value).trim();
  if (normalized.length === 0) {
    return null;
  }

  const parsed = Number(normalized);
  return Number.isNaN(parsed) ? null : parsed;
}

/** Mirror the Python model layer's bool-to-int conversion for persisted rows. */
export function _bool_int(value: unknown): 0 | 1 {
  return pythonTruthy(value) ? 1 : 0;
}

/** Round actual-minus-expected performance to two decimals, or null when unavailable. */
export function _xp(actual: unknown, expected: number | null): number | null {
  if (expected === null) {
    return null;
  }

  const actualValue = _int(actual);
  if (actualValue === null) {
    return null;
  }

  return roundToTwo(actualValue - expected);
}

/** Use UTC ISO timestamps for scrape provenance, aligned with the Python model layer. */
export function _now(): string {
  return new Date().toISOString().replace("Z", "+00:00");
}

/** Stable team row consumed by bootstrap transforms and DB upserts. */
export class Team {
  constructor(
    public readonly fpl_id: number,
    public readonly name: string,
    public readonly short_name: string,
    public readonly code: number | null,
    public readonly strength: number | null,
    public readonly strength_overall_home: number | null,
    public readonly strength_overall_away: number | null,
    public readonly strength_attack_home: number | null,
    public readonly strength_attack_away: number | null,
    public readonly strength_defence_home: number | null,
    public readonly strength_defence_away: number | null,
    public readonly pulse_id: number | null,
    public readonly scraped_at: string = _now(),
  ) {}

  static fromDict(d: RawRecord): Team {
    return new Team(
      requiredInt(d.id, "Team.id"),
      requiredString(d.name, "Team.name"),
      requiredString(d.short_name, "Team.short_name"),
      _int(d.code),
      _int(d.strength),
      _int(d.strength_overall_home),
      _int(d.strength_overall_away),
      _int(d.strength_attack_home),
      _int(d.strength_attack_away),
      _int(d.strength_defence_home),
      _int(d.strength_defence_away),
      _int(d.pulse_id),
    );
  }

  toDbTuple(): DbValue[] {
    return [
      this.fpl_id,
      this.name,
      this.short_name,
      this.code,
      this.strength,
      this.strength_overall_home,
      this.strength_overall_away,
      this.strength_attack_home,
      this.strength_attack_away,
      this.strength_defence_home,
      this.strength_defence_away,
      this.pulse_id,
      this.scraped_at,
    ];
  }
}

/** Stable gameweek row including serialized chip-play payloads for later DB writes. */
export class Gameweek {
  constructor(
    public readonly fpl_id: number,
    public readonly name: string,
    public readonly deadline_time: string,
    public readonly average_entry_score: number | null,
    public readonly highest_score: number | null,
    public readonly highest_scoring_entry: number | null,
    public readonly is_current: number,
    public readonly is_next: number,
    public readonly is_finished: number,
    public readonly chip_plays: string | null,
    public readonly most_selected: number | null,
    public readonly most_transferred_in: number | null,
    public readonly most_captained: number | null,
    public readonly most_vice_captained: number | null,
    public readonly transfers_made: number | null,
    public readonly scraped_at: string = _now(),
  ) {}

  static fromDict(d: RawRecord): Gameweek {
    return new Gameweek(
      requiredInt(d.id, "Gameweek.id"),
      requiredString(d.name, "Gameweek.name"),
      optionalString(getOrDefault(d, "deadline_time", "")),
      _int(d.average_entry_score),
      _int(d.highest_score),
      _int(d.highest_scoring_entry),
      _bool_int(d.is_current),
      _bool_int(d.is_next),
      _bool_int(d.finished),
      jsonBlob(d.chip_plays),
      _int(d.most_selected),
      _int(d.most_transferred_in),
      _int(d.most_captained),
      _int(d.most_vice_captained),
      _int(d.transfers_made),
    );
  }

  toDbTuple(): DbValue[] {
    return [
      this.fpl_id,
      this.name,
      this.deadline_time,
      this.average_entry_score,
      this.highest_score,
      this.highest_scoring_entry,
      this.is_current,
      this.is_next,
      this.is_finished,
      this.chip_plays,
      this.most_selected,
      this.most_transferred_in,
      this.most_captained,
      this.most_vice_captained,
      this.transfers_made,
      this.scraped_at,
    ];
  }
}

/** Stable player row with explicit expected-performance fields used by later ports. */
export class Player {
  constructor(
    public readonly fpl_id: number,
    public readonly first_name: string,
    public readonly second_name: string,
    public readonly web_name: string,
    public readonly team_fpl_id: number,
    public readonly element_type: number,
    public readonly status: string | null,
    public readonly code: number | null,
    public readonly now_cost: number | null,
    public readonly cost_change_start: number | null,
    public readonly cost_change_event: number | null,
    public readonly chance_of_playing_this_round: number | null,
    public readonly chance_of_playing_next_round: number | null,
    public readonly total_points: number,
    public readonly event_points: number,
    public readonly points_per_game: string | null,
    public readonly form: string | null,
    public readonly selected_by_percent: string | null,
    public readonly transfers_in: number,
    public readonly transfers_out: number,
    public readonly transfers_in_event: number,
    public readonly transfers_out_event: number,
    public readonly minutes: number,
    public readonly goals_scored: number,
    public readonly assists: number,
    public readonly clean_sheets: number,
    public readonly goals_conceded: number,
    public readonly own_goals: number,
    public readonly penalties_saved: number,
    public readonly penalties_missed: number,
    public readonly yellow_cards: number,
    public readonly red_cards: number,
    public readonly saves: number,
    public readonly bonus: number,
    public readonly bps: number,
    public readonly influence: string | null,
    public readonly creativity: string | null,
    public readonly threat: string | null,
    public readonly ict_index: string | null,
    public readonly starts: number,
    public readonly expected_goals: number | null,
    public readonly expected_assists: number | null,
    public readonly expected_goal_involvements: number | null,
    public readonly expected_goals_conceded: string | null,
    public readonly xgp: number | null,
    public readonly xap: number | null,
    public readonly xgip: number | null,
    public readonly tackles: number,
    public readonly clearances_blocks_interceptions: number,
    public readonly recoveries: number,
    public readonly defensive_contribution: number,
    public readonly defensive_contribution_per_90: number | null,
    public readonly news: string | null,
    public readonly news_added: string | null,
    public readonly squad_number: number | null,
    public readonly photo: string | null,
    public readonly scraped_at: string = _now(),
  ) {}

  static fromDict(d: RawRecord): Player {
    const xgp = _xp(
      requiredInt(getOrDefault(d, "goals_scored", 0), "Player.goals_scored"),
      _float(d.expected_goals),
    );
    const xap = _xp(
      requiredInt(getOrDefault(d, "assists", 0), "Player.assists"),
      _float(d.expected_assists),
    );
    const xgip = xgp !== null && xap !== null ? roundToTwo(xgp + xap) : null;

    return new Player(
      requiredInt(d.id, "Player.id"),
      optionalString(getOrDefault(d, "first_name", "")),
      optionalString(getOrDefault(d, "second_name", "")),
      optionalString(getOrDefault(d, "web_name", "")),
      requiredInt(d.team, "Player.team"),
      requiredInt(d.element_type, "Player.element_type"),
      _str(d.status),
      _int(d.code),
      _int(d.now_cost),
      _int(d.cost_change_start),
      _int(d.cost_change_event),
      _int(d.chance_of_playing_this_round),
      _int(d.chance_of_playing_next_round),
      requiredInt(getOrDefault(d, "total_points", 0), "Player.total_points"),
      requiredInt(getOrDefault(d, "event_points", 0), "Player.event_points"),
      _float_str(d.points_per_game),
      _float_str(d.form),
      _float_str(d.selected_by_percent),
      requiredInt(getOrDefault(d, "transfers_in", 0), "Player.transfers_in"),
      requiredInt(getOrDefault(d, "transfers_out", 0), "Player.transfers_out"),
      requiredInt(
        getOrDefault(d, "transfers_in_event", 0),
        "Player.transfers_in_event",
      ),
      requiredInt(
        getOrDefault(d, "transfers_out_event", 0),
        "Player.transfers_out_event",
      ),
      requiredInt(getOrDefault(d, "minutes", 0), "Player.minutes"),
      requiredInt(getOrDefault(d, "goals_scored", 0), "Player.goals_scored"),
      requiredInt(getOrDefault(d, "assists", 0), "Player.assists"),
      requiredInt(getOrDefault(d, "clean_sheets", 0), "Player.clean_sheets"),
      requiredInt(
        getOrDefault(d, "goals_conceded", 0),
        "Player.goals_conceded",
      ),
      requiredInt(getOrDefault(d, "own_goals", 0), "Player.own_goals"),
      requiredInt(
        getOrDefault(d, "penalties_saved", 0),
        "Player.penalties_saved",
      ),
      requiredInt(
        getOrDefault(d, "penalties_missed", 0),
        "Player.penalties_missed",
      ),
      requiredInt(getOrDefault(d, "yellow_cards", 0), "Player.yellow_cards"),
      requiredInt(getOrDefault(d, "red_cards", 0), "Player.red_cards"),
      requiredInt(getOrDefault(d, "saves", 0), "Player.saves"),
      requiredInt(getOrDefault(d, "bonus", 0), "Player.bonus"),
      requiredInt(getOrDefault(d, "bps", 0), "Player.bps"),
      _float_str(d.influence),
      _float_str(d.creativity),
      _float_str(d.threat),
      _float_str(d.ict_index),
      requiredInt(getOrDefault(d, "starts", 0), "Player.starts"),
      _float(d.expected_goals),
      _float(d.expected_assists),
      _float(d.expected_goal_involvements),
      _float_str(d.expected_goals_conceded),
      xgp,
      xap,
      xgip,
      requiredInt(getOrDefault(d, "tackles", 0), "Player.tackles"),
      requiredInt(
        getOrDefault(d, "clearances_blocks_interceptions", 0),
        "Player.clearances_blocks_interceptions",
      ),
      requiredInt(getOrDefault(d, "recoveries", 0), "Player.recoveries"),
      requiredInt(
        getOrDefault(d, "defensive_contribution", 0),
        "Player.defensive_contribution",
      ),
      _float(d.defensive_contribution_per_90),
      _str(d.news),
      _str(d.news_added),
      _int(d.squad_number),
      _str(d.photo),
    );
  }

  toDbTuple(): DbValue[] {
    return [
      this.fpl_id,
      this.first_name,
      this.second_name,
      this.web_name,
      this.team_fpl_id,
      this.element_type,
      this.status,
      this.code,
      this.now_cost,
      this.cost_change_start,
      this.cost_change_event,
      this.chance_of_playing_this_round,
      this.chance_of_playing_next_round,
      this.total_points,
      this.event_points,
      this.points_per_game,
      this.form,
      this.selected_by_percent,
      this.transfers_in,
      this.transfers_out,
      this.transfers_in_event,
      this.transfers_out_event,
      this.minutes,
      this.goals_scored,
      this.assists,
      this.clean_sheets,
      this.goals_conceded,
      this.own_goals,
      this.penalties_saved,
      this.penalties_missed,
      this.yellow_cards,
      this.red_cards,
      this.saves,
      this.bonus,
      this.bps,
      this.influence,
      this.creativity,
      this.threat,
      this.ict_index,
      this.starts,
      this.expected_goals,
      this.expected_assists,
      this.expected_goal_involvements,
      this.expected_goals_conceded,
      this.xgp,
      this.xap,
      this.xgip,
      this.tackles,
      this.clearances_blocks_interceptions,
      this.recoveries,
      this.defensive_contribution,
      this.defensive_contribution_per_90,
      this.news,
      this.news_added,
      this.squad_number,
      this.photo,
      this.scraped_at,
    ];
  }
}

/** Stable per-gameweek history row with computed expectation deltas. */
export class PlayerHistory {
  constructor(
    public readonly player_fpl_id: number,
    public readonly gameweek_fpl_id: number,
    public readonly opponent_team: number | null,
    public readonly was_home: number,
    public readonly kickoff_time: string | null,
    public readonly total_points: number,
    public readonly minutes: number,
    public readonly goals_scored: number,
    public readonly assists: number,
    public readonly clean_sheets: number,
    public readonly goals_conceded: number,
    public readonly own_goals: number,
    public readonly penalties_saved: number,
    public readonly penalties_missed: number,
    public readonly yellow_cards: number,
    public readonly red_cards: number,
    public readonly saves: number,
    public readonly bonus: number,
    public readonly bps: number,
    public readonly influence: string | null,
    public readonly creativity: string | null,
    public readonly threat: string | null,
    public readonly ict_index: string | null,
    public readonly starts: number,
    public readonly expected_goals: number | null,
    public readonly expected_assists: number | null,
    public readonly expected_goal_involvements: number | null,
    public readonly expected_goals_conceded: string | null,
    public readonly xgp: number | null,
    public readonly xap: number | null,
    public readonly xgip: number | null,
    public readonly tackles: number,
    public readonly clearances_blocks_interceptions: number,
    public readonly recoveries: number,
    public readonly defensive_contribution: number,
    public readonly value: number | null,
    public readonly transfers_balance: number | null,
    public readonly selected: number | null,
    public readonly transfers_in: number,
    public readonly transfers_out: number,
    public readonly round: number | null,
    public readonly scraped_at: string = _now(),
  ) {}

  static fromDict(player_fpl_id: number, d: RawRecord): PlayerHistory {
    const xgp = _xp(
      requiredInt(
        getOrDefault(d, "goals_scored", 0),
        "PlayerHistory.goals_scored",
      ),
      _float(d.expected_goals),
    );
    const xap = _xp(
      requiredInt(getOrDefault(d, "assists", 0), "PlayerHistory.assists"),
      _float(d.expected_assists),
    );
    const xgip = xgp !== null && xap !== null ? roundToTwo(xgp + xap) : null;

    return new PlayerHistory(
      player_fpl_id,
      requiredInt(d.round, "PlayerHistory.round"),
      _int(d.opponent_team),
      _bool_int(d.was_home),
      _str(d.kickoff_time),
      requiredInt(
        getOrDefault(d, "total_points", 0),
        "PlayerHistory.total_points",
      ),
      requiredInt(getOrDefault(d, "minutes", 0), "PlayerHistory.minutes"),
      requiredInt(
        getOrDefault(d, "goals_scored", 0),
        "PlayerHistory.goals_scored",
      ),
      requiredInt(getOrDefault(d, "assists", 0), "PlayerHistory.assists"),
      requiredInt(
        getOrDefault(d, "clean_sheets", 0),
        "PlayerHistory.clean_sheets",
      ),
      requiredInt(
        getOrDefault(d, "goals_conceded", 0),
        "PlayerHistory.goals_conceded",
      ),
      requiredInt(getOrDefault(d, "own_goals", 0), "PlayerHistory.own_goals"),
      requiredInt(
        getOrDefault(d, "penalties_saved", 0),
        "PlayerHistory.penalties_saved",
      ),
      requiredInt(
        getOrDefault(d, "penalties_missed", 0),
        "PlayerHistory.penalties_missed",
      ),
      requiredInt(
        getOrDefault(d, "yellow_cards", 0),
        "PlayerHistory.yellow_cards",
      ),
      requiredInt(getOrDefault(d, "red_cards", 0), "PlayerHistory.red_cards"),
      requiredInt(getOrDefault(d, "saves", 0), "PlayerHistory.saves"),
      requiredInt(getOrDefault(d, "bonus", 0), "PlayerHistory.bonus"),
      requiredInt(getOrDefault(d, "bps", 0), "PlayerHistory.bps"),
      _float_str(d.influence),
      _float_str(d.creativity),
      _float_str(d.threat),
      _float_str(d.ict_index),
      requiredInt(getOrDefault(d, "starts", 0), "PlayerHistory.starts"),
      _float(d.expected_goals),
      _float(d.expected_assists),
      _float(d.expected_goal_involvements),
      _float_str(d.expected_goals_conceded),
      xgp,
      xap,
      xgip,
      requiredInt(getOrDefault(d, "tackles", 0), "PlayerHistory.tackles"),
      requiredInt(
        getOrDefault(d, "clearances_blocks_interceptions", 0),
        "PlayerHistory.clearances_blocks_interceptions",
      ),
      requiredInt(getOrDefault(d, "recoveries", 0), "PlayerHistory.recoveries"),
      requiredInt(
        getOrDefault(d, "defensive_contribution", 0),
        "PlayerHistory.defensive_contribution",
      ),
      _int(d.value),
      _int(d.transfers_balance),
      _int(d.selected),
      requiredInt(
        getOrDefault(d, "transfers_in", 0),
        "PlayerHistory.transfers_in",
      ),
      requiredInt(
        getOrDefault(d, "transfers_out", 0),
        "PlayerHistory.transfers_out",
      ),
      _int(d.round),
    );
  }

  toDbTuple(): DbValue[] {
    return [
      this.player_fpl_id,
      this.gameweek_fpl_id,
      this.opponent_team,
      this.was_home,
      this.kickoff_time,
      this.total_points,
      this.minutes,
      this.goals_scored,
      this.assists,
      this.clean_sheets,
      this.goals_conceded,
      this.own_goals,
      this.penalties_saved,
      this.penalties_missed,
      this.yellow_cards,
      this.red_cards,
      this.saves,
      this.bonus,
      this.bps,
      this.influence,
      this.creativity,
      this.threat,
      this.ict_index,
      this.starts,
      this.expected_goals,
      this.expected_assists,
      this.expected_goal_involvements,
      this.expected_goals_conceded,
      this.xgp,
      this.xap,
      this.xgip,
      this.tackles,
      this.clearances_blocks_interceptions,
      this.recoveries,
      this.defensive_contribution,
      this.value,
      this.transfers_balance,
      this.selected,
      this.transfers_in,
      this.transfers_out,
      this.round,
      this.scraped_at,
    ];
  }
}

/** Stable prior-season summary row with numeric-string preservation where required. */
export class PlayerHistoryPast {
  constructor(
    public readonly player_fpl_id: number,
    public readonly season_name: string,
    public readonly element_code: number | null,
    public readonly start_cost: number | null,
    public readonly end_cost: number | null,
    public readonly total_points: number,
    public readonly minutes: number,
    public readonly goals_scored: number,
    public readonly assists: number,
    public readonly clean_sheets: number,
    public readonly goals_conceded: number,
    public readonly own_goals: number,
    public readonly penalties_saved: number,
    public readonly penalties_missed: number,
    public readonly yellow_cards: number,
    public readonly red_cards: number,
    public readonly saves: number,
    public readonly bonus: number,
    public readonly bps: number,
    public readonly influence: string | null,
    public readonly creativity: string | null,
    public readonly threat: string | null,
    public readonly ict_index: string | null,
    public readonly starts: number,
    public readonly expected_goals: number | null,
    public readonly expected_assists: number | null,
    public readonly expected_goal_involvements: number | null,
    public readonly expected_goals_conceded: string | null,
    public readonly tackles: number,
    public readonly clearances_blocks_interceptions: number,
    public readonly recoveries: number,
    public readonly defensive_contribution: number,
    public readonly scraped_at: string = _now(),
  ) {}

  static fromDict(player_fpl_id: number, d: RawRecord): PlayerHistoryPast {
    return new PlayerHistoryPast(
      player_fpl_id,
      optionalString(getOrDefault(d, "season_name", "")),
      _int(d.element_code),
      _int(d.start_cost),
      _int(d.end_cost),
      requiredInt(
        getOrDefault(d, "total_points", 0),
        "PlayerHistoryPast.total_points",
      ),
      requiredInt(getOrDefault(d, "minutes", 0), "PlayerHistoryPast.minutes"),
      requiredInt(
        getOrDefault(d, "goals_scored", 0),
        "PlayerHistoryPast.goals_scored",
      ),
      requiredInt(getOrDefault(d, "assists", 0), "PlayerHistoryPast.assists"),
      requiredInt(
        getOrDefault(d, "clean_sheets", 0),
        "PlayerHistoryPast.clean_sheets",
      ),
      requiredInt(
        getOrDefault(d, "goals_conceded", 0),
        "PlayerHistoryPast.goals_conceded",
      ),
      requiredInt(
        getOrDefault(d, "own_goals", 0),
        "PlayerHistoryPast.own_goals",
      ),
      requiredInt(
        getOrDefault(d, "penalties_saved", 0),
        "PlayerHistoryPast.penalties_saved",
      ),
      requiredInt(
        getOrDefault(d, "penalties_missed", 0),
        "PlayerHistoryPast.penalties_missed",
      ),
      requiredInt(
        getOrDefault(d, "yellow_cards", 0),
        "PlayerHistoryPast.yellow_cards",
      ),
      requiredInt(
        getOrDefault(d, "red_cards", 0),
        "PlayerHistoryPast.red_cards",
      ),
      requiredInt(getOrDefault(d, "saves", 0), "PlayerHistoryPast.saves"),
      requiredInt(getOrDefault(d, "bonus", 0), "PlayerHistoryPast.bonus"),
      requiredInt(getOrDefault(d, "bps", 0), "PlayerHistoryPast.bps"),
      _float_str(d.influence),
      _float_str(d.creativity),
      _float_str(d.threat),
      _float_str(d.ict_index),
      requiredInt(getOrDefault(d, "starts", 0), "PlayerHistoryPast.starts"),
      _float(d.expected_goals),
      _float(d.expected_assists),
      _float(d.expected_goal_involvements),
      _float_str(d.expected_goals_conceded),
      requiredInt(getOrDefault(d, "tackles", 0), "PlayerHistoryPast.tackles"),
      requiredInt(
        getOrDefault(d, "clearances_blocks_interceptions", 0),
        "PlayerHistoryPast.clearances_blocks_interceptions",
      ),
      requiredInt(
        getOrDefault(d, "recoveries", 0),
        "PlayerHistoryPast.recoveries",
      ),
      requiredInt(
        getOrDefault(d, "defensive_contribution", 0),
        "PlayerHistoryPast.defensive_contribution",
      ),
    );
  }

  toDbTuple(): DbValue[] {
    return [
      this.player_fpl_id,
      this.season_name,
      this.element_code,
      this.start_cost,
      this.end_cost,
      this.total_points,
      this.minutes,
      this.goals_scored,
      this.assists,
      this.clean_sheets,
      this.goals_conceded,
      this.own_goals,
      this.penalties_saved,
      this.penalties_missed,
      this.yellow_cards,
      this.red_cards,
      this.saves,
      this.bonus,
      this.bps,
      this.influence,
      this.creativity,
      this.threat,
      this.ict_index,
      this.starts,
      this.expected_goals,
      this.expected_assists,
      this.expected_goal_involvements,
      this.expected_goals_conceded,
      this.tackles,
      this.clearances_blocks_interceptions,
      this.recoveries,
      this.defensive_contribution,
      this.scraped_at,
    ];
  }
}

/** Stable fixture row with stats serialized exactly once for the DB layer. */
export class Fixture {
  constructor(
    public readonly fpl_id: number,
    public readonly gameweek_fpl_id: number | null,
    public readonly kickoff_time: string | null,
    public readonly team_h_fpl_id: number,
    public readonly team_a_fpl_id: number,
    public readonly team_h_score: number | null,
    public readonly team_a_score: number | null,
    public readonly finished: number,
    public readonly finished_provisional: number,
    public readonly started: number,
    public readonly minutes: number,
    public readonly team_h_difficulty: number | null,
    public readonly team_a_difficulty: number | null,
    public readonly code: number | null,
    public readonly pulse_id: number | null,
    public readonly stats: string | null,
    public readonly scraped_at: string = _now(),
  ) {}

  static fromDict(d: RawRecord): Fixture {
    return new Fixture(
      requiredInt(d.id, "Fixture.id"),
      _int(d.event),
      _str(d.kickoff_time),
      requiredInt(d.team_h, "Fixture.team_h"),
      requiredInt(d.team_a, "Fixture.team_a"),
      _int(d.team_h_score),
      _int(d.team_a_score),
      _bool_int(d.finished),
      _bool_int(d.finished_provisional),
      _bool_int(d.started),
      requiredInt(getOrDefault(d, "minutes", 0), "Fixture.minutes"),
      _int(d.team_h_difficulty),
      _int(d.team_a_difficulty),
      _int(d.code),
      _int(d.pulse_id),
      jsonBlob(d.stats),
    );
  }

  toDbTuple(): DbValue[] {
    return [
      this.fpl_id,
      this.gameweek_fpl_id,
      this.kickoff_time,
      this.team_h_fpl_id,
      this.team_a_fpl_id,
      this.team_h_score,
      this.team_a_score,
      this.finished,
      this.finished_provisional,
      this.started,
      this.minutes,
      this.team_h_difficulty,
      this.team_a_difficulty,
      this.code,
      this.pulse_id,
      this.stats,
      this.scraped_at,
    ];
  }
}

/** Stable live-stat row with nested explain payload serialized for persistence. */
export class LiveGameweekStats {
  constructor(
    public readonly player_fpl_id: number,
    public readonly gameweek_fpl_id: number,
    public readonly minutes: number,
    public readonly goals_scored: number,
    public readonly assists: number,
    public readonly clean_sheets: number,
    public readonly goals_conceded: number,
    public readonly own_goals: number,
    public readonly penalties_saved: number,
    public readonly penalties_missed: number,
    public readonly yellow_cards: number,
    public readonly red_cards: number,
    public readonly saves: number,
    public readonly bonus: number,
    public readonly bps: number,
    public readonly influence: string | null,
    public readonly creativity: string | null,
    public readonly threat: string | null,
    public readonly ict_index: string | null,
    public readonly starts: number,
    public readonly expected_goals: number | null,
    public readonly expected_assists: number | null,
    public readonly expected_goal_involvements: number | null,
    public readonly expected_goals_conceded: string | null,
    public readonly tackles: number,
    public readonly clearances_blocks_interceptions: number,
    public readonly recoveries: number,
    public readonly defensive_contribution: number,
    public readonly total_points: number,
    public readonly in_dreamteam: number,
    public readonly explain: string | null,
    public readonly scraped_at: string = _now(),
  ) {}

  static fromDict(
    player_fpl_id: number,
    gameweek_fpl_id: number,
    d: RawRecord,
  ): LiveGameweekStats {
    const stats = (d.stats ?? {}) as RawRecord;

    return new LiveGameweekStats(
      player_fpl_id,
      gameweek_fpl_id,
      requiredInt(
        getOrDefault(stats, "minutes", 0),
        "LiveGameweekStats.minutes",
      ),
      requiredInt(
        getOrDefault(stats, "goals_scored", 0),
        "LiveGameweekStats.goals_scored",
      ),
      requiredInt(
        getOrDefault(stats, "assists", 0),
        "LiveGameweekStats.assists",
      ),
      requiredInt(
        getOrDefault(stats, "clean_sheets", 0),
        "LiveGameweekStats.clean_sheets",
      ),
      requiredInt(
        getOrDefault(stats, "goals_conceded", 0),
        "LiveGameweekStats.goals_conceded",
      ),
      requiredInt(
        getOrDefault(stats, "own_goals", 0),
        "LiveGameweekStats.own_goals",
      ),
      requiredInt(
        getOrDefault(stats, "penalties_saved", 0),
        "LiveGameweekStats.penalties_saved",
      ),
      requiredInt(
        getOrDefault(stats, "penalties_missed", 0),
        "LiveGameweekStats.penalties_missed",
      ),
      requiredInt(
        getOrDefault(stats, "yellow_cards", 0),
        "LiveGameweekStats.yellow_cards",
      ),
      requiredInt(
        getOrDefault(stats, "red_cards", 0),
        "LiveGameweekStats.red_cards",
      ),
      requiredInt(getOrDefault(stats, "saves", 0), "LiveGameweekStats.saves"),
      requiredInt(getOrDefault(stats, "bonus", 0), "LiveGameweekStats.bonus"),
      requiredInt(getOrDefault(stats, "bps", 0), "LiveGameweekStats.bps"),
      _float_str(stats.influence),
      _float_str(stats.creativity),
      _float_str(stats.threat),
      _float_str(stats.ict_index),
      requiredInt(getOrDefault(stats, "starts", 0), "LiveGameweekStats.starts"),
      _float(stats.expected_goals),
      _float(stats.expected_assists),
      _float(stats.expected_goal_involvements),
      _float_str(stats.expected_goals_conceded),
      requiredInt(
        getOrDefault(stats, "tackles", 0),
        "LiveGameweekStats.tackles",
      ),
      requiredInt(
        getOrDefault(stats, "clearances_blocks_interceptions", 0),
        "LiveGameweekStats.clearances_blocks_interceptions",
      ),
      requiredInt(
        getOrDefault(stats, "recoveries", 0),
        "LiveGameweekStats.recoveries",
      ),
      requiredInt(
        getOrDefault(stats, "defensive_contribution", 0),
        "LiveGameweekStats.defensive_contribution",
      ),
      requiredInt(
        getOrDefault(stats, "total_points", 0),
        "LiveGameweekStats.total_points",
      ),
      _bool_int(stats.in_dreamteam),
      jsonBlob(d.explain),
    );
  }

  toDbTuple(): DbValue[] {
    return [
      this.player_fpl_id,
      this.gameweek_fpl_id,
      this.minutes,
      this.goals_scored,
      this.assists,
      this.clean_sheets,
      this.goals_conceded,
      this.own_goals,
      this.penalties_saved,
      this.penalties_missed,
      this.yellow_cards,
      this.red_cards,
      this.saves,
      this.bonus,
      this.bps,
      this.influence,
      this.creativity,
      this.threat,
      this.ict_index,
      this.starts,
      this.expected_goals,
      this.expected_assists,
      this.expected_goal_involvements,
      this.expected_goals_conceded,
      this.tackles,
      this.clearances_blocks_interceptions,
      this.recoveries,
      this.defensive_contribution,
      this.total_points,
      this.in_dreamteam,
      this.explain,
      this.scraped_at,
    ];
  }
}

/** Stable scrape-log row so the later DB port can write and assert exact tuple order. */
export class ScrapeLog {
  constructor(
    public readonly run_id: string,
    public readonly mode: string,
    public readonly gameweek_fpl_id: number | null,
    public readonly started_at: string,
    public readonly finished_at: string | null,
    public readonly status: string,
    public readonly players_scraped: number,
    public readonly requests_made: number,
    public readonly errors_encountered: number,
    public readonly error_detail: string | null,
  ) {}

  static fromDict(d: RawRecord): ScrapeLog {
    return new ScrapeLog(
      requiredString(d.run_id, "ScrapeLog.run_id"),
      requiredString(d.mode, "ScrapeLog.mode"),
      _int(d.gameweek_fpl_id),
      requiredString(d.started_at, "ScrapeLog.started_at"),
      _str(d.finished_at),
      requiredString(d.status, "ScrapeLog.status"),
      requiredInt(d.players_scraped, "ScrapeLog.players_scraped"),
      requiredInt(d.requests_made, "ScrapeLog.requests_made"),
      requiredInt(d.errors_encountered, "ScrapeLog.errors_encountered"),
      _str(d.error_detail),
    );
  }

  toDbTuple(): DbValue[] {
    return [
      this.run_id,
      this.mode,
      this.gameweek_fpl_id,
      this.started_at,
      this.finished_at,
      this.status,
      this.players_scraped,
      this.requests_made,
      this.errors_encountered,
      this.error_detail,
    ];
  }
}
