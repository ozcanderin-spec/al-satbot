"""Deprecated position monitor.

Position closing is owned exclusively by Supabase
run_virtual_sell_engine(), scheduled by pg_cron. This module intentionally does
not read, update, or close trades.
"""

import logging

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("DeprecatedPositionMonitor")

if __name__ == "__main__":
    logger.warning(
        "monitor.py devre dışı: pozisyon kapatma yalnızca Supabase "
        "run_virtual_sell_engine()/pg_cron tarafından yapılır."
    )
