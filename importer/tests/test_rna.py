import dataclasses
import io
import zipfile
from pathlib import Path

import httpx
import pytest
import respx

from importer.models import RnaRecord
from importer.rna import (
    RNA_DATASET_API,
    REQUIRED_COLUMNS,
    RnaSourceError,
    departement,
    find_latest_rna_url,
    read_rna_zip,
)

FIX = Path(__file__).parent / "fixtures"
UTF8 = FIX / "rna_sample.csv"
CP1252 = FIX / "rna_sample_cp1252.csv"
DISSOLVED = {"W691000009", "W691000010"}


def test_reads_active_rows_and_skips_dissolved():
    recs = list(read_rna_zip(UTF8, None))
    assert len(recs) == 11
    assert not DISSOLVED & {r.rna_id for r in recs}


def test_departement_filter():
    assert len(list(read_rna_zip(UTF8, {"69"}))) == 8
    assert len(list(read_rna_zip(UTF8, {"971"}))) == 1
    assert len(list(read_rna_zip(UTF8, {"75", "69"}))) == 9


def test_corsica_departement_scope():
    (rec,) = read_rna_zip(UTF8, {"2A"})
    assert rec.insee_code == "2A004" and rec.city == "Ajaccio"
    assert departement("2A004") == "2A"
    assert departement("97105") == "971" and departement("69123") == "69" and departement(None) is None
    assert not list(r for r in read_rna_zip(UTF8, None) if r.insee_code.startswith("20"))


def test_cp1252_and_utf8_give_identical_records():
    a = list(read_rna_zip(UTF8, None))
    b = list(read_rna_zip(CP1252, None))
    assert a == b
    assert "Club d'Échecs de Lyon" in {r.name for r in a}


def test_field_mapping():
    by_id = {r.rna_id: r for r in read_rna_zip(UTF8, None)}
    go = by_id["W691000002"]
    assert go.website == "https://www.clubgo-lyon.fr"
    assert go.address == "5 place du Marché"
    assert go.published_on.isoformat() == "2021-06-01"
    assert by_id["W691000004"].address is None
    assert by_id["W691000007"].published_on is None
    assert by_id["W691000008"].published_on is None
    assert "œ" in by_id["W691000006"].purpose


def test_zip_with_bom_and_multiple_members(tmp_path):
    z = tmp_path / "rna.zip"
    with zipfile.ZipFile(z, "w") as zf:
        zf.writestr("a.csv", b"\xef\xbb\xbf" + UTF8.read_bytes())
        zf.writestr("b.csv", CP1252.read_bytes())
        zf.writestr("readme.txt", "ignored")
    recs = list(read_rna_zip(z, {"69"}))
    assert len(recs) == 16
    assert recs[0].rna_id == "W691000001"


def test_missing_column_fails_before_yielding(tmp_path):
    lines = UTF8.read_text(encoding="utf-8").splitlines()
    header = lines[0].split(";")
    i = header.index("adrs_codeinsee")
    bad = "\n".join(";".join(c for j, c in enumerate(l.split(";")) if j != i) for l in lines)
    p = tmp_path / "bad.csv"
    p.write_text(bad, encoding="utf-8")
    gen = read_rna_zip(p, None)
    with pytest.raises(RnaSourceError, match="adrs_codeinsee"):
        next(gen)


def test_empty_file_fails(tmp_path):
    p = tmp_path / "empty.csv"
    p.write_text(";".join(REQUIRED_COLUMNS) + "\n", encoding="utf-8")
    with pytest.raises(RnaSourceError):
        list(read_rna_zip(p, None))


def test_no_personal_fields():
    assert not [f.name for f in dataclasses.fields(RnaRecord) if "dir" in f.name]
    for r in read_rna_zip(UTF8, None):
        assert "M." not in dataclasses.astuple(r)


def _res(title, url, modified):
    return {"title": title, "url": url, "last_modified": modified}


@respx.mock
def test_find_latest_rna_url():
    respx.get(RNA_DATASET_API).mock(return_value=httpx.Response(200, json={"resources": [
        _res("rna_import_20261001.zip", "https://x/import.zip", "2026-10-02T00:00:00+00:00"),
        _res("rna_waldec_20260901.zip", "https://x/w0901.zip", "2026-09-02T00:00:00+00:00"),
        _res("RNA_Waldec_20261001.zip", "https://x/w1001.zip", "2026-10-02T00:00:00+00:00"),
        _res("rna_waldec_20261001.pdf", "https://x/w.pdf", "2026-11-02T00:00:00+00:00"),
    ]}))
    with httpx.Client() as c:
        assert find_latest_rna_url(c) == "https://x/w1001.zip"


@respx.mock
def test_find_latest_rna_url_none():
    respx.get(RNA_DATASET_API).mock(return_value=httpx.Response(200, json={"resources": [
        _res("rna_import_20261001.zip", "https://x/import.zip", "2026-10-02T00:00:00+00:00"),
    ]}))
    with httpx.Client() as c, pytest.raises(RnaSourceError, match="no rna_waldec resource found"):
        find_latest_rna_url(c)


def test_cp1252_undefined_bytes_are_replaced_not_fatal(tmp_path):
    # 0x81 is undefined in cp1252; a single such byte must not abort the whole run.
    data = CP1252.read_bytes().replace("Les Amis du C".encode("cp1252"), b"Les Amis du \x81C")
    p = tmp_path / "undefined.csv"
    p.write_bytes(data)
    recs = {r.rna_id: r for r in read_rna_zip(p, None)}
    assert len(recs) == 11
    assert recs["W691000006"].name == "Les Amis du �Cœur"


def test_zip_skips_directories_and_macos_metadata(tmp_path):
    z = tmp_path / "rna.zip"
    with zipfile.ZipFile(z, "w") as zf:
        zf.writestr("rna/", b"")
        zf.writestr("rna/a.csv", UTF8.read_bytes())
        zf.writestr("__MACOSX/rna/._a.csv", b"\x00\x05\x16\x07 not a csv")
        zf.writestr("rna/._b.csv", b"\x00\x05\x16\x07 not a csv")
        zf.writestr("weird.csv/", b"")
    recs = list(read_rna_zip(z, {"69"}))
    assert len(recs) == 8
