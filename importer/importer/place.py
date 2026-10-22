"""Nearest commune centre for a point, to give OSM features a département before staging."""
import math
from collections import defaultdict

from importer.models import GeoPoint
from importer.rna import departement

CELL_DEGREES = 0.1
# Search at most this many rings of cells around the point (~1 degree): a point farther than
# that from every commune centre is outside France (or in a département the list lacks).
MAX_RINGS = 10


def _cell(lon: float, lat: float) -> tuple[int, int]:
    return math.floor(lon / CELL_DEGREES), math.floor(lat / CELL_DEGREES)


def _dist2(lon1: float, lat1: float, lon2: float, lat2: float) -> float:
    """Squared equirectangular distance in degrees of latitude (fine for nearest-neighbour)."""
    k = math.cos(math.radians((lat1 + lat2) / 2))
    return ((lon1 - lon2) * k) ** 2 + (lat1 - lat2) ** 2


class CommuneIndex:
    """Grid bucket index over commune centres (INSEE code -> point)."""

    def __init__(self, communes: dict[str, GeoPoint]):
        self._cells: dict[tuple[int, int], list[tuple[str, float, float]]] = defaultdict(list)
        for code, p in communes.items():
            self._cells[_cell(p.lon, p.lat)].append((code, p.lon, p.lat))

    def nearest(self, lon: float, lat: float) -> str | None:
        cx, cy = _cell(lon, lat)
        best: tuple[float, str] | None = None
        for ring in range(MAX_RINGS + 1):
            # A centre not yet seen lies in this ring or beyond: at least (ring - 1) cells away in
            # latitude or longitude (longitude scaled by cos(lat), taken at its smallest). Stop
            # once that lower bound exceeds the best distance found.
            if best is not None:
                min_lat_gap = (ring - 1) * CELL_DEGREES
                min_gap = min_lat_gap * min(1.0, math.cos(math.radians(abs(lat) + ring * CELL_DEGREES)))
                if min_gap > 0 and min_gap * min_gap > best[0]:
                    break
            for x in range(cx - ring, cx + ring + 1):
                for y in range(cy - ring, cy + ring + 1):
                    if max(abs(x - cx), abs(y - cy)) != ring:
                        continue
                    for code, plon, plat in self._cells.get((x, y), ()):
                        d = _dist2(lon, lat, plon, plat)
                        if best is None or (d, code) < best:
                            best = (d, code)
        return None if best is None else best[1]

    def departement(self, lon: float, lat: float) -> str | None:
        return departement(self.nearest(lon, lat))
