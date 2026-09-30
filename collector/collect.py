"""Онлайн-сборщик данных ведомства для GitHub Actions.

Режимы:
    python collect.py live   # загруженность Матафа/Масаа, зоны Медины, закрытые ворота (каждые 5 мин)
    python collect.py map    # точки официальной карты Мекки и Медины (раз в сутки)

Переменные окружения:
    INGEST_URL     — https://<worker>/api/ingest
    INGEST_SECRET  — общий секрет с Worker
    HTTPS_PROXY    — саудовский прокси (Xray поднимает http://127.0.0.1:10809)
"""

import json
import os
import ssl
import sys
import urllib.error
import urllib.request

TAWAF_SAI_URL = "https://trasul.gph.gov.sa/haram-api/public/api/pry/TawafSaiStatus"
PRAYER_ZONES_URL = "https://eservices.alharamain.gov.sa/haram-api/api/pry/prayerLocationsStatusHaramain"
MAP_API = "https://maps.alharamain.gov.sa/api"
# Публичный ключ веб-клиента официальной карты (зашит в её JS, выдаёт анонимный токен)
MAP_CLIENT = {"Name": "PIF", "Key": "UGVuZ3VpbklOX1Blbk5hdl9QSUY="}
CAMPUSES = {"makkah": 3, "madinah": 2}
LAST_UPDATE = "1/1/2001 01:00:00 AM"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128 Safari/537.36"

# Категории карты ведомства -> наши категории
CATEGORY_MAP = {
    1: "toilet", 16: "toilet_accessible", 80: "wheelchair", 36: "wheelchair", 10: "luggage", 30: "medical",
    79: "transport", 35: "prayer_disabled", 14: "children", 11: "gate", 28: "gate", 26: "elevator",
    8: "landmark", 41: "landmark", 42: "landmark", 22: "landmark", 43: "landmark", 44: "landmark",
}

SSL_CTX = ssl.create_default_context()
SSL_CTX.check_hostname = False
SSL_CTX.verify_mode = ssl.CERT_NONE  # у серверов ведомства неполная цепочка сертификатов

PROXY = os.environ.get("HTTPS_PROXY") or os.environ.get("https_proxy")
_saudi = urllib.request.build_opener(
    urllib.request.ProxyHandler({"http": PROXY, "https": PROXY} if PROXY else {}),
    urllib.request.HTTPSHandler(context=SSL_CTX),
)
_direct = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def request(url, body=None, headers=None, via_saudi=True, timeout=60, attempts=3):
    """Запрос с повторами: VPN-туннель иногда рвёт соединение."""
    import time
    for i in range(attempts):
        try:
            return _request(url, body, headers, via_saudi, timeout)
        except urllib.error.HTTPError:
            raise
        except Exception:
            if i == attempts - 1:
                raise
            time.sleep(3 * (i + 1))


def _request(url, body=None, headers=None, via_saudi=True, timeout=60):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method="POST" if data else "GET")
    req.add_header("User-Agent", UA)
    req.add_header("Accept", "application/json")
    if data:
        req.add_header("Content-Type", "application/json")
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    opener = _saudi if via_saudi else _direct
    with opener.open(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def ingest(payload):
    url = os.environ["INGEST_URL"]
    res = request(url, payload, {"x-ingest-secret": os.environ["INGEST_SECRET"]}, via_saudi=False)
    print("ingest:", res)


def map_token():
    return request(f"{MAP_API}/AuthAPI.svc/GetToken", MAP_CLIENT, {"source": "kiosk"})["Token"]


def map_headers(token, campus):
    return {"Authorization": f"Bearer {token}", "source": "kiosk", "campusId": str(campus)}


def default_name(names):
    d = {x.get("code"): x.get("value") for x in names or []}
    return (d.get("default") or d.get("en") or "").strip() or None, (d.get("ar") or "").strip() or None


def gate_nodes(token, city, campus):
    nodes = request(
        f"{MAP_API}/nodes?types=escalator&types=elevator&types=ramp&types=stairs&types=gate&excludePoiEntrances=true",
        headers=map_headers(token, campus),
    )
    items = []
    for n in nodes:
        if n.get("latitude") is None or n.get("type") not in ("gate", "elevator", "escalator", "stairs", "ramp"):
            continue
        desc, _ = default_name(n.get("description"))
        items.append({
            "id": f"nav:node:{n['id']}",
            "category": n["type"],
            "name": f"Ворота {desc}" if n["type"] == "gate" and desc else None,
            "lat": n["latitude"], "lon": n["longitude"],
            "venue": str(n.get("venueID")), "floor": str(n.get("floorID")),
            "is_closed": bool(n.get("isClosed")),
            "extra": {"gate_no": desc or "", "direction": n.get("direction"), "venue_id": n.get("venueID"), "floor_id": n.get("floorID")},
        })
    return {"city": city, "source": "haramain-map", "items": items}


def find_point(obj):
    """Ищет координаты в ответе карты (centerPoint / entrance / points)."""
    if isinstance(obj, dict):
        lat, lon = obj.get("latitude"), obj.get("longitude")
        if isinstance(lat, (int, float)) and isinstance(lon, (int, float)) and lat and lon:
            return lat, lon
        for key in ("centerPoint", "entrance", "entrancePoint", "location", "position", "polygonData", "points"):
            if key in obj:
                p = find_point(obj[key])
                if p:
                    return p
        for v in obj.values():
            if isinstance(v, (dict, list)):
                p = find_point(v)
                if p:
                    return p
    elif isinstance(obj, list):
        for v in obj:
            p = find_point(v)
            if p:
                return p
    return None


def map_pois(token, city, campus):
    res = request(
        f"{MAP_API}/DataAPI.svc/GetPoIPolygons",
        {"languageCode": "", "useEntranceGateAsCenter": True, "VenueID": None, "FloorID": None,
         "LastUpdateDate": LAST_UPDATE, "filterParameters": {"categoryIds": [], "amenityIds": []}},
        map_headers(token, campus), timeout=120,
    )
    records = res.get("GetPoIPolygonsResult") or res.get("data") or res if isinstance(res, (dict, list)) else []
    if isinstance(records, dict):
        records = next((v for v in records.values() if isinstance(v, list)), [])
    items = []
    if not records:
        print("GetPoIPolygons: пусто, структура ответа:", json.dumps(res, ensure_ascii=False)[:1500])
    elif isinstance(records, list):
        print("GetPoIPolygons sample:", json.dumps(records[0], ensure_ascii=False)[:1500])
    for r in records:
        cat_obj = r.get("primaryCategory") or {}
        cat_id = cat_obj.get("id") or r.get("primaryCategoryId") or r.get("CategoryID")
        category = CATEGORY_MAP.get(cat_id)
        point = find_point(r)
        if not category or not point:
            continue
        name, name_ar = default_name(r.get("name") or r.get("Name"))
        floor_name, _ = default_name((r.get("floor") or {}).get("name"))
        venue_name, _ = default_name((r.get("venue") or {}).get("name"))
        items.append({
            "id": f"nav:poi:{r.get('id') or r.get('ID')}",
            "category": category,
            "name": name, "name_ar": name_ar,
            "lat": point[0], "lon": point[1],
            "venue": venue_name, "floor": floor_name,
            "is_closed": False,
            "extra": {"venue_name": venue_name, "floor_name": floor_name, "nav_category": cat_id},
        })
    return {"city": city, "source": "haramain-map-poi", "items": items}


def live():
    payload = {}
    try:
        payload["tawafSai"] = request(TAWAF_SAI_URL)
    except Exception as exc:
        payload["tawafSaiError"] = repr(exc)
    try:
        payload["prayerZones"] = request(PRAYER_ZONES_URL)
    except Exception as exc:
        payload["prayerZonesError"] = repr(exc)
    ingest(payload)
    # закрытые ворота: узлы карты Мекки
    try:
        token = map_token()
        ingest({"pois": gate_nodes(token, "makkah", CAMPUSES["makkah"])})
    except Exception as exc:
        print("gate nodes failed:", repr(exc))


def map_sync():
    token = map_token()
    for city, campus in CAMPUSES.items():
        if city != "makkah":
            try:
                ingest({"pois": gate_nodes(token, city, campus)})
            except Exception as exc:
                print(f"{city} nodes failed:", repr(exc))
        try:
            pois = map_pois(token, city, campus)
            print(f"{city}: {len(pois['items'])} POI")
            if pois["items"]:
                ingest({"pois": pois})
        except Exception as exc:
            print(f"{city} pois failed:", repr(exc))


def probe():
    """Диагностика: печатает структуру ответов карты (публичные данные)."""
    token = map_token()
    h = map_headers(token, CAMPUSES["makkah"])
    bodies = {
        "polys_all": {"languageCode": "", "useEntranceGateAsCenter": True, "VenueID": None, "FloorID": None,
                      "LastUpdateDate": LAST_UPDATE, "filterParameters": {"categoryIds": [], "amenityIds": []}},
        "polys_cat1": {"languageCode": "", "useEntranceGateAsCenter": True, "VenueID": None, "FloorID": None,
                       "LastUpdateDate": LAST_UPDATE, "filterParameters": {"categoryIds": [1], "amenityIds": []}},
        "polys_venue6": {"languageCode": "", "useEntranceGateAsCenter": True, "VenueID": 6, "FloorID": 28,
                         "LastUpdateDate": LAST_UPDATE, "filterParameters": {"categoryIds": [], "amenityIds": []}},
    }
    for name, body in bodies.items():
        try:
            r = request(f"{MAP_API}/DataAPI.svc/GetPoIPolygons", body, h, timeout=120)
            txt = json.dumps(r, ensure_ascii=False)
            print(f"== {name}: type={type(r).__name__} len={len(txt)} keys={list(r.keys()) if isinstance(r, dict) else None}")
            print(txt[:1500])
        except Exception as exc:
            print(f"== {name}: ERROR {exc!r}")
    try:
        r = request(f"{MAP_API}/DataAPI.svc/getPoIById", {"LanguageCode": "", "ID": 33, "useEntranceGateAsCenter": True}, h, timeout=60)
        print("== poi33", json.dumps(r, ensure_ascii=False)[:2500])
    except Exception as exc:
        print("== poi33 ERROR", repr(exc))
    try:
        r = request(f"{MAP_API}/DataAPI.svc/GetVenueFloors", {"LanguageCode": "", "id": 6, "LastUpdateDate": LAST_UPDATE}, h, timeout=60)
        print("== floors6", json.dumps(r, ensure_ascii=False)[:1500])
    except Exception as exc:
        print("== floors6 ERROR", repr(exc))


if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else "live"
    {"live": live, "map": map_sync, "probe": probe}[mode]()
