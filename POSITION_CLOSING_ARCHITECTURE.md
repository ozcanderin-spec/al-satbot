# Position closing ownership

Position closing is intentionally not implemented in this repository's GitHub Actions workflows. The sole close authority is the Supabase `public.run_virtual_sell_engine()` function, scheduled by pg_cron.

- `bot.yml` runs scanning and buy insertion only.
- `monitor.py` and `monitor.yml` are disabled compatibility stubs.
- The web UI must not UPDATE `trades` to close positions; it should only display Supabase state.
