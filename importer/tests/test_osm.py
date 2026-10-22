from pathlib import Path

import pytest

from importer.osm import OSMIUM_FILTER, read_osm_geojsonseq

FIXTURE = Path(__file__).parent / "fixtures" / "osm_sample.geojsonseq"


@pytest.fixture(scope="module")
def records():
    return list(read_osm_geojsonseq(FIXTURE))


def test_reads_four_named_clubs(records):
    assert len(records) == 4
    assert [r.name for r in records] == [
        "Go Club Lyon",
        "Club de Go Lyon Sud",
        "Gymnase Jean Jaurès",
        "Maison des Associations de Villeurbanne",
    ]


def test_polygon_uses_mean_of_outer_ring_vertices(records):
    gym = next(r for r in records if r.name == "Gymnase Jean Jaurès")
    # Ring is closed (first vertex repeated); the mean is over the 4 distinct vertices.
    ring = [(4.86, 45.75), (4.862, 45.75), (4.862, 45.752), (4.86, 45.752)]
    expected_lon = sum(p[0] for p in ring) / len(ring)
    expected_lat = sum(p[1] for p in ring) / len(ring)
    assert gym.lon == pytest.approx(expected_lon, abs=1e-6)
    assert gym.lat == pytest.approx(expected_lat, abs=1e-6)
    assert gym.kind == "leisure=sports_centre"


def test_osm_id_format(records):
    by_name = {r.name: r for r in records}
    assert by_name["Go Club Lyon"].osm_id == "node/123"
    assert by_name["Gymnase Jean Jaurès"].osm_id == "way/456"
    assert by_name["Maison des Associations de Villeurbanne"].osm_id == "node/789"


def test_phone_from_contact_phone(records):
    go = next(r for r in records if r.name == "Go Club Lyon")
    assert go.phone == "+33 4 78 00 00 01"
    assert go.kind == "club=sport"


def test_point_coordinates(records):
    go = next(r for r in records if r.name == "Go Club Lyon")
    assert go.lon == pytest.approx(4.835, abs=1e-6)
    assert go.lat == pytest.approx(45.76508, abs=1e-6)


def test_amenity_kind(records):
    maison = next(r for r in records if "Villeurbanne" in r.name)
    assert maison.kind == "amenity=community_centre"


def test_rs_prefixed_lines_parse(tmp_path):
    path = tmp_path / "rs.geojsonseq"
    line = (
        '{"type":"Feature","id":"n42","geometry":{"type":"Point","coordinates":[4.8,45.7]},'
        '"properties":{"name":"Club Test","club":"sport","website":"contact.example.org",'
        '"email":"a@b.example","opening_hours":"Mo-Fr 18:00-20:00"}}'
    )
    path.write_bytes(b"\x1e" + line.encode("utf-8") + b"\n\n\x1e" + line.encode("utf-8") + b"\n")
    out = list(read_osm_geojsonseq(path))
    assert len(out) == 2
    rec = out[0]
    assert rec.osm_id == "node/42"
    assert rec.website == "https://contact.example.org"
    assert rec.email == "a@b.example"
    assert rec.opening_hours == "Mo-Fr 18:00-20:00"
    assert rec.phone is None


def test_osmium_filter_constant():
    assert OSMIUM_FILTER == [
        "nwr/club",
        "nwr/leisure=sports_centre,sports_hall,dance,fitness_centre",
        "nwr/amenity=community_centre,social_centre,arts_centre",
    ]
