"""End-to-end `run` against the local Supabase DB (needs `npm run db:start`; `npm run db:reset` first)."""
import csv
import io
import json
from pathlib import Path

import httpx
import psycopg
import pytest
import respx

from importer import cli, db
from importer.embed import FakeEmbedder
from importer.geocode import COMMUNES_URL, GEOCODER_CSV_URL

pytestmark = pytest.mark.integration

URL = "postgresql://postgres:postgres@127.0.0.1:55322/postgres"
FIXTURES = Path(__file__).parent / "fixtures"
RNA = str(FIXTURES / "rna_sample.csv")
OSM = str(FIXTURES / "osm_sample.geojsonseq")
COMMUNES = [
    {"code": "69123", "centre": {"coordinates": [4.835, 45.758]}},
    {"code": "69266", "centre": {"coordinates": [4.88, 45.771]}},
]


class CountingEmbedder(FakeEmbedder):
    def __init__(self):
        self.texts = 0

    def embed(self, texts):
        self.texts += len(texts)
        return super().embed(texts)


def geocoder_handler(request):
    body = request.content.decode("utf-8")
    start = body.index("key,address,postcode,citycode")
    end = body.index("\r\n--", start)
    out = io.StringIO()
    w = csv.writer(out)
    w.writerow(["key", "address", "postcode", "citycode", "latitude", "longitude", "result_score"])
    for i, r in enumerate(csv.DictReader(io.StringIO(body[start:end]))):
        if "Marché" in r["address"]:  # Club de Go de Lyon: on top of the OSM "Go Club Lyon" node
            lat, lon = 45.76508, 4.8351
        else:
            lat, lon = 45.745 + i * 0.004, 4.81 + i * 0.003
        w.writerow([r["key"], r["address"], r["postcode"], r["citycode"], lat, lon, "0.9"])
    return httpx.Response(200, text=out.getvalue())


@pytest.fixture
def conn():
    with psycopg.connect(URL, autocommit=True) as c:
        # Clean slate for imported data so the test can be re-run without a reset.
        c.execute("delete from public.associations where source in ('rna', 'osm', 'rna+osm')")
        c.execute("delete from public.import_runs")
        c.execute("delete from importer.geocode_cache")
        yield c


@pytest.fixture
def embedder(monkeypatch):
    e = CountingEmbedder()
    monkeypatch.setattr(cli, "make_embedder", lambda name: e)
    return e


def run(*extra, rna=RNA, dept="69"):
    with respx.mock(assert_all_called=False) as mock:
        mock.get(COMMUNES_URL).respond(json=COMMUNES)
        mock.post(GEOCODER_CSV_URL).mock(side_effect=geocoder_handler)
        return cli.main(["run", "--db-url", URL, "--departements", dept, "--rna-zip", rna,
                         "--osm-geojsonseq", OSM, "--embedder", "fake", *extra])


def one(conn, sql, *args):
    return conn.execute(sql, args or None).fetchone()


def last_run(conn):
    return one(conn, "select status, error, counts from public.import_runs order by started_at desc limit 1")


def snapshot(conn):
    return conn.execute(
        "select coalesce(rna_id, osm_id), name, source, phone, confidence, "
        "extensions.st_astext(location::extensions.geometry), embedding_hash "
        "from public.associations order by 1").fetchall()


def count(conn):
    return one(conn, "select count(*) from public.associations")[0]


def test_run_end_to_end(conn, embedder, tmp_path, monkeypatch, capsys):
    # --- first run ---
    assert run() == 0
    printed = json.loads(capsys.readouterr().out)
    assert printed["inserted"] == 8
    assert one(conn, "select count(*) from public.associations where rna_id is not null and insee_code like '69%'")[0] == 8
    assert one(conn, "select source, phone from public.associations where name = 'Club de Go de Lyon'") == (
        "rna+osm", "+33 4 78 00 00 01")
    assert one(conn, "select source from public.associations where name = 'Club de Go Lyon Sud'") == ("osm",)
    assert one(conn, "select likely_not_public from public.associations where name like 'Syndicat de copropriété%'") == (True,)
    assert one(conn, "select postcode, city from public.associations where rna_id = 'W691000004'") == (
        "69100", "Villeurbanne")
    slugs = {r[0] for r in conn.execute(
        "select t.slug from public.association_tags at join public.tags t on t.id = at.tag_id "
        "join public.associations a on a.id = at.association_id where a.name = 'Club de Go de Lyon'")}
    assert "games-go" in slugs
    assert one(conn, "select count(*) from public.associations where embedding is null "
                     "or extensions.vector_dims(embedding) <> 384")[0] == 0
    assert last_run(conn)[0] == "succeeded"
    assert one(conn, "select count(*) from importer.geocode_cache")[0] > 0
    assert embedder.texts > 0
    before = count(conn)

    # --- second run: nothing new, nothing re-embedded ---
    embedder.texts = 0
    assert run() == 0
    counts = json.loads(capsys.readouterr().out)
    assert counts["inserted"] == 0
    assert counts["updated"] == 0  # nothing changed, nothing rewritten
    assert embedder.texts == 0
    assert count(conn) == before
    assert last_run(conn)[0] == "succeeded"

    # --- a département with no RNA record fails before geocoding or staging ---
    snap = snapshot(conn)
    assert run(dept="69,13") == 1
    status, error, _ = last_run(conn)
    assert status == "failed" and "no RNA records read for département(s) 13" in error

    # --- apply_run fails after a successful COPY (Python guard bypassed: département 13 has
    # no staged RNA) ---
    monkeypatch.setattr(cli, "check_scope_read", lambda scope, read: None)
    assert run(dept="69,13") == 1
    status, error, _ = last_run(conn)
    assert status == "failed" and "13" in error and "refusing to merge" in error
    assert one(conn, "select count(*) from importer.staged_rna")[0] == 0
    assert one(conn, "select count(*) from importer.staged_osm")[0] == 0
    assert count(conn) == before
    assert snapshot(conn) == snap

    # --- bad CSV: aborts, live data untouched ---
    bad = tmp_path / "bad.csv"
    rows = list(csv.reader(open(RNA, encoding="utf-8", newline=""), delimiter=";"))
    col = rows[0].index("adrs_codeinsee")
    with open(bad, "w", encoding="utf-8", newline="") as f:
        csv.writer(f, delimiter=";").writerows([r[:col] + r[col + 1:] for r in rows])
    assert run(rna=str(bad)) == 1
    status, error, _ = last_run(conn)
    assert status == "failed" and "adrs_codeinsee" in error
    assert count(conn) == before
    assert one(conn, "select count(*) from importer.staged_rna")[0] == 0

    # --- volume sanity check (threshold lowered so the small fixture counts) ---
    monkeypatch.setattr(db, "VOLUME_MIN_EXISTING", 5)
    small = tmp_path / "small.csv"
    with open(small, "w", encoding="utf-8", newline="") as f:
        csv.writer(f, delimiter=";").writerows(rows[:3])  # header + 2 associations in 69
    assert run(rna=str(small)) == 1
    status, error, _ = last_run(conn)
    assert status == "failed" and "--allow-large-drop" in error
    assert count(conn) == before

    # Dissolved-but-kept listings (confidence 0) do not count in the denominator.
    conn.execute("update public.associations set confidence = 0 "
                 "where rna_id is not null and rna_id not in ('W691000001', 'W691000002')")
    osm_only = one(conn, "select count(*) from public.associations where source = 'osm'")[0]
    assert run("--skip-osm", rna=str(small)) == 0
    assert last_run(conn)[0] == "succeeded"
    assert one(conn, "select count(*) from public.associations where rna_id is not null")[0] == 2
    # --skip-osm: OSM-only listings left alone
    assert one(conn, "select count(*) from public.associations where source = 'osm'")[0] == osm_only


def test_concurrent_import_refused(conn):
    with psycopg.connect(URL, autocommit=True) as other:
        other.execute("select pg_advisory_lock(%s)", (db.RUN_LOCK_KEY,))
        assert run() == 1
    assert one(conn, "select count(*) from public.import_runs")[0] == 0


def test_stale_running_rows_are_marked_abandoned(conn, embedder):
    old = one(conn, "insert into public.import_runs (started_at) values (now() - interval '25 hours') "
                    "returning id")[0]
    recent = one(conn, "insert into public.import_runs (started_at) values (now() - interval '1 hour') "
                       "returning id")[0]
    assert run() == 0
    assert one(conn, "select status, error from public.import_runs where id = %s", old) == ("failed", "abandoned")
    assert one(conn, "select finished_at is not null from public.import_runs where id = %s", old) == (True,)
    assert one(conn, "select status from public.import_runs where id = %s", recent) == ("running",)
