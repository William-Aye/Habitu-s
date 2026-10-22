import csv
import io
import logging
import os
import time
from collections.abc import Callable, MutableMapping

import httpx

from importer.models import GeoPoint, RnaRecord

log = logging.getLogger(__name__)

GEOCODER_CSV_URL = os.environ.get(
    "GEOCODER_CSV_URL", "https://data.geopf.fr/geocodage/search/csv"
)
COMMUNES_URL = (
    "https://geo.api.gouv.fr/communes?fields=code,centre&format=json&geometry=centre"
)

MAX_ATTEMPTS = 3
BACKOFF_SECONDS = (2, 4, 8)  # waits between attempts: 2 then 4 (a 3rd attempt is last)


def address_key(rec: RnaRecord) -> str:
    parts = (rec.address, rec.postcode, rec.insee_code)
    return "|".join(" ".join((p or "").lower().split()) for p in parts)


class Geocoder:
    def __init__(
        self,
        client: httpx.Client,
        cache: MutableMapping[str, GeoPoint | None],
        batch_size: int = 5000,
        min_score: float = 0.4,
        sleep: Callable[[float], None] = time.sleep,
    ):
        self.client = client
        self.cache = cache
        self.batch_size = batch_size
        self.min_score = min_score
        self.sleep = sleep
        self._communes: dict[str, GeoPoint] | None = None

    # -- commune centres (lazy, cached on the instance) --
    def _commune_centre(self, insee_code: str | None) -> GeoPoint | None:
        if not insee_code:
            return None
        if self._communes is None:
            resp = self.client.get(COMMUNES_URL, timeout=120)
            resp.raise_for_status()
            communes: dict[str, GeoPoint] = {}
            for c in resp.json():
                try:
                    lon, lat = c["centre"]["coordinates"]
                    communes[c["code"]] = GeoPoint(float(lon), float(lat), "municipality")
                except (KeyError, TypeError, ValueError):
                    continue
            self._communes = communes
        return self._communes.get(insee_code)

    # -- geocoder batches --
    def _post_batch(self, rows: list[tuple[str, RnaRecord]]) -> dict[str, GeoPoint] | None:
        """Return key -> address GeoPoint for rows that scored well, or None on failure."""
        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerow(["key", "address", "postcode", "citycode"])
        for key, r in rows:
            w.writerow([key, r.address or "", r.postcode or "", r.insee_code or ""])
        files = {"data": ("addresses.csv", buf.getvalue().encode("utf-8"), "text/csv")}
        form = {"columns": "address", "postcode": "postcode", "citycode": "citycode"}

        for attempt in range(MAX_ATTEMPTS):
            try:
                resp = self.client.post(GEOCODER_CSV_URL, files=files, data=form, timeout=300)
                if resp.status_code < 500:
                    resp.raise_for_status()
                    return self._parse(resp.text)
                log.warning("geocoder 5xx (%s), attempt %d", resp.status_code, attempt + 1)
            except httpx.TransportError as e:
                log.warning("geocoder network error %s, attempt %d", e, attempt + 1)
            except httpx.HTTPStatusError as e:
                log.warning("geocoder error %s; falling back to communes", e)
                return None
            if attempt < MAX_ATTEMPTS - 1:
                self.sleep(BACKOFF_SECONDS[attempt])
        return None

    def _parse(self, text: str) -> dict[str, GeoPoint]:
        out: dict[str, GeoPoint] = {}
        for row in csv.DictReader(io.StringIO(text)):
            try:
                score = float(row.get("result_score") or "")
                lat = float(row["latitude"])
                lon = float(row["longitude"])
            except (KeyError, TypeError, ValueError):
                continue
            if score >= self.min_score:
                out[row["key"]] = GeoPoint(lon, lat, "address")
        return out

    def geocode(self, records: list[RnaRecord]) -> dict[str, GeoPoint | None]:
        # misses with an address, de-duplicated by key
        pending: dict[str, RnaRecord] = {}
        keys: dict[str, str] = {}
        for r in records:
            k = address_key(r)
            keys[r.rna_id] = k
            if k in self.cache or k in pending:
                continue
            if r.address and r.address.strip():
                pending[k] = r
            else:
                self.cache[k] = self._commune_centre(r.insee_code)

        items = list(pending.items())
        for i in range(0, len(items), self.batch_size):
            batch = items[i : i + self.batch_size]
            hits = self._post_batch(batch) or {}
            for k, r in batch:
                self.cache[k] = hits.get(k) or self._commune_centre(r.insee_code)

        return {r.rna_id: self.cache[keys[r.rna_id]] for r in records}
