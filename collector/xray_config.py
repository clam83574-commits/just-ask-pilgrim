"""Собирает конфиг Xray из подписки (ссылка из Happ) и выбирает саудовский сервер.

    python xray_config.py > xray.json

Переменные окружения:
    SUB_URL      — ссылка подписки (https://...), отдаёт список vless:// / vmess:// / trojan:// / ss://
    PROXY_URI    — (вместо подписки) одна ссылка vless://... на саудовский сервер
    SERVER_HINT  — подстрока для выбора сервера (по умолчанию: saudi|sa|ksa|jeddah|riyadh|🇸🇦)
Поднимает локальный HTTP-прокси на 127.0.0.1:10809.
"""

import base64
import json
import os
import re
import sys
import urllib.parse
import urllib.request

HINT = re.compile(os.environ.get("SERVER_HINT") or r"saudi|ksa|jeddah|riyadh|🇸🇦|\bsa\b|сауд|джидд|эр-рияд", re.I)


def b64decode(s: str) -> str:
    s = s.strip().replace("-", "+").replace("_", "/")
    return base64.b64decode(s + "=" * (-len(s) % 4)).decode("utf-8", errors="ignore")


def load_links() -> list:
    if os.environ.get("PROXY_URI"):
        return [os.environ["PROXY_URI"].strip()]
    req = urllib.request.Request(os.environ["SUB_URL"], headers={"User-Agent": "Happ/2.0"})
    raw = urllib.request.urlopen(req, timeout=30).read().decode("utf-8", errors="ignore").strip()
    text = raw if "://" in raw[:20] else b64decode(raw)
    return [line.strip() for line in text.splitlines() if "://" in line]


def label(link: str) -> str:
    if link.startswith("vmess://"):
        try:
            return json.loads(b64decode(link[8:])).get("ps", "")
        except Exception:
            return ""
    return urllib.parse.unquote(link.split("#", 1)[1]) if "#" in link else ""


def stream_settings(q: dict, host: str) -> dict:
    get = lambda k, d="": (q.get(k) or [d])[0]
    net = get("type", "tcp")
    sec = get("security", "none")
    ss = {"network": net, "security": sec}
    if sec == "reality":
        ss["realitySettings"] = {
            "serverName": get("sni"), "fingerprint": get("fp", "chrome"), "publicKey": get("pbk"),
            "shortId": get("sid"), "spiderX": get("spx", "/"),
        }
    elif sec == "tls":
        ss["tlsSettings"] = {"serverName": get("sni", host), "fingerprint": get("fp", "chrome"),
                             "alpn": [a for a in get("alpn").split(",") if a] or None, "allowInsecure": get("allowInsecure") == "1"}
        ss["tlsSettings"] = {k: v for k, v in ss["tlsSettings"].items() if v is not None}
    if net == "ws":
        ss["wsSettings"] = {"path": get("path", "/"), "headers": {"Host": get("host", host)}}
    elif net == "grpc":
        ss["grpcSettings"] = {"serviceName": get("serviceName")}
    elif net in ("xhttp", "splithttp"):
        ss["xhttpSettings"] = {"path": get("path", "/"), "host": get("host", host), "mode": get("mode", "auto")}
    elif net == "tcp" and get("headerType") == "http":
        ss["tcpSettings"] = {"header": {"type": "http", "request": {"headers": {"Host": [get("host", host)]}}}}
    return ss


def outbound(link: str) -> dict:
    if link.startswith("vless://") or link.startswith("trojan://"):
        proto = link.split("://")[0]
        u = urllib.parse.urlparse(link)
        q = urllib.parse.parse_qs(u.query)
        user = urllib.parse.unquote(u.username or "")
        server = {"address": u.hostname, "port": u.port}
        if proto == "vless":
            server["users"] = [{"id": user, "encryption": (q.get("encryption") or ["none"])[0],
                                "flow": (q.get("flow") or [""])[0]}]
            settings = {"vnext": [server]}
        else:
            server["password"] = user
            settings = {"servers": [server]}
        return {"protocol": proto, "settings": settings, "streamSettings": stream_settings(q, u.hostname), "tag": "proxy"}
    if link.startswith("vmess://"):
        v = json.loads(b64decode(link[8:]))
        q = {"type": [v.get("net", "tcp")], "security": [v.get("tls") or "none"], "sni": [v.get("sni", "")],
             "path": [v.get("path", "/")], "host": [v.get("host", "")], "serviceName": [v.get("path", "")]}
        return {"protocol": "vmess",
                "settings": {"vnext": [{"address": v["add"], "port": int(v["port"]),
                                        "users": [{"id": v["id"], "alterId": int(v.get("aid", 0)), "security": v.get("scy", "auto")}]}]},
                "streamSettings": stream_settings(q, v["add"]), "tag": "proxy"}
    if link.startswith("ss://"):
        u = urllib.parse.urlparse(link)
        userinfo = urllib.parse.unquote(u.username or "")
        method, password = (b64decode(userinfo) if ":" not in userinfo else userinfo).split(":", 1)
        return {"protocol": "shadowsocks",
                "settings": {"servers": [{"address": u.hostname, "port": u.port, "method": method, "password": password}]},
                "tag": "proxy"}
    raise ValueError("unsupported link: " + link[:20])


def main():
    links = load_links()
    if not links:
        sys.exit("подписка пустая")
    saudi = [l for l in links if HINT.search(label(l))]
    chosen = saudi[0] if saudi else links[0]
    print(f"servers: {len(links)}, saudi: {len(saudi)}, chosen: {label(chosen)!r}", file=sys.stderr)
    config = {
        "log": {"loglevel": "warning"},
        "inbounds": [{"listen": "127.0.0.1", "port": 10809, "protocol": "http", "settings": {}}],
        "outbounds": [outbound(chosen), {"protocol": "freedom", "tag": "direct"}],
    }
    print(json.dumps(config, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
