import csv
import io

import httpx
import respx

from importer.geocode import (
    COMMUNES_URL,
    GeocodeError,
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


@respx.mock
def test_failed_batch_is_not_cached():
    respx.get(COMMUNES_URL).respond(json=COMMUNES)
    respx.post(GEOCODER_CSV_URL).respond(500)
    cache = {}
    g, _ = make(cache)
    r = rec(1)
    assert g.geocode([r])[r.rna_id].precision == "municipality"
    assert address_key(r) not in cache


@respx.mock
def test_missing_row_in_2xx_not_cached():
    respx.get(COMMUNES_URL).respond(json=COMMUNES)

    def partial(request):
        return httpx.Response(200, text=(
            "key,address,postcode,citycode,latitude,longitude,result_score\n"
            "1 rue a|69001|69123,1 rue a,69001,69123,45.1,5.2,0.9\n"))
    respx.post(GEOCODER_CSV_URL).mock(side_effect=partial)
    cache = {}
    g, _ = make(cache)
    a, b = rec(1, address="1 rue A"), rec(2, address="2 rue B")
    out = g.geocode([a, b])
    assert out[a.rna_id].precision == "address"
    assert out[b.rna_id].precision == "municipality"
    assert address_key(a) in cache and address_key(b) not in cache


@respx.mock
def test_low_score_is_cached():
    respx.get(COMMUNES_URL).respond(json=COMMUNES)
    respx.post(GEOCODER_CSV_URL).mock(side_effect=csv_response("0.1"))
    cache = {}
    g, _ = make(cache)
    r = rec(1)
    g.geocode([r])
    assert address_key(r) in cache


@respx.mock
def test_commune_get_retries_then_succeeds():
    route = respx.get(COMMUNES_URL).mock(side_effect=[
        httpx.Response(500), httpx.Response(200, json=COMMUNES)])
    g, sleeps = make()
    r = rec(1, address=None)
    assert g.geocode([r])[r.rna_id].precision == "municipality"
    assert route.call_count == 2 and sleeps == [2]


@respx.mock
def test_commune_get_fails_raises():
    route = respx.get(COMMUNES_URL).respond(503)
    g, sleeps = make()
    try:
        g.geocode([rec(1, address=None)])
        assert False, "expected GeocodeError"
    except GeocodeError:
        pass
    assert route.call_count == 3 and sleeps == [2, 4]


@respx.mock
def test_429_then_200():
    respx.get(COMMUNES_URL).respond(json=COMMUNES)
    route = respx.post(GEOCODER_CSV_URL).mock(
        side_effect=[httpx.Response(429), csv_response("0.9")])
    g, sleeps = make()
    r = rec(1)
    assert g.geocode([r])[r.rna_id].precision == "address"
    assert route.call_count == 2 and sleeps == [2]


@respx.mock
def test_multipart_form_fields():
    respx.get(COMMUNES_URL).respond(json=COMMUNES)
    route = respx.post(GEOCODER_CSV_URL).mock(side_effect=csv_response("0.9"))
    g, _ = make()
    g.geocode([rec(1)])
    body = route.calls[0].request.content.decode()
    for name, val in [("columns", "address"), ("postcode", "postcode"),
                      ("citycode", "citycode")]:
        assert f'name="{name}"\r\n\r\n{val}\r\n' in body
    assert 'name="data"' in body


@respx.mock
def test_response_with_utf8_bom_is_parsed():
    def handler(request):
        text = csv_response("0.9")(request).text
        return httpx.Response(200, content=b"\xef\xbb\xbf" + text.encode("utf-8"))

    respx.get(COMMUNES_URL).respond(json=COMMUNES)
    respx.post(GEOCODER_CSV_URL).mock(side_effect=handler)
    g, _ = make()
    r = rec(1)
    assert g.geocode([r])[r.rna_id] == GeoPoint(5.2, 45.1, "address")


@respx.mock
def test_communes_are_public_and_loaded_once():
    route = respx.get(COMMUNES_URL).respond(json=COMMUNES)
    g, _ = make()
    assert g.communes()["75056"] == GeoPoint(2.35, 48.85, "municipality")
    g.communes()
    assert route.call_count == 1


def test_preloaded_communes_skip_the_download():
    g = Geocoder(httpx.Client(), {}, communes={"69123": GeoPoint(4.83, 45.76, "municipality")})
    assert g.communes()["69123"].lon == 4.83
