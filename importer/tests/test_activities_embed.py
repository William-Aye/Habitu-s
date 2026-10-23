"""embed_pending_activities against the local Supabase DB (`npm run db:reset` first)."""
import uuid

import psycopg
import pytest

from importer import cli
from importer.activities_embed import embed_pending_activities
from importer.embed import FakeEmbedder

pytestmark = pytest.mark.integration

URL = "postgresql://postgres:postgres@127.0.0.1:55322/postgres"
TITLE = "AETEST Initiation au go"


class CountingEmbedder(FakeEmbedder):
    def __init__(self):
        self.texts = 0

    def embed(self, texts):
        self.texts += len(texts)
        return super().embed(texts)


def _clear(c):
    c.execute("delete from public.activities where title like 'AETEST%'")
    c.execute("delete from public.collectifs where name like 'AETEST%'")
    c.execute("delete from auth.users where email = 'aetest@test.fr'")
    c.execute("delete from public.categories where slug = 'aetest-go'")


@pytest.fixture
def conn():
    with psycopg.connect(URL, autocommit=True) as c:
        _clear(c)
        # The function embeds every stale row, ours and others' (ranking fixture, seed). Park the others'
        # vectors, embed them with the fake embedder so only our rows are pending, restore at the end.
        for t in ("activities", "collectifs"):
            c.execute(f"create temp table ae_snap_{t} as select id, embedding, embedding_hash from public.{t}")
        try:
            embed_pending_activities(c, FakeEmbedder())
            user = uuid.uuid4()
            c.execute(
                "insert into auth.users (id, instance_id, aud, role, email, encrypted_password, raw_app_meta_data, "
                "raw_user_meta_data) values (%s, '00000000-0000-0000-0000-000000000000', 'authenticated', "
                "'authenticated', 'aetest@test.fr', '', '{}', '{\"first_name\": \"Test\"}')", (user,))
            cat = c.execute(
                "insert into public.categories (slug, name_fr, name_en, icon) values ('aetest-go', 'Go', 'Go', 'x') "
                "returning id").fetchone()[0]
            c.execute(
                "insert into public.activities (organiser_id, category_id, title, description, place_label, place, "
                "recurrence_kind, start_date, start_time) values (%s, %s, %s, 'Pour debutants', 'Cafe', "
                "'SRID=4326;POINT(4.85 45.77)', 'weekly', current_date + 100, '19:00')", (user, cat, TITLE))
            c.execute(
                "insert into public.collectifs (name, description, town_label, town_point, created_by) "
                "values ('AETEST Joueurs de go', 'Parties de go', 'Lyon', 'SRID=4326;POINT(4.85 45.77)', %s)", (user,))
            yield c
        finally:
            _clear(c)
            for t in ("activities", "collectifs"):
                c.execute(f"update public.{t} x set embedding = s.embedding, embedding_hash = s.embedding_hash "
                          f"from ae_snap_{t} s where s.id = x.id")


def _state(c):
    return c.execute(
        "select embedding is not null, embedding_hash from public.activities where title = %s", (TITLE,)
    ).fetchone()


def test_new_rows_are_embedded_once(conn):
    e = CountingEmbedder()
    assert embed_pending_activities(conn, e) == 2
    has_vec, h = _state(conn)
    assert has_vec and len(h) == 64
    assert conn.execute("select embedding is not null from public.collectifs where name like 'AETEST%'").fetchone()[0]
    assert embed_pending_activities(conn, e) == 0
    assert e.texts == 2


def test_edited_description_is_embedded_again(conn):
    e = CountingEmbedder()
    embed_pending_activities(conn, e)
    _, before = _state(conn)
    conn.execute("update public.activities set description = 'Pour confirmes' where title = %s", (TITLE,))
    assert embed_pending_activities(conn, e) == 1
    assert _state(conn)[1] != before
    assert embed_pending_activities(conn, e) == 0


def test_batches_and_cli(conn, capsys):
    assert embed_pending_activities(conn, FakeEmbedder(), batch_size=1) == 2
    conn.execute("update public.activities set embedding_hash = 'stale' where title = %s", (TITLE,))
    assert cli.main(["embed-activities", "--db-url", URL, "--embedder", "fake"]) == 0
    assert '"embedded": 1' in capsys.readouterr().out
