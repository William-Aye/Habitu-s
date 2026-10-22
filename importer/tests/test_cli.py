"""`run` orchestration with the database layer replaced by fakes (no DB needed)."""
from pathlib import Path
from uuid import uuid4

import pytest

from importer import cli, db
from importer.geocode import GeocodeError
from importer.osm import OsmSourceError

FIXTURES = Path(__file__).parent / "fixtures"
RNA = str(FIXTURES / "rna_sample.csv")
OSM = str(FIXTURES / "osm_sample.geojsonseq")


class FakeDb:
    def __init__(self):
        self.calls = []
        self.run_id = uuid4()

    def install(self, monkeypatch):
        monkeypatch.setattr(cli.psycopg, "connect", lambda url: _NullConn())
        monkeypatch.setattr(cli.db, "start_run", self.start_run)
        monkeypatch.setattr(cli.db, "fail_run", self.fail_run)
        monkeypatch.setattr(cli.db, "existing_counts", lambda conn, scope: (0, 0))
        monkeypatch.setattr(cli.db, "existing_hashes", lambda conn: ({}, {}))
        monkeypatch.setattr(cli.db, "GeocodeCache", lambda conn: _DictCache())
        monkeypatch.setattr(cli.db, "stage", lambda *a: self.calls.append("stage"))
        monkeypatch.setattr(cli.db, "apply", lambda *a: self.calls.append("apply") or {"inserted": 1})

    def start_run(self, conn, scope):
        self.calls.append(("start", scope))
        return self.run_id

    def fail_run(self, conn, run_id, error):
        self.calls.append(("fail", run_id, error))


class _DictCache(dict):
    def prefetch(self, keys):
        pass

    def flush(self):
        pass


class _NullConn:
    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def args(*extra):
    return ["run", "--db-url", "postgresql://x", "--departements", "69", "--rna-zip", RNA,
            "--embedder", "fake", *extra]


def failures(fake):
    return [c for c in fake.calls if isinstance(c, tuple) and c[0] == "fail"]


def test_osm_source_error_fails_the_run(monkeypatch):
    fake = FakeDb()
    fake.install(monkeypatch)

    def boom(path):
        raise OsmSourceError("truncated export")
        yield  # pragma: no cover

    monkeypatch.setattr(cli, "read_osm_geojsonseq", boom)
    assert cli.main(args("--osm-geojsonseq", OSM)) == 1
    (fail,) = failures(fake)
    assert fail[1] == fake.run_id and "truncated export" in fail[2]
    assert "stage" not in fake.calls and "apply" not in fake.calls


def test_geocode_error_fails_the_run(monkeypatch):
    fake = FakeDb()
    fake.install(monkeypatch)

    class Broken:
        def __init__(self, *a, **kw):
            pass

        def geocode(self, records):
            raise GeocodeError("could not load commune centres")

    monkeypatch.setattr(cli, "Geocoder", Broken)
    assert cli.main(args("--skip-osm")) == 1
    (fail,) = failures(fake)
    assert "commune centres" in fail[2]
    assert "stage" not in fake.calls


def test_bad_rna_file_fails_before_staging(monkeypatch, tmp_path):
    fake = FakeDb()
    fake.install(monkeypatch)
    bad = tmp_path / "bad.csv"
    bad.write_text("id;titre\nW1;x\n", encoding="utf-8")
    assert cli.main(["run", "--db-url", "postgresql://x", "--rna-zip", str(bad), "--skip-osm"]) == 1
    (fail,) = failures(fake)
    assert "missing columns" in fail[2]
    assert fake.calls[0] == ("start", None)


def test_osm_file_required_unless_skipped():
    with pytest.raises(SystemExit) as exc:
        cli.main(["run", "--db-url", "postgresql://x", "--rna-zip", RNA])
    assert exc.value.code == 2


def test_volume_check_thresholds():
    # small existing counts are exempt (first run, test databases)
    assert db.volume_problems(rna_read=0, rna_existing=99, osm_read=0, osm_existing=99) == []
    # 80 % of 1000 is fine, below is not
    assert db.volume_problems(rna_read=800, rna_existing=1000, osm_read=None, osm_existing=1000) == []
    problems = db.volume_problems(rna_read=799, rna_existing=1000, osm_read=10, osm_existing=200)
    assert len(problems) == 2
    assert "RNA" in problems[0] and "799" in problems[0] and "1000" in problems[0]
    assert "OSM" in problems[1]
