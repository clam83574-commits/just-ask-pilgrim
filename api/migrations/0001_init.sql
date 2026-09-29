-- Загруженность: текущее состояние и история изменений
CREATE TABLE crowd_current (
  city        TEXT NOT NULL,          -- makkah | madinah
  zone_key    TEXT NOT NULL,          -- tawaf:1, sai:7, prayer:0 ...
  kind        TEXT NOT NULL,          -- tawaf | sai | prayer
  source_id   INTEGER,
  name_ar     TEXT,
  status      INTEGER,                -- 1 light, 2 moderate, 3 high, 4 closed, 0 unknown
  minutes     INTEGER,
  light_min   INTEGER,
  avg_min     INTEGER,
  crowded_min INTEGER,
  gates       TEXT,                   -- JSON array of gate numbers
  source_updated_at TEXT,
  fetched_at  TEXT NOT NULL,
  PRIMARY KEY (city, zone_key)
);

CREATE TABLE crowd_history (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  city        TEXT NOT NULL,
  zone_key    TEXT NOT NULL,
  status      INTEGER,
  minutes     INTEGER,
  source_updated_at TEXT,
  fetched_at  TEXT NOT NULL
);
CREATE INDEX ix_crowd_history ON crowd_history(city, zone_key, fetched_at);

CREATE TABLE ingest_log (
  fetched_at TEXT NOT NULL,
  source     TEXT NOT NULL,
  ok         INTEGER NOT NULL,
  note       TEXT
);

-- Точки: официальная карта ведомства (узлы и POI) + OSM
CREATE TABLE pois (
  id         TEXT PRIMARY KEY,        -- nav:node:1399, nav:poi:33, osm:node:123
  city       TEXT NOT NULL,
  category   TEXT NOT NULL,           -- gate, toilet, wheelchair, luggage, medical, transport, elevator, escalator, food, exchange, prayer_disabled, ...
  name       TEXT,
  name_ar    TEXT,
  lat        REAL NOT NULL,
  lon        REAL NOT NULL,
  venue      TEXT,
  floor      TEXT,
  is_closed  INTEGER DEFAULT 0,
  extra      TEXT,                    -- JSON
  source     TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX ix_pois_city_cat ON pois(city, category);

-- Пользователи и группы
CREATE TABLE users (
  id           INTEGER PRIMARY KEY,   -- telegram user id
  first_name   TEXT,
  username     TEXT,
  lang         TEXT DEFAULT 'ru',
  city         TEXT DEFAULT 'makkah',
  can_message  INTEGER DEFAULT 0,     -- пользователь запускал бота / разрешил сообщения
  notify_crowd INTEGER DEFAULT 0,
  last_crowd_alert_at TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

CREATE TABLE groups (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  code        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  company     TEXT,
  hotel_name  TEXT,
  hotel_lat   REAL,
  hotel_lon   REAL,
  owner_id    INTEGER NOT NULL,
  created_at  TEXT NOT NULL
);

CREATE TABLE group_members (
  group_id  INTEGER NOT NULL,
  user_id   INTEGER NOT NULL,
  role      TEXT NOT NULL DEFAULT 'member',   -- admin | member
  joined_at TEXT NOT NULL,
  PRIMARY KEY (group_id, user_id)
);
CREATE INDEX ix_members_user ON group_members(user_id);

CREATE TABLE events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id   INTEGER NOT NULL,
  title      TEXT NOT NULL,
  type       TEXT NOT NULL DEFAULT 'meeting',  -- meeting | bus | excursion | prayer | meal | other
  starts_at  TEXT NOT NULL,                    -- ISO UTC
  place_name TEXT,
  lat        REAL,
  lon        REAL,
  note       TEXT,
  created_by INTEGER,
  created_at TEXT NOT NULL
);
CREATE INDEX ix_events_group_time ON events(group_id, starts_at);

CREATE TABLE announcements (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id   INTEGER NOT NULL,
  text       TEXT NOT NULL,
  created_by INTEGER,
  created_at TEXT NOT NULL
);

CREATE TABLE reminders_sent (
  event_id INTEGER NOT NULL,
  kind     TEXT NOT NULL,     -- 60 | 15
  sent_at  TEXT NOT NULL,
  PRIMARY KEY (event_id, kind)
);
