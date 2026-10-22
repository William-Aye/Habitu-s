import csv
import io

import httpx
import respx

from importer.geocode import (
    COMMUNES_URL,
    GEOCODER_CSV_URL,
    Geocoder,
    address_key,
)
from importer.models import GeoPoint, RnaRecord

COMMUNES = [
    {"code": "69123", "centre": {"coordinates": [4.83, 45.76]}},
    {"code": "75056", "centre": {"coordinates": [2.35, 48.85]}},
]


def rec(i, address="1 rue de la Paix", postcode="69001", insee="69123"):
    return RnaRecord(
        rna_id=f"W{i:09d}", name="Asso", purpose=None, address=address,
        postcode=postcode, insee_code=insee, city="Lyon", website=None,
        published_on=None,
    )


def csv_response(score, lat="45.1", lon="5.2"):
    def handler(request):
        body = request.content.decode("utf-8")
        # the uploaded CSV is embedded in the multipart body
        start = body.index("key,address,postcode,citycode")
        end = body.index("\r\n--", start)
        rows = list(csv.DictReader(io.StringIO(body[start:end])))
        out = io.StringIO()
        w = csv.writer(out)
        w.writerow(["key", "address", "postcode", "citycode",
                    "latitude", "longitude", "result_score"])
        for r in rows:
            w.writerow([r["key"], r["address"], r["postcode"], r["citycode"],
                        lat, lon, score])
        return httpx.Response(200, text=out.getvalue())
    return handler


def make(cache=None, **kw):
    sleeps = []
    g = Geocoder(httpx.Client(), {} if cache is None else cache,
                 sleep=sleeps.append, **kw)
    return g, sleeps


@respx.mock
def test_address_hit():
    respx.get(COMMUNES_URL).respond(json=COMMUNES)
    respx.post(GEOCODER_CSV_URL).mock(side_effect=csv_response("0.8"))
    g, _ = make()
    r = rec(1)
    assert g.geocode([r])[r.rna_id] == GeoPoint(5.2, 45.1, "address")


@respx.mock
def test_low_score_falls_back_to_commune():
    respx.get(COMMUNES_URL).respond(json=COMMUNES)
    respx.post(GEOCODER_CSV_URL).mock(side_effect=csv_response("0.2"))
    g, _ = make()
    r = rec(1)
    assert g.geocode([r])[r.rna_id] == GeoPoint(4.83, 45.76, "municipality")


@respx.mock
def test_no_address_uses_commune_without_geocoder_call():
    respx.get(COMMUNES_URL).respond(json=COMMUNES)
    route = respx.post(GEOCODER_CSV_URL).mock(side_effect=csv_response("0.9"))
    g, _ = make()
    r = rec(1, address=None)
    assert g.geocode([r])[r.rna_id] == GeoPoint(4.83, 45.76, "municipality")
    assert route.call_count == 0


@respx.mock
def test_unknown_commune_gives_none_and_is_cached():
    respx.get(COMMUNES_URL).respond(json=COMMUNES)
    cache = {}
    g, _ = make(cache)
    r = rec(1, address=None, insee="99999")
    assert g.geocode([r])[r.rna_id] is None
    assert cache[address_key(r)] is None


@respx.mock
def test_cache_hit_makes_no_http_call():
    communes = respx.get(COMMUNES_URL).respond(json=COMMUNES)
    route = respx.post(GEOCODER_CSV_URL).mock(side_effect=csv_response("0.9"))
    r = rec(1)
    p = GeoPoint(1.0, 2.0, "address")
    g, _ = make({address_key(r): p})
    assert g.geocode([r])[r.rna_id] == p
    assert route.call_count == 0
    assert communes.call_count == 0


@respx.mock
def test_server_errors_retry_three_times_then_commune_fallback():
    respx.get(COMMUNES_URL).respond(json=COMMUNES)
    route = respx.post(GEOCODER_CSV_URL).respond(500)
    g, sleeps = make()
    r = rec(1)
    assert g.geocode([r])[r.rna_id] == GeoPoint(4.83, 45.76, "municipality")
    assert route.call_count == 3
    assert sleeps == [2, 4]


@respx.mock
def test_network_error_falls_back():
    respx.get(COMMUNES_URL).respond(json=COMMUNES)
    route = respx.post(GEOCODER_CSV_URL).mock(
        side_effect=httpx.ConnectError("boom"))
    g, _ = make()
    r = rec(1)
    assert g.geocode([r])[r.rna_id].precision == "municipality"
    assert route.call_count == 3


@respx.mock
def test_batch_splitting():
    respx.get(COMMUNES_URL).respond(json=COMMUNES)
    route = respx.post(GEOCODER_CSV_URL).mock(side_effect=csv_response("0.9"))
    g, _ = make(batch_size=5)
    recs = [rec(i, address=f"{i} rue X") for i in range(12)]
    out = g.geocode(recs)
    assert route.call_count == 3
    assert len(out) == 12
    assert all(p.precision == "address" for p in out.values())


@respx.mock
def test_results_stored_in_cache_and_identical_addresses_deduped():
    respx.get(COMMUNES_URL).respond(json=COMMUNES)
    route = respx.post(GEOCODER_CSV_URL).mock(side_effect=csv_response("0.9"))
    cache = {}
    g, _ = make(cache)
    a, b = rec(1), rec(2)
    out = g.geocode([a, b])
    assert out[a.rna_id] == out[b.rna_id]
    assert cache[address_key(a)] == GeoPoint(5.2, 45.1, "address")
    assert route.call_count == 1


def test_address_key_normalises():
    r = rec(1, address="  1  Rue  DE la Paix ")
    assert address_key(r) == "1 rue de la paix|69001|69123"
    assert address_key(rec(1, address=None, postcode=None, insee=None)) == "||"
