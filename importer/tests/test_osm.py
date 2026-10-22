from pathlib import Path

import pytest

import json

from importer.osm import OSMIUM_FILTER, OsmSourceError, read_osm_geojsonseq

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


def _feature(fid, geometry, **props):
    return json.dumps({"type": "Feature", "id": fid, "geometry": geometry, "properties": props})


POINT = {"type": "Point", "coordinates": [4.8, 45.7]}


def _write(path, lines):
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def test_multipolygon_uses_first_polygon_outer_ring(tmp_path):
    path = tmp_path / "mp.geojsonseq"
    geom = {
        "type": "MultiPolygon",
        "coordinates": [
            [[[4.0, 45.0], [4.2, 45.0], [4.2, 45.2], [4.0, 45.2], [4.0, 45.0]]],
            [[[9.0, 40.0], [9.2, 40.0], [9.2, 40.2], [9.0, 40.2], [9.0, 40.0]]],
        ],
    }
    _write(path, [_feature("w1", geom, name="Multi Club", leisure="sports_centre")])
    (rec,) = read_osm_geojsonseq(path)
    assert rec.lon == pytest.approx(4.1, abs=1e-6)
    assert rec.lat == pytest.approx(45.1, abs=1e-6)


def test_contact_website_and_email_fallbacks(tmp_path):
    path = tmp_path / "contact.geojsonseq"
    _write(path, [_feature(
        "n5", POINT, name="Fallback Club", club="sport",
        **{"contact:website": "https://fallback.example", "contact:email": "hi@fallback.example"},
    )])
    (rec,) = read_osm_geojsonseq(path)
    assert rec.website == "https://fallback.example"
    assert rec.email == "hi@fallback.example"


def test_malformed_line_is_skipped_with_warning(tmp_path, capsys):
    path = tmp_path / "bad.geojsonseq"
    _write(path, [
        _feature("n1", POINT, name="First", club="sport"),
        '{"type": "Feature", "id": "n2", "geometry": ',  # truncated JSON
        _feature("n3", POINT, name="Third", club="sport"),
    ])
    out = list(read_osm_geojsonseq(path))
    assert [r.name for r in out] == ["First", "Third"]
    err = capsys.readouterr().err
    assert "line 2" in err


def test_empty_polygon_coordinates_are_skipped(tmp_path, capsys):
    path = tmp_path / "empty.geojsonseq"
    _write(path, [
        _feature("w9", {"type": "Polygon", "coordinates": []}, name="Empty Gym", leisure="sports_centre"),
        _feature("n1", POINT, name="Good", club="sport"),
    ])
    out = list(read_osm_geojsonseq(path))
    assert [r.name for r in out] == ["Good"]
    assert "line 1" in capsys.readouterr().err


def test_too_many_bad_lines_raise_source_error(tmp_path, capsys):
    path = tmp_path / "truncated.geojsonseq"
    lines = [_feature(f"n{i}", POINT, name=f"Club {i}", club="sport") for i in range(10)]
    lines += ["{not json"] * 150
    _write(path, lines)
    with pytest.raises(OsmSourceError):
        list(read_osm_geojsonseq(path))


def test_feature_without_id_is_a_bad_line(tmp_path, capsys):
    path = tmp_path / "noid.geojsonseq"
    no_id = json.dumps({"type": "Feature", "geometry": POINT, "properties": {"name": "No Id", "club": "sport"}})
    _write(path, [_feature("n1", POINT, name="First", club="sport"), no_id])
    assert [r.name for r in read_osm_geojsonseq(path)] == ["First"]
    err = capsys.readouterr().err
    assert "line 2" in err and "id" in err


def test_export_without_ids_raises_source_error(tmp_path):
    # `osmium export` without `-a type,id` (or --add-unique-id) writes no ids at all.
    path = tmp_path / "noids.geojsonseq"
    _write(path, [json.dumps({"type": "Feature", "geometry": POINT,
                              "properties": {"name": f"Club {i}", "club": "sport"}}) for i in range(150)])
    with pytest.raises(OsmSourceError):
        list(read_osm_geojsonseq(path))


def test_osmium_attribute_ids_are_read(tmp_path):
    # `osmium export -a type,id` writes "@type"/"@id" properties.
    path = tmp_path / "attrs.geojsonseq"
    _write(path, [json.dumps({"type": "Feature", "geometry": POINT,
                              "properties": {"@type": "way", "@id": 77, "name": "Gym", "leisure": "sports_hall"}})])
    (rec,) = read_osm_geojsonseq(path)
    assert rec.osm_id == "way/77"


def test_docstring_export_command_writes_ids():
    import importer.osm as osm

    assert "-a type,id" in osm.__doc__
    workflow = Path(__file__).parents[2] / ".github" / "workflows" / "import.yml"
    assert "-a type,id" in workflow.read_text(encoding="utf-8")
