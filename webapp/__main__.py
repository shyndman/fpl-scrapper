"""
Entry point for: python -m webapp
Starts the FPL Dashboard on http://127.0.0.1:8000
"""
import logging

import uvicorn

from webapp.app import create_app

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(name)s  %(message)s",
    datefmt="%H:%M:%S",
)

app = create_app()

if __name__ == "__main__":
    uvicorn.run(
        "webapp.__main__:app",
        host="127.0.0.1",
        port=8000,
        reload=False,
        log_level="info",
    )
