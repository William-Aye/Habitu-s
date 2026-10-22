"""Client for the local embed-query Edge Function (`npx supabase functions serve embed-query`)."""
import os

import httpx
import pytest

URL = os.environ.get("EMBED_QUERY_URL", "http://127.0.0.1:55321/functions/v1/embed-query")


def unavailable(reason: str):
    """Fail in CI, where the function is always served; skip elsewhere."""
    msg = (f"embed-query not usable at {URL}: {reason}. Run `npx supabase functions serve embed-query` "
           "and set SUPABASE_ANON_KEY to the local anon key (`npx supabase status -o env`).")
    if os.environ.get("CI"):
        pytest.fail(msg)
    pytest.skip(msg)


def connect():
    """Return call(text) -> embedding once the function answers, or fail/skip via unavailable()."""
    key = os.environ.get("SUPABASE_ANON_KEY", "")
    headers = {"Authorization": f"Bearer {key}"} if key else {}

    def call(q):
        r = httpx.post(URL, json={"text": q}, headers=headers, timeout=120)
        r.raise_for_status()
        return r.json()["embedding"]

    try:
        call("test")
    except (httpx.TransportError, httpx.HTTPStatusError) as e:
        unavailable(f"{type(e).__name__}: {e}")
    return call
