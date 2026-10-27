CREATE TABLE IF NOT EXISTS films (
  id           TEXT PRIMARY KEY,
  owner_hash   TEXT NOT NULL,
  status       TEXT NOT NULL CHECK (status IN ('unlisted', 'pending', 'public', 'hidden')),
  created      INTEGER NOT NULL,
  shared       INTEGER NOT NULL,
  title        TEXT NOT NULL,
  subtitle     TEXT NOT NULL DEFAULT '',
  topic        TEXT NOT NULL DEFAULT '',
  lang         TEXT NOT NULL DEFAULT 'en',
  style        TEXT NOT NULL DEFAULT '',
  style_label  TEXT NOT NULL DEFAULT '',
  narrator     TEXT NOT NULL DEFAULT '',
  voice        TEXT NOT NULL DEFAULT '',
  character_id TEXT NOT NULL DEFAULT '',
  minutes      INTEGER,
  duration     REAL NOT NULL DEFAULT 0,
  media        TEXT NOT NULL,
  story        TEXT NOT NULL,
  views        INTEGER NOT NULL DEFAULT 0,
  reports      INTEGER NOT NULL DEFAULT 0,
  ip_hash      TEXT NOT NULL DEFAULT '',
  link_at      INTEGER,
  link_ip      TEXT NOT NULL DEFAULT '',
  flag         TEXT NOT NULL DEFAULT '',
  moderation   TEXT NOT NULL DEFAULT '',
  wants        TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS films_status ON films (status, shared DESC);
CREATE INDEX IF NOT EXISTS films_ip ON films (ip_hash, shared);
CREATE INDEX IF NOT EXISTS films_links ON films (link_ip, link_at);

CREATE TABLE IF NOT EXISTS reports (
  film_id  TEXT NOT NULL,
  ip_hash  TEXT NOT NULL,
  reason   TEXT NOT NULL DEFAULT '',
  created  INTEGER NOT NULL,
  PRIMARY KEY (film_id, ip_hash)
);

CREATE TABLE IF NOT EXISTS issues (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  film_id  TEXT NOT NULL,
  kind     TEXT NOT NULL,
  note     TEXT NOT NULL DEFAULT '',
  title    TEXT NOT NULL DEFAULT '',
  video    TEXT NOT NULL DEFAULT '',
  at       REAL,
  ip_hash  TEXT NOT NULL DEFAULT '',
  created  INTEGER NOT NULL,
  resolved INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS issues_created ON issues (resolved, created DESC);
CREATE INDEX IF NOT EXISTS issues_ip ON issues (ip_hash, created);

CREATE TABLE IF NOT EXISTS story_projects (
  id           TEXT PRIMARY KEY,
  owner_hash   TEXT NOT NULL,
  ip_hash      TEXT NOT NULL DEFAULT '',
  created      INTEGER NOT NULL,
  updated      INTEGER NOT NULL,
  title        TEXT NOT NULL DEFAULT '',
  subtitle     TEXT NOT NULL DEFAULT '',
  topic        TEXT NOT NULL DEFAULT '',
  style        TEXT NOT NULL DEFAULT '',
  style_label  TEXT NOT NULL DEFAULT '',
  lang         TEXT NOT NULL DEFAULT 'id',
  lang_name    TEXT NOT NULL DEFAULT '',
  voice        TEXT NOT NULL DEFAULT '',
  voice_style  TEXT NOT NULL DEFAULT '',
  scene_count  INTEGER NOT NULL DEFAULT 0,
  aspect       TEXT NOT NULL DEFAULT '16:9',
  character_ref TEXT NOT NULL DEFAULT '',
  scenes       TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS stories_updated ON story_projects (updated DESC);
CREATE INDEX IF NOT EXISTS stories_ip ON story_projects (ip_hash, created);
ALTER TABLE story_projects ADD COLUMN poster_prompt TEXT NOT NULL DEFAULT '';
ALTER TABLE story_projects ADD COLUMN poster_h TEXT NOT NULL DEFAULT '';
ALTER TABLE story_projects ADD COLUMN poster_v TEXT NOT NULL DEFAULT '';
ALTER TABLE story_projects ADD COLUMN genre TEXT NOT NULL DEFAULT 'edukasi';
ALTER TABLE story_projects ADD COLUMN music_title TEXT NOT NULL DEFAULT '';
ALTER TABLE story_projects ADD COLUMN music_url TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS characters (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL DEFAULT '',
  personality TEXT NOT NULL DEFAULT '',
  group_name  TEXT NOT NULL DEFAULT '',
  style       TEXT NOT NULL DEFAULT '',
  style_label TEXT NOT NULL DEFAULT '',
  traits      TEXT NOT NULL DEFAULT '',
  pronoun     TEXT NOT NULL DEFAULT '',
  voice_id    TEXT NOT NULL DEFAULT '',
  voice_name  TEXT NOT NULL DEFAULT '',
  voice_gender TEXT NOT NULL DEFAULT '',
  voice_age   TEXT NOT NULL DEFAULT '',
  voice_accent TEXT NOT NULL DEFAULT '',
  voice_desc  TEXT NOT NULL DEFAULT '',
  thumb       TEXT NOT NULL DEFAULT '',
  hero        TEXT NOT NULL DEFAULT '',
  sheet       TEXT NOT NULL DEFAULT '',
  sort        INTEGER NOT NULL DEFAULT 0,
  created     INTEGER NOT NULL,
  updated     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS characters_updated ON characters (updated DESC);
