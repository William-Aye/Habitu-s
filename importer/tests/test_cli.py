"""`run` orchestration with the database layer replaced by fakes (no DB needed)."""
from pathlib import Path
from collections.abc import Iterator
from uuid import uuid4

import pytest

from importer import cli, db
from importer.embed import FakeEmbedder
from importer.geocode import GeocodeError
from importer.models import GeoPoint, StagedOsm, StagedRna
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
        monkeypatch.setattr(cli.db, "existing_rna_by_departement", lambda conn, scope: {})
        monkeypatch.setattr(cli, "Geocoder", FakeGeocoder)
        monkeypatch.setattr(cli.db, "existing_hashes", lambda conn: ({}, {}))
        monkeypatch.setattr(cli.db, "GeocodeCache", lambda conn: _DictCache())
        monkeypatch.setattr(cli.db, "stage", lambda *a: self.calls.append("stage"))
        monkeypatch.setattr(cli.db, "apply", lambda *a: self.calls.append("apply") or {"inserted": 1})

    def start_run(self, conn, scope):
        self.calls.append(("start", scope))
        return self.run_id

    def fail_run(self, conn, run_id, error):
        self.calls.append(("fail", run_id, error))


def _commune(lon, lat):
    return GeoPoint(lon, lat, "municipality")


COMMUNES = {
    "69123": _commune(4.835, 45.758),
    "69266": _commune(4.880, 45.771),
    "75056": _commune(2.352, 48.857),
    "2A004": _commune(8.737, 41.927),
    "97105": _commune(-61.726, 15.998),
}


class FakeGeocoder:
    """No geocoding (every address unresolved); commune centres from COMMUNES."""
    instances: list["FakeGeocoder"] = []

    def __init__(self, *a, **kw):
        self.geocoded = 0
        self.communes_loaded = 0
        FakeGeocoder.instances.append(self)

    def communes(self):
        self.communes_loaded += 1
        return COMMUNES

    def geocode(self, records):
        self.geocoded += len(records)
        return {r.rna_id: None for r in records}


class _DictCache(dict):
    def prefetch(self, keys):
        list(keys)

    def forget(self):
        pass

    def flush(self):
        pass


class _NullConn:
    executed: list[str] = []

    def execute(self, sql, *a):
        _NullConn.executed.append(sql)

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


class RecordingEmbedder(FakeEmbedder):
    def __init__(self):
        self.calls = []

    def embed(self, texts):
        self.calls.append(len(texts))
        return super().embed(texts)


NoGeocoder = FakeGeocoder


def test_rows_are_built_and_embedded_in_batches_while_staging(monkeypatch):
    fake = FakeDb()
    fake.install(monkeypatch)
    embedder = RecordingEmbedder()
    monkeypatch.setattr(cli, "make_embedder", lambda name: embedder)
    monkeypatch.setattr(cli, "Geocoder", NoGeocoder)
    monkeypatch.setattr(cli, "EMBED_BATCH", 3)
    seen = {}

    def stage(conn, run_id, rna, osm):
        # The writer gets lazy iterators, never materialised lists of rows/vectors.
        assert isinstance(rna, Iterator) and not isinstance(rna, (list, tuple))
        assert isinstance(osm, Iterator) and not isinstance(osm, (list, tuple))
        assert embedder.calls == []  # nothing embedded before the writer pulls rows
        seen["rna"] = [len(r.embedding) for r in rna]
        seen["osm"] = [len(o.embedding) for o in osm]

    monkeypatch.setattr(cli.db, "stage", stage)
    assert cli.main(args("--osm-geojsonseq", OSM)) == 0
    assert seen["rna"] == [384] * 8 and seen["osm"] == [384] * 4
    assert embedder.calls and max(embedder.calls) <= 3
    assert sum(embedder.calls) == 12 and 8 not in embedder.calls


def test_another_import_running_exits_without_a_run(monkeypatch, capsys):
    fake = FakeDb()
    fake.install(monkeypatch)

    def busy(conn, scope):
        raise db.ImportAlreadyRunning("another import is running")

    monkeypatch.setattr(cli.db, "start_run", busy)
    assert cli.main(args("--skip-osm")) == 1
    assert failures(fake) == []


def test_volume_drop_aborts_unless_allowed(monkeypatch):
    fake = FakeDb()
    fake.install(monkeypatch)
    monkeypatch.setattr(cli, "Geocoder", NoGeocoder)
    monkeypatch.setattr(cli.db, "existing_counts", lambda conn, scope: (1000, 0))
    assert cli.main(args("--skip-osm")) == 1
    (fail,) = failures(fake)
    assert "--allow-large-drop" in fail[2]
    assert "stage" not in fake.calls
    assert cli.main(args("--skip-osm", "--allow-large-drop")) == 0
    assert "apply" in fake.calls


def test_vector_text_from_float32_row_round_trips():
    import numpy as np

    row = np.array([0.1, -1 / 3, 1e-8], dtype=np.float32)
    text = db._vector(row)
    assert text.startswith("[") and text.endswith("]")
    assert np.array_equal(np.array(text[1:-1].split(","), dtype=np.float32), row)


def test_connection_disables_statement_timeout(monkeypatch):
    fake = FakeDb()
    fake.install(monkeypatch)
    _NullConn.executed.clear()
    cli.main(args("--skip-osm"))
    assert _NullConn.executed[0] == "SET statement_timeout = 0"


def _osm_line(fid, lon, lat, name, **props):
    import json

    return json.dumps({"type": "Feature", "id": fid, "geometry": {"type": "Point", "coordinates": [lon, lat]},
                       "properties": {"club": "sport", "name": name, **props}})


def _osm_file(tmp_path, paris=0):
    """The Lyon fixture plus `paris` features in Paris."""
    path = tmp_path / "clubs.geojsonseq"
    lines = Path(OSM).read_text(encoding="utf-8").splitlines()
    lines += [_osm_line(f"n9{i:03d}", 2.35, 48.86, f"Club parisien {i}") for i in range(paris)]
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return str(path)


def _capture_stage(monkeypatch):
    staged = {}
    monkeypatch.setattr(cli.db, "stage",
                        lambda conn, run_id, rna, osm: staged.update(rna=list(rna), osm=list(osm)))
    return staged


def test_zero_osm_records_fail_the_run(monkeypatch, tmp_path):
    fake = FakeDb()
    fake.install(monkeypatch)
    empty = tmp_path / "empty.geojsonseq"
    empty.write_text("", encoding="utf-8")
    assert cli.main(args("--osm-geojsonseq", str(empty))) == 1
    (fail,) = failures(fake)
    assert "OsmSourceError" in fail[2] and "0 OSM records" in fail[2]
    assert "stage" not in fake.calls


def test_scope_without_osm_features_is_not_an_empty_export(monkeypatch):
    # Guadeloupe: the RNA has it, the (metropolitan) OSM extract does not.
    fake = FakeDb()
    fake.install(monkeypatch)
    staged = _capture_stage(monkeypatch)
    assert cli.main(["run", "--db-url", "postgresql://x", "--departements", "971", "--rna-zip", RNA,
                     "--embedder", "fake", "--osm-geojsonseq", OSM]) == 0
    assert [r.rna_id for r in staged["rna"]] == ["W971000001"] and staged["osm"] == []


def test_departement_without_rna_records_fails_before_geocoding(monkeypatch):
    fake = FakeDb()
    fake.install(monkeypatch)
    FakeGeocoder.instances.clear()
    assert cli.main(["run", "--db-url", "postgresql://x", "--departements", "69,13,20", "--rna-zip", RNA,
                     "--embedder", "fake", "--skip-osm"]) == 1
    (fail,) = failures(fake)
    assert "13, 20" in fail[2] and "69" not in fail[2]
    assert all(g.geocoded == 0 for g in FakeGeocoder.instances)
    assert "stage" not in fake.calls


def test_corsica_scope(monkeypatch):
    fake = FakeDb()
    fake.install(monkeypatch)
    staged = _capture_stage(monkeypatch)
    assert cli.main(["run", "--db-url", "postgresql://x", "--departements", "2a", "--rna-zip", RNA,
                     "--embedder", "fake", "--skip-osm"]) == 0
    assert [r.insee_code for r in staged["rna"]] == ["2A004"]
    assert ("start", ["2A"]) in fake.calls


def test_osm_is_filtered_to_the_scope_before_embedding(monkeypatch, tmp_path):
    fake = FakeDb()
    fake.install(monkeypatch)
    embedder = RecordingEmbedder()
    monkeypatch.setattr(cli, "make_embedder", lambda name: embedder)
    staged = _capture_stage(monkeypatch)
    assert cli.main(args("--osm-geojsonseq", _osm_file(tmp_path, paris=3))) == 0
    assert len(staged["osm"]) == 4
    assert not [o for o in staged["osm"] if "parisien" in o.name]
    assert sum(embedder.calls) == 8 + 4


def test_full_france_run_stages_all_osm_without_loading_communes(monkeypatch, tmp_path):
    fake = FakeDb()
    fake.install(monkeypatch)
    FakeGeocoder.instances.clear()
    staged = _capture_stage(monkeypatch)
    assert cli.main(["run", "--db-url", "postgresql://x", "--rna-zip", RNA, "--embedder", "fake",
                     "--osm-geojsonseq", _osm_file(tmp_path, paris=3)]) == 0
    assert len(staged["osm"]) == 7
    assert all(g.communes_loaded == 0 for g in FakeGeocoder.instances)


def test_osm_volume_check_compares_in_scope_counts(monkeypatch, tmp_path):
    fake = FakeDb()
    fake.install(monkeypatch)
    monkeypatch.setattr(cli.db, "VOLUME_MIN_EXISTING", 5)
    monkeypatch.setattr(cli.db, "existing_counts", lambda conn, scope: (0, 6))
    # 4 features in 69 (plus 10 in Paris): 4 < 80 % of the 6 existing in 69.
    assert cli.main(args("--osm-geojsonseq", _osm_file(tmp_path, paris=10))) == 1
    (fail,) = failures(fake)
    assert "OSM: read 4 records" in fail[2]


def test_departement_volume_problems():
    existing = {"69": 1000, "75": 1000, "01": 99}
    assert db.departement_volume_problems({"69": 800, "75": 900}, existing) == []
    problems = db.departement_volume_problems({"69": 799, "75": 900}, existing)
    assert len(problems) == 1 and "69" in problems[0] and "799" in problems[0] and "1000" in problems[0]
    # a département the file no longer has at all
    assert "75" in db.departement_volume_problems({"69": 1000}, existing)[0]


def test_full_france_run_checks_volume_per_departement(monkeypatch):
    fake = FakeDb()
    fake.install(monkeypatch)
    # Nationally 11 read vs 10 existing is fine, but Paris dropped from 200 listings to 1 record.
    monkeypatch.setattr(cli.db, "existing_counts", lambda conn, scope: (10, 0))
    monkeypatch.setattr(cli.db, "existing_rna_by_departement", lambda conn, scope: {"75": 200, "69": 8})
    base = ["run", "--db-url", "postgresql://x", "--rna-zip", RNA, "--embedder", "fake", "--skip-osm"]
    assert cli.main(base) == 1
    (fail,) = failures(fake)
    assert "75" in fail[2] and "--allow-large-drop" in fail[2]
    assert "stage" not in fake.calls
    assert cli.main(base + ["--allow-large-drop"]) == 0


class _CopyRecorder:
    def __init__(self):
        self.copies = []

    def cursor(self):
        return self

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def copy(self, sql):
        rows = []
        self.copies.append((sql, rows))

        class _Copy:
            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

            def write_row(self, row):
                rows.append(row)

        return _Copy()


def _columns(sql):
    return sql[sql.index("(") + 1:sql.index(")")].replace(" ", "").split(",")


def test_stage_writes_town_and_osm_likely_not_public():
    conn = _CopyRecorder()
    rna = StagedRna(rna_id="W1", name="Club", purpose=None, address="1 rue X", postcode="69001",
                    insee_code="69123", city="Lyon 1er", website=None, published_on=None, location=None,
                    likely_not_public=False, embedding_hash="h")
    osm = StagedOsm(osm_id="node/1", name="Salle privée", lon=4.8, lat=45.7, website=None, phone=None,
                    email=None, opening_hours=None, kind="club=sport", likely_not_public=True,
                    embedding_hash="h")
    db.stage(conn, uuid4(), [rna], [osm])
    (rna_sql, rna_rows), (osm_sql, osm_rows) = conn.copies
    row = dict(zip(_columns(rna_sql), rna_rows[0], strict=True))
    assert row["postcode"] == "69001" and row["city"] == "Lyon 1er"
    assert dict(zip(_columns(osm_sql), osm_rows[0], strict=True))["likely_not_public"] is True
