from importer.models import GeoPoint
from importer.place import CommuneIndex


def P(lon, lat):
    return GeoPoint(lon, lat, "municipality")


COMMUNES = {
    "69123": P(4.835, 45.758),   # Lyon
    "69266": P(4.880, 45.771),   # Villeurbanne
    "75056": P(2.352, 48.857),   # Paris
    "2A004": P(8.737, 41.927),   # Ajaccio
    "97105": P(-61.726, 15.998), # Basse-Terre
    "01053": P(5.225, 46.205),   # Bourg-en-Bresse
}


def test_nearest_commune_and_departement():
    idx = CommuneIndex(COMMUNES)
    assert idx.nearest(4.836, 45.759) == "69123"
    assert idx.nearest(4.875, 45.770) == "69266"
    assert idx.departement(2.30, 48.87) == "75"
    assert idx.departement(8.70, 41.95) == "2A"
    assert idx.departement(-61.7, 16.0) == "971"


def test_nearest_beyond_the_first_grid_rings():
    # Bourg-en-Bresse is ~0.6 degrees from this point; no other commune is closer.
    idx = CommuneIndex(COMMUNES)
    assert idx.departement(5.3, 46.8) == "01"


def test_a_closer_commune_in_a_neighbouring_cell_wins():
    idx = CommuneIndex({"A0001": P(0.099, 0.0), "B0001": P(0.0, 0.199)})
    # (0.101, 0.0) sits in another 0.1-degree cell than A, but A is far closer than B.
    assert idx.nearest(0.101, 0.0) == "A0001"


def test_empty_index_and_far_points():
    assert CommuneIndex({}).nearest(4.8, 45.7) is None
    assert CommuneIndex(COMMUNES).nearest(150.0, -30.0) is None
