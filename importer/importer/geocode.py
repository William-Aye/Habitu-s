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
RETRYABLE_STATUS = {408, 429}  # plus every 5xx
# Backoff schedule is 2/4/8 s, but with 3 attempts only the first two waits
# (2 s, 4 s) ever happen: no wait follows the final attempt.
BACKOFF_SECONDS = (2, 4, 8)


class GeocodeError(RuntimeError):
    """Commune centres could not be loaded; the run must abort."""


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
        communes: dict[str, GeoPoint] | None = None,
    ):
        self.client = client
        self.cache = cache
        self.batch_size = batch_size
        self.min_score = min_score
        self.sleep = sleep
        self._communes: dict[str, GeoPoint] | None = communes

    def _request(self, method: str, url: str, **kw) -> httpx.Response | None:
        """Up to MAX_ATTEMPTS tries; retry on network errors, 5xx, 408, 429.

        Returns the 2xx response, or None when retries are exhausted or the
        status is not retryable.
        """
        for attempt in range(MAX_ATTEMPTS):
            try:
                resp = self.client.request(method, url, **kw)
                if resp.is_success:
                    return resp
                if resp.status_code not in RETRYABLE_STATUS and resp.status_code < 500:
                    log.warning("%s %s -> %s (not retryable)", method, url, resp.status_code)
                    return None
                log.warning("%s -> %s, attempt %d", url, resp.status_code, attempt + 1)
            except httpx.TransportError as e:
                log.warning("%s network error %s, attempt %d", url, e, attempt + 1)
            if attempt < MAX_ATTEMPTS - 1:
                self.sleep(BACKOFF_SECONDS[attempt])
        return None

    # -- commune centres (lazy, cached on the instance) --
    def communes(self) -> dict[str, GeoPoint]:
        """INSEE code -> commune centre, downloaded once. Raises GeocodeError."""
        if self._communes is None:
            resp = self._request("GET", COMMUNES_URL, timeout=120)
            if resp is None:
                raise GeocodeError("could not load commune centres")
            communes: dict[str, GeoPoint] = {}
            for c in resp.json():
                try:
                    lon, lat = c["centre"]["coordinates"]
                    communes[c["code"]] = GeoPoint(float(lon), float(lat), "municipality")
                except (KeyError, TypeError, ValueError):
                    continue
            self._communes = communes
        return self._communes

    def _commune_centre(self, insee_code: str | None) -> GeoPoint | None:
        if not insee_code:
            return None
        return self.communes().get(insee_code)

    def _post_batch(
        self, rows: list[tuple[str, RnaRecord]]
    ) -> dict[str, GeoPoint | None] | None:
        """key -> address GeoPoint (None if not found / low score) for every row
        present in a successful response; None if the batch failed."""
        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerow(["key", "address", "postcode", "citycode"])
        for key, r in rows:
            w.writerow([key, r.address or "", r.postcode or "", r.insee_code or ""])
        files = {"data": ("addresses.csv", buf.getvalue().encode("utf-8"), "text/csv")}
        form = {"columns": "address", "postcode": "postcode", "citycode": "citycode"}
        resp = self._request("POST", GEOCODER_CSV_URL, files=files, data=form, timeout=300)
        if resp is None:
            return None
        try:
            return self._parse(resp.content.decode("utf-8-sig"))
        except (UnicodeDecodeError, csv.Error):
            log.warning("unparseable geocoder response")
            return None

    def _parse(self, text: str) -> dict[str, GeoPoint | None]:
        out: dict[str, GeoPoint | None] = {}
        for row in csv.DictReader(io.StringIO(text)):
            key = row.get("key")
            if key is None:
                continue
            try:
                score = float(row.get("result_score") or "")
                lat = float(row["latitude"])
                lon = float(row["longitude"])
            except (KeyError, TypeError, ValueError):
                out[key] = None  # answered, but not found
                continue
            out[key] = GeoPoint(lon, lat, "address") if score >= self.min_score else None
        return out

    def geocode(self, records: list[RnaRecord]) -> dict[str, GeoPoint | None]:
        pending: dict[str, RnaRecord] = {}
        keys: dict[str, str] = {}
        resolved: dict[str, GeoPoint | None] = {}
        for r in records:
            k = address_key(r)
            keys[r.rna_id] = k
            if k in resolved or k in pending:
                continue
            if k in self.cache:
                resolved[k] = self.cache[k]
            elif r.address and r.address.strip():
                pending[k] = r
            else:
                # no address: direct commune fallback, no geocoder call; cacheable
                resolved[k] = self.cache[k] = self._commune_centre(r.insee_code)

        items = list(pending.items())
        for i in range(0, len(items), self.batch_size):
            batch = items[i : i + self.batch_size]
            answers = self._post_batch(batch)
            for k, r in batch:
                point = (answers or {}).get(k) or self._commune_centre(r.insee_code)
                resolved[k] = point
                # only real geocoder answers are cached, never failure fallbacks
                if answers is not None and k in answers:
                    self.cache[k] = point

        return {r.rna_id: resolved[keys[r.rna_id]] for r in records}
