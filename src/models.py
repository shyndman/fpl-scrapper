"""
Dataclass definitions mirroring the SQLite tables.
Each class provides:
  - from_dict(d)    -- construct from raw FPL API JSON
  - to_db_tuple()   -- values in column-insertion order for DB upserts
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any


def _str(v: Any) -> str | None:
    if v is None:
        return None
    s = str(v).strip()
    return s if s else None


def _int(v: Any) -> int | None:
    if v is None:
        return None
    try:
        return int(v)
    except (ValueError, TypeError):
        return None


def _float_str(v: Any) -> str | None:
    """Keep numeric strings as strings (FPL returns 'influence' etc. as strings)."""
    if v is None:
        return None
    s = str(v).strip()
    return s if s else None


def _float(v: Any) -> float | None:
    """Parse a value to float, returning None if missing or unparseable."""
    if v is None:
        return None
    try:
        return float(v)
    except (ValueError, TypeError):
        return None


def _bool_int(v: Any) -> int:
    return 1 if v else 0


def _xp(actual: int, expected: float | None) -> float | None:
    """
    Calculate performance vs expectation (actual minus expected).
    Returns None when expected is unavailable.  Result is rounded to 2 d.p.
    Positive → overperformed; negative → underperformed.
    """
    if expected is None:
        return None
    try:
        return round(actual - expected, 2)
    except (ValueError, TypeError):
        return None


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ---------------------------------------------------------------------------
# Team
# ---------------------------------------------------------------------------

@dataclass
class Team:
    fpl_id: int
    name: str
    short_name: str
    code: int | None
    strength: int | None
    strength_overall_home: int | None
    strength_overall_away: int | None
    strength_attack_home: int | None
    strength_attack_away: int | None
    strength_defence_home: int | None
    strength_defence_away: int | None
    pulse_id: int | None
    scraped_at: str = field(default_factory=_now)

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "Team":
        return cls(
            fpl_id=int(d["id"]),
            name=str(d["name"]),
            short_name=str(d["short_name"]),
            code=_int(d.get("code")),
            strength=_int(d.get("strength")),
            strength_overall_home=_int(d.get("strength_overall_home")),
            strength_overall_away=_int(d.get("strength_overall_away")),
            strength_attack_home=_int(d.get("strength_attack_home")),
            strength_attack_away=_int(d.get("strength_attack_away")),
            strength_defence_home=_int(d.get("strength_defence_home")),
            strength_defence_away=_int(d.get("strength_defence_away")),
            pulse_id=_int(d.get("pulse_id")),
        )

    def to_db_tuple(self) -> tuple:
        return (
            self.fpl_id,
            self.name,
            self.short_name,
            self.code,
            self.strength,
            self.strength_overall_home,
            self.strength_overall_away,
            self.strength_attack_home,
            self.strength_attack_away,
            self.strength_defence_home,
            self.strength_defence_away,
            self.pulse_id,
            self.scraped_at,
        )


# ---------------------------------------------------------------------------
# Gameweek
# ---------------------------------------------------------------------------

@dataclass
class Gameweek:
    fpl_id: int
    name: str
    deadline_time: str
    average_entry_score: int | None
    highest_score: int | None
    highest_scoring_entry: int | None
    is_current: int
    is_next: int
    is_finished: int
    chip_plays: str | None  # JSON blob
    most_selected: int | None
    most_transferred_in: int | None
    most_captained: int | None
    most_vice_captained: int | None
    transfers_made: int | None
    scraped_at: str = field(default_factory=_now)

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "Gameweek":
        import json
        chip_plays = d.get("chip_plays")
        return cls(
            fpl_id=int(d["id"]),
            name=str(d["name"]),
            deadline_time=str(d.get("deadline_time", "")),
            average_entry_score=_int(d.get("average_entry_score")),
            highest_score=_int(d.get("highest_score")),
            highest_scoring_entry=_int(d.get("highest_scoring_entry")),
            is_current=_bool_int(d.get("is_current")),
            is_next=_bool_int(d.get("is_next")),
            is_finished=_bool_int(d.get("finished")),
            chip_plays=json.dumps(chip_plays) if chip_plays else None,
            most_selected=_int(d.get("most_selected")),
            most_transferred_in=_int(d.get("most_transferred_in")),
            most_captained=_int(d.get("most_captained")),
            most_vice_captained=_int(d.get("most_vice_captained")),
            transfers_made=_int(d.get("transfers_made")),
        )

    def to_db_tuple(self) -> tuple:
        return (
            self.fpl_id,
            self.name,
            self.deadline_time,
            self.average_entry_score,
            self.highest_score,
            self.highest_scoring_entry,
            self.is_current,
            self.is_next,
            self.is_finished,
            self.chip_plays,
            self.most_selected,
            self.most_transferred_in,
            self.most_captained,
            self.most_vice_captained,
            self.transfers_made,
            self.scraped_at,
        )


# ---------------------------------------------------------------------------
# Player
# ---------------------------------------------------------------------------

@dataclass
class Player:
    fpl_id: int
    first_name: str
    second_name: str
    web_name: str
    team_fpl_id: int
    element_type: int
    status: str | None
    code: int | None
    now_cost: int | None
    cost_change_start: int | None
    cost_change_event: int | None
    chance_of_playing_this_round: int | None
    chance_of_playing_next_round: int | None
    total_points: int
    event_points: int
    points_per_game: str | None
    form: str | None
    selected_by_percent: str | None
    transfers_in: int
    transfers_out: int
    transfers_in_event: int
    transfers_out_event: int
    minutes: int
    goals_scored: int
    assists: int
    clean_sheets: int
    goals_conceded: int
    own_goals: int
    penalties_saved: int
    penalties_missed: int
    yellow_cards: int
    red_cards: int
    saves: int
    bonus: int
    bps: int
    influence: str | None
    creativity: str | None
    threat: str | None
    ict_index: str | None
    starts: int
    expected_goals: float | None
    expected_assists: float | None
    expected_goal_involvements: float | None
    expected_goals_conceded: str | None
    xgp: float | None   # goals_scored  - expected_goals
    xap: float | None   # assists        - expected_assists
    xgip: float | None  # xgp + xap
    news: str | None
    news_added: str | None
    squad_number: int | None
    photo: str | None
    scraped_at: str = field(default_factory=_now)

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "Player":
        xgp  = _xp(int(d.get("goals_scored", 0)), _float(d.get("expected_goals")))
        xap  = _xp(int(d.get("assists",       0)), _float(d.get("expected_assists")))
        xgip = round(xgp + xap, 2) if xgp is not None and xap is not None else None
        return cls(
            fpl_id=int(d["id"]),
            first_name=str(d.get("first_name", "")),
            second_name=str(d.get("second_name", "")),
            web_name=str(d.get("web_name", "")),
            team_fpl_id=int(d["team"]),
            element_type=int(d["element_type"]),
            status=_str(d.get("status")),
            code=_int(d.get("code")),
            now_cost=_int(d.get("now_cost")),
            cost_change_start=_int(d.get("cost_change_start")),
            cost_change_event=_int(d.get("cost_change_event")),
            chance_of_playing_this_round=_int(d.get("chance_of_playing_this_round")),
            chance_of_playing_next_round=_int(d.get("chance_of_playing_next_round")),
            total_points=int(d.get("total_points", 0)),
            event_points=int(d.get("event_points", 0)),
            points_per_game=_float_str(d.get("points_per_game")),
            form=_float_str(d.get("form")),
            selected_by_percent=_float_str(d.get("selected_by_percent")),
            transfers_in=int(d.get("transfers_in", 0)),
            transfers_out=int(d.get("transfers_out", 0)),
            transfers_in_event=int(d.get("transfers_in_event", 0)),
            transfers_out_event=int(d.get("transfers_out_event", 0)),
            minutes=int(d.get("minutes", 0)),
            goals_scored=int(d.get("goals_scored", 0)),
            assists=int(d.get("assists", 0)),
            clean_sheets=int(d.get("clean_sheets", 0)),
            goals_conceded=int(d.get("goals_conceded", 0)),
            own_goals=int(d.get("own_goals", 0)),
            penalties_saved=int(d.get("penalties_saved", 0)),
            penalties_missed=int(d.get("penalties_missed", 0)),
            yellow_cards=int(d.get("yellow_cards", 0)),
            red_cards=int(d.get("red_cards", 0)),
            saves=int(d.get("saves", 0)),
            bonus=int(d.get("bonus", 0)),
            bps=int(d.get("bps", 0)),
            influence=_float_str(d.get("influence")),
            creativity=_float_str(d.get("creativity")),
            threat=_float_str(d.get("threat")),
            ict_index=_float_str(d.get("ict_index")),
            starts=int(d.get("starts", 0)),
            expected_goals=_float(d.get("expected_goals")),
            expected_assists=_float(d.get("expected_assists")),
            expected_goal_involvements=_float(d.get("expected_goal_involvements")),
            expected_goals_conceded=_float_str(d.get("expected_goals_conceded")),
            xgp=xgp, xap=xap, xgip=xgip,
            news=_str(d.get("news")),
            news_added=_str(d.get("news_added")),
            squad_number=_int(d.get("squad_number")),
            photo=_str(d.get("photo")),
        )

    def to_db_tuple(self) -> tuple:
        return (
            self.fpl_id, self.first_name, self.second_name, self.web_name,
            self.team_fpl_id, self.element_type, self.status, self.code,
            self.now_cost, self.cost_change_start, self.cost_change_event,
            self.chance_of_playing_this_round, self.chance_of_playing_next_round,
            self.total_points, self.event_points, self.points_per_game,
            self.form, self.selected_by_percent,
            self.transfers_in, self.transfers_out,
            self.transfers_in_event, self.transfers_out_event,
            self.minutes, self.goals_scored, self.assists, self.clean_sheets,
            self.goals_conceded, self.own_goals, self.penalties_saved,
            self.penalties_missed, self.yellow_cards, self.red_cards,
            self.saves, self.bonus, self.bps,
            self.influence, self.creativity, self.threat, self.ict_index,
            self.starts,
            self.expected_goals, self.expected_assists,
            self.expected_goal_involvements, self.expected_goals_conceded,
            self.xgp, self.xap, self.xgip,
            self.news, self.news_added, self.squad_number, self.photo,
            self.scraped_at,
        )


# ---------------------------------------------------------------------------
# PlayerHistory (per-gameweek row)
# ---------------------------------------------------------------------------

@dataclass
class PlayerHistory:
    player_fpl_id: int
    gameweek_fpl_id: int
    opponent_team: int | None
    was_home: int
    kickoff_time: str | None
    total_points: int
    minutes: int
    goals_scored: int
    assists: int
    clean_sheets: int
    goals_conceded: int
    own_goals: int
    penalties_saved: int
    penalties_missed: int
    yellow_cards: int
    red_cards: int
    saves: int
    bonus: int
    bps: int
    influence: str | None
    creativity: str | None
    threat: str | None
    ict_index: str | None
    starts: int
    expected_goals: float | None
    expected_assists: float | None
    expected_goal_involvements: float | None
    expected_goals_conceded: str | None
    xgp: float | None
    xap: float | None
    xgip: float | None
    value: int | None
    transfers_balance: int | None
    selected: int | None
    transfers_in: int
    transfers_out: int
    round: int | None
    scraped_at: str = field(default_factory=_now)

    @classmethod
    def from_dict(cls, player_fpl_id: int, d: dict[str, Any]) -> "PlayerHistory":
        xgp  = _xp(int(d.get("goals_scored", 0)), _float(d.get("expected_goals")))
        xap  = _xp(int(d.get("assists",       0)), _float(d.get("expected_assists")))
        xgip = round(xgp + xap, 2) if xgp is not None and xap is not None else None
        return cls(
            player_fpl_id=player_fpl_id,
            gameweek_fpl_id=int(d["round"]),
            opponent_team=_int(d.get("opponent_team")),
            was_home=_bool_int(d.get("was_home")),
            kickoff_time=_str(d.get("kickoff_time")),
            total_points=int(d.get("total_points", 0)),
            minutes=int(d.get("minutes", 0)),
            goals_scored=int(d.get("goals_scored", 0)),
            assists=int(d.get("assists", 0)),
            clean_sheets=int(d.get("clean_sheets", 0)),
            goals_conceded=int(d.get("goals_conceded", 0)),
            own_goals=int(d.get("own_goals", 0)),
            penalties_saved=int(d.get("penalties_saved", 0)),
            penalties_missed=int(d.get("penalties_missed", 0)),
            yellow_cards=int(d.get("yellow_cards", 0)),
            red_cards=int(d.get("red_cards", 0)),
            saves=int(d.get("saves", 0)),
            bonus=int(d.get("bonus", 0)),
            bps=int(d.get("bps", 0)),
            influence=_float_str(d.get("influence")),
            creativity=_float_str(d.get("creativity")),
            threat=_float_str(d.get("threat")),
            ict_index=_float_str(d.get("ict_index")),
            starts=int(d.get("starts", 0)),
            expected_goals=_float(d.get("expected_goals")),
            expected_assists=_float(d.get("expected_assists")),
            expected_goal_involvements=_float(d.get("expected_goal_involvements")),
            expected_goals_conceded=_float_str(d.get("expected_goals_conceded")),
            xgp=xgp,
            xap=xap,
            xgip=xgip,
            value=_int(d.get("value")),
            transfers_balance=_int(d.get("transfers_balance")),
            selected=_int(d.get("selected")),
            transfers_in=int(d.get("transfers_in", 0)),
            transfers_out=int(d.get("transfers_out", 0)),
            round=_int(d.get("round")),
        )

    def to_db_tuple(self) -> tuple:
        return (
            self.player_fpl_id, self.gameweek_fpl_id,
            self.opponent_team, self.was_home, self.kickoff_time,
            self.total_points, self.minutes, self.goals_scored, self.assists,
            self.clean_sheets, self.goals_conceded, self.own_goals,
            self.penalties_saved, self.penalties_missed,
            self.yellow_cards, self.red_cards, self.saves,
            self.bonus, self.bps,
            self.influence, self.creativity, self.threat, self.ict_index,
            self.starts,
            self.expected_goals, self.expected_assists,
            self.expected_goal_involvements, self.expected_goals_conceded,
            self.xgp, self.xap, self.xgip,
            self.value, self.transfers_balance, self.selected,
            self.transfers_in, self.transfers_out, self.round,
            self.scraped_at,
        )


# ---------------------------------------------------------------------------
# PlayerHistoryPast (prior season summaries)
# ---------------------------------------------------------------------------

@dataclass
class PlayerHistoryPast:
    player_fpl_id: int
    season_name: str
    element_code: int | None
    start_cost: int | None
    end_cost: int | None
    total_points: int
    minutes: int
    goals_scored: int
    assists: int
    clean_sheets: int
    goals_conceded: int
    own_goals: int
    penalties_saved: int
    penalties_missed: int
    yellow_cards: int
    red_cards: int
    saves: int
    bonus: int
    bps: int
    influence: str | None
    creativity: str | None
    threat: str | None
    ict_index: str | None
    starts: int
    expected_goals: float | None
    expected_assists: float | None
    expected_goal_involvements: float | None
    expected_goals_conceded: str | None
    scraped_at: str = field(default_factory=_now)

    @classmethod
    def from_dict(cls, player_fpl_id: int, d: dict[str, Any]) -> "PlayerHistoryPast":
        return cls(
            player_fpl_id=player_fpl_id,
            season_name=str(d.get("season_name", "")),
            element_code=_int(d.get("element_code")),
            start_cost=_int(d.get("start_cost")),
            end_cost=_int(d.get("end_cost")),
            total_points=int(d.get("total_points", 0)),
            minutes=int(d.get("minutes", 0)),
            goals_scored=int(d.get("goals_scored", 0)),
            assists=int(d.get("assists", 0)),
            clean_sheets=int(d.get("clean_sheets", 0)),
            goals_conceded=int(d.get("goals_conceded", 0)),
            own_goals=int(d.get("own_goals", 0)),
            penalties_saved=int(d.get("penalties_saved", 0)),
            penalties_missed=int(d.get("penalties_missed", 0)),
            yellow_cards=int(d.get("yellow_cards", 0)),
            red_cards=int(d.get("red_cards", 0)),
            saves=int(d.get("saves", 0)),
            bonus=int(d.get("bonus", 0)),
            bps=int(d.get("bps", 0)),
            influence=_float_str(d.get("influence")),
            creativity=_float_str(d.get("creativity")),
            threat=_float_str(d.get("threat")),
            ict_index=_float_str(d.get("ict_index")),
            starts=int(d.get("starts", 0)),
            expected_goals=_float(d.get("expected_goals")),
            expected_assists=_float(d.get("expected_assists")),
            expected_goal_involvements=_float(d.get("expected_goal_involvements")),
            expected_goals_conceded=_float_str(d.get("expected_goals_conceded")),
        )

    def to_db_tuple(self) -> tuple:
        return (
            self.player_fpl_id, self.season_name, self.element_code,
            self.start_cost, self.end_cost, self.total_points, self.minutes,
            self.goals_scored, self.assists, self.clean_sheets, self.goals_conceded,
            self.own_goals, self.penalties_saved, self.penalties_missed,
            self.yellow_cards, self.red_cards, self.saves, self.bonus, self.bps,
            self.influence, self.creativity, self.threat, self.ict_index,
            self.starts,
            self.expected_goals, self.expected_assists,
            self.expected_goal_involvements, self.expected_goals_conceded,
            self.scraped_at,
        )


# ---------------------------------------------------------------------------
# Fixture
# ---------------------------------------------------------------------------

@dataclass
class Fixture:
    fpl_id: int
    gameweek_fpl_id: int | None
    kickoff_time: str | None
    team_h_fpl_id: int
    team_a_fpl_id: int
    team_h_score: int | None
    team_a_score: int | None
    finished: int
    finished_provisional: int
    started: int
    minutes: int
    team_h_difficulty: int | None
    team_a_difficulty: int | None
    code: int | None
    pulse_id: int | None
    stats: str | None  # JSON blob
    scraped_at: str = field(default_factory=_now)

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "Fixture":
        import json
        stats = d.get("stats")
        return cls(
            fpl_id=int(d["id"]),
            gameweek_fpl_id=_int(d.get("event")),
            kickoff_time=_str(d.get("kickoff_time")),
            team_h_fpl_id=int(d["team_h"]),
            team_a_fpl_id=int(d["team_a"]),
            team_h_score=_int(d.get("team_h_score")),
            team_a_score=_int(d.get("team_a_score")),
            finished=_bool_int(d.get("finished")),
            finished_provisional=_bool_int(d.get("finished_provisional")),
            started=_bool_int(d.get("started")),
            minutes=int(d.get("minutes", 0)),
            team_h_difficulty=_int(d.get("team_h_difficulty")),
            team_a_difficulty=_int(d.get("team_a_difficulty")),
            code=_int(d.get("code")),
            pulse_id=_int(d.get("pulse_id")),
            stats=json.dumps(stats) if stats else None,
        )

    def to_db_tuple(self) -> tuple:
        return (
            self.fpl_id, self.gameweek_fpl_id, self.kickoff_time,
            self.team_h_fpl_id, self.team_a_fpl_id,
            self.team_h_score, self.team_a_score,
            self.finished, self.finished_provisional, self.started, self.minutes,
            self.team_h_difficulty, self.team_a_difficulty,
            self.code, self.pulse_id, self.stats, self.scraped_at,
        )


# ---------------------------------------------------------------------------
# LiveGameweekStats
# ---------------------------------------------------------------------------

@dataclass
class LiveGameweekStats:
    player_fpl_id: int
    gameweek_fpl_id: int
    minutes: int
    goals_scored: int
    assists: int
    clean_sheets: int
    goals_conceded: int
    own_goals: int
    penalties_saved: int
    penalties_missed: int
    yellow_cards: int
    red_cards: int
    saves: int
    bonus: int
    bps: int
    influence: str | None
    creativity: str | None
    threat: str | None
    ict_index: str | None
    starts: int
    expected_goals: float | None
    expected_assists: float | None
    expected_goal_involvements: float | None
    expected_goals_conceded: str | None
    total_points: int
    in_dreamteam: int
    explain: str | None  # JSON blob
    scraped_at: str = field(default_factory=_now)

    @classmethod
    def from_dict(
        cls, player_fpl_id: int, gameweek_fpl_id: int, d: dict[str, Any]
    ) -> "LiveGameweekStats":
        import json
        stats = d.get("stats", {})
        explain = d.get("explain")
        return cls(
            player_fpl_id=player_fpl_id,
            gameweek_fpl_id=gameweek_fpl_id,
            minutes=int(stats.get("minutes", 0)),
            goals_scored=int(stats.get("goals_scored", 0)),
            assists=int(stats.get("assists", 0)),
            clean_sheets=int(stats.get("clean_sheets", 0)),
            goals_conceded=int(stats.get("goals_conceded", 0)),
            own_goals=int(stats.get("own_goals", 0)),
            penalties_saved=int(stats.get("penalties_saved", 0)),
            penalties_missed=int(stats.get("penalties_missed", 0)),
            yellow_cards=int(stats.get("yellow_cards", 0)),
            red_cards=int(stats.get("red_cards", 0)),
            saves=int(stats.get("saves", 0)),
            bonus=int(stats.get("bonus", 0)),
            bps=int(stats.get("bps", 0)),
            influence=_float_str(stats.get("influence")),
            creativity=_float_str(stats.get("creativity")),
            threat=_float_str(stats.get("threat")),
            ict_index=_float_str(stats.get("ict_index")),
            starts=int(stats.get("starts", 0)),
            expected_goals=_float(stats.get("expected_goals")),
            expected_assists=_float(stats.get("expected_assists")),
            expected_goal_involvements=_float(stats.get("expected_goal_involvements")),
            expected_goals_conceded=_float_str(stats.get("expected_goals_conceded")),
            total_points=int(stats.get("total_points", 0)),
            in_dreamteam=_bool_int(stats.get("in_dreamteam")),
            explain=json.dumps(explain) if explain else None,
        )

    def to_db_tuple(self) -> tuple:
        return (
            self.player_fpl_id, self.gameweek_fpl_id,
            self.minutes, self.goals_scored, self.assists,
            self.clean_sheets, self.goals_conceded, self.own_goals,
            self.penalties_saved, self.penalties_missed,
            self.yellow_cards, self.red_cards, self.saves,
            self.bonus, self.bps,
            self.influence, self.creativity, self.threat, self.ict_index,
            self.starts,
            self.expected_goals, self.expected_assists,
            self.expected_goal_involvements, self.expected_goals_conceded,
            self.total_points, self.in_dreamteam, self.explain,
            self.scraped_at,
        )


# ---------------------------------------------------------------------------
# ScrapeLog
# ---------------------------------------------------------------------------

@dataclass
class ScrapeLog:
    run_id: str
    mode: str
    gameweek_fpl_id: int | None
    started_at: str
    finished_at: str | None
    status: str
    players_scraped: int
    requests_made: int
    errors_encountered: int
    error_detail: str | None

    def to_db_tuple(self) -> tuple:
        return (
            self.run_id, self.mode, self.gameweek_fpl_id,
            self.started_at, self.finished_at, self.status,
            self.players_scraped, self.requests_made,
            self.errors_encountered, self.error_detail,
        )
