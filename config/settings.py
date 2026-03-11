"""
Central configuration. All tunables live here.
Reads .env from the project root via python-dotenv.
"""
import os
from pathlib import Path

from dotenv import load_dotenv

# Resolve project root (two levels up from this file: config/ -> root)
BASE_DIR = Path(__file__).resolve().parent.parent

# Load .env from project root (silently ignored if missing)
load_dotenv(BASE_DIR / ".env")

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
DATA_DIR = BASE_DIR / "data"
LOG_DIR = BASE_DIR / "logs"
DB_PATH: str = os.getenv("DB_PATH", str(DATA_DIR / "fpl.db"))
LOG_FILE: str = str(LOG_DIR / "fpl_scraper.log")
SESSION_FILE: str = str(DATA_DIR / ".session.json")

# ---------------------------------------------------------------------------
# FPL API
# ---------------------------------------------------------------------------
FPL_BASE_URL = "https://fantasy.premierleague.com/api"
FPL_LOGIN_URL = "https://users.premierleague.com/accounts/login/"
FPL_LOGIN: str = os.getenv("FPL_LOGIN", "")
FPL_PASSWORD: str = os.getenv("FPL_PASSWORD", "")

# ---------------------------------------------------------------------------
# HTTP / rate limiting
# ---------------------------------------------------------------------------
REQUEST_DELAY_MIN: float = float(os.getenv("REQUEST_DELAY_MIN", "2.0"))
REQUEST_DELAY_MAX: float = float(os.getenv("REQUEST_DELAY_MAX", "3.0"))
BACKOFF_FACTOR: float = float(os.getenv("BACKOFF_FACTOR", "2.0"))
MAX_RETRIES: int = int(os.getenv("MAX_RETRIES", "5"))
MAX_BACKOFF: float = float(os.getenv("MAX_BACKOFF", "120.0"))
REQUEST_TIMEOUT: int = int(os.getenv("REQUEST_TIMEOUT", "30"))

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
LOG_LEVEL: str = os.getenv("LOG_LEVEL", "INFO").upper()
