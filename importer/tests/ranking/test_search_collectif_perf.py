"""Collectif search timing (local only): 5,000 collectifs with 3-5 active members near Paris.

The block filter of search_explore must not cost a scan of collectif_members per collectif, whether the
caller is anonymous or signed in with a few blocked users. Everything is seeded in one transaction that
is rolled back at the end, so no probe data is left. `npm run db:reset` first.
"""
import time

import psycopg
import pytest

pytestmark = [pytest.mark.integration, pytest.mark.perf]

URL = "postgresql://postgres:postgres@127.0.0.1:55322/postgres"
PARIS = (2.3522, 48.8566)
COLLECTIFS = 5_000
USERS = 400
ANON_LIMIT_MS = 800
SIGNED_IN_LIMIT_MS = 2000
SQL = "select public.search_explore(%s, %s, 50, 'club', p_limit => 20)"


@pytest.fixture(scope="module")
def perf_db():
    c = psycopg.connect(URL, autocommit=False)
    try:
        c.execute(
            """insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                 raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
               select gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated',
                      'authenticated', 'cperf' || g || '@perf.test', '', '{}', '{"first_name":"Perf"}', now(), now()
                 from generate_series(1, %s) g""", (USERS,))
        c.execute("create temp table perf_users as select id, row_number() over (order by email) n "
                  "from auth.users where email like 'cperf%%@perf.test'")
        c.execute(
            """insert into public.collectifs (name, town_label, town_point)
               select 'Collectif club perf ' || g, 'Paris',
                      ST_SetSRID(ST_MakePoint(%s + (random() - 0.5) * 1.2, %s + (random() - 0.5) * 0.8), 4326)::geography
                 from generate_series(1, %s) g""", (PARIS[0], PARIS[1], COLLECTIFS))
        c.execute(
            """insert into public.collectif_members (collectif_id, user_id, role, status, accepted_at)
               select k.id, u.id, 'organiser', 'active', now()
                 from (select id, row_number() over () r from public.collectifs where name like 'Collectif club perf %%') k
                 cross join generate_series(1, 5) s
                 join perf_users u on u.n = 1 + ((k.r * 7 + s * 13) %% %s)
                where s <= 3 + (k.r %% 3)
               on conflict do nothing""", (USERS,))
        me = c.execute("select id from perf_users where n = 1").fetchone()[0]
        c.execute("insert into public.blocks (blocker_id, blocked_id) select %s, id from perf_users where n in (2, 3, 4)", (me,))
        c.execute("analyze public.collectifs")
        c.execute("analyze public.collectif_members")
        yield c, str(me)
    finally:
        c.rollback()
        c.close()


def _time(c, as_user):
    c.execute("reset role")
    if as_user:
        c.execute("select set_config('request.jwt.claims', %s, true)",
                  ('{"sub":"%s","role":"authenticated"}' % as_user,))
        c.execute("set local role authenticated")
    else:
        c.execute("select set_config('request.jwt.claims', '{\"role\":\"anon\"}', true)")
        c.execute("set local role anon")
    c.execute(SQL, PARIS).fetchone()  # warm-up
    times = []
    for _ in range(5):
        t0 = time.perf_counter()
        r = c.execute(SQL, PARIS).fetchone()[0]
        times.append((time.perf_counter() - t0) * 1000)
    c.execute("reset role")
    assert any(x["kind"] == "collectif" for x in r["results"]), "the seeded collectifs must be found"
    times.sort()
    print(f"{'signed in' if as_user else 'anon'}, {COLLECTIFS} collectifs: sorted ms = {[round(t) for t in times]}")
    return times[-1], times


def test_anon_search_with_collectifs(perf_db):
    c, _ = perf_db
    p95, times = _time(c, None)
    assert p95 < ANON_LIMIT_MS, times


def test_signed_in_search_with_collectifs(perf_db):
    c, me = perf_db
    p95, times = _time(c, me)
    assert p95 < SIGNED_IN_LIMIT_MS, times
