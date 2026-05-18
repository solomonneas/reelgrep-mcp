// Build an in-memory reelgrep v2 SQLite DB with deterministic fixture data.
// Used by every tool/client test so they share the same expected rows.

import Database from "better-sqlite3";

export const VIDEO_A = {
  id: 1,
  file_hash: "blake2b:8b63a73611111111aaaaaaaa22222222bbbbbbbb33333333cccccccc44444444",
  path: "/srv/lectures/Module_1-1.mp4",
  duration_ms: 1_234_567,
  width: 1920,
  height: 1080,
  fps: 30,
  container: "mp4",
  video_codec: "h264",
  audio_codec: "aac",
  size_bytes: 524_288_000,
  ingested_at: "2026-05-10T12:00:00Z",
  probe_json: "{}",
};

export const VIDEO_B = {
  id: 2,
  file_hash: "blake2b:c0ffee0011111111aaaaaaaa22222222bbbbbbbb33333333cccccccc55555555",
  path: "/srv/lectures/Module_2-1.mp4",
  duration_ms: 987_654,
  width: 1280,
  height: 720,
  fps: 24,
  container: "mp4",
  video_codec: "h264",
  audio_codec: "aac",
  size_bytes: 268_435_456,
  ingested_at: "2026-05-12T09:30:00Z",
  probe_json: "{}",
};

export function buildSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE videos (
      id INTEGER PRIMARY KEY,
      file_hash TEXT UNIQUE NOT NULL,
      path TEXT NOT NULL,
      duration_ms INTEGER,
      width INTEGER,
      height INTEGER,
      fps REAL,
      container TEXT,
      video_codec TEXT,
      audio_codec TEXT,
      size_bytes INTEGER,
      ingested_at TEXT NOT NULL,
      probe_json TEXT NOT NULL
    );

    CREATE TABLE subtitles (
      id INTEGER PRIMARY KEY,
      video_id INTEGER NOT NULL,
      language TEXT,
      source TEXT NOT NULL,
      stream_index INTEGER,
      start_ms INTEGER NOT NULL,
      end_ms INTEGER NOT NULL,
      text TEXT NOT NULL
    );

    CREATE VIRTUAL TABLE subtitles_fts USING fts5(
      text, content='subtitles', content_rowid='id', tokenize='porter unicode61'
    );

    CREATE TABLE frames (
      id INTEGER PRIMARY KEY,
      video_id INTEGER NOT NULL,
      timestamp_ms INTEGER NOT NULL,
      path TEXT NOT NULL,
      sampling_strategy TEXT NOT NULL,
      width INTEGER,
      height INTEGER
    );

    CREATE TABLE person_searches (
      id INTEGER PRIMARY KEY,
      video_id INTEGER NOT NULL,
      label TEXT NOT NULL,
      backend TEXT NOT NULL,
      positive_examples_json TEXT NOT NULL,
      negative_examples_json TEXT NOT NULL,
      config_json TEXT NOT NULL,
      threshold REAL NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE person_matches (
      id INTEGER PRIMARY KEY,
      search_id INTEGER NOT NULL,
      frame_id INTEGER NOT NULL,
      confidence REAL NOT NULL,
      bbox_json TEXT,
      reasoning TEXT
    );

    CREATE TABLE export_artifacts (
      id INTEGER PRIMARY KEY,
      video_id INTEGER NOT NULL,
      kind TEXT NOT NULL,
      path TEXT NOT NULL,
      start_ms INTEGER,
      end_ms INTEGER,
      manifest_path TEXT,
      created_at TEXT NOT NULL
    );
  `);
}

function insertVideos(db: Database.Database): void {
  const stmt = db.prepare(
    `INSERT INTO videos
      (id, file_hash, path, duration_ms, width, height, fps, container,
        video_codec, audio_codec, size_bytes, ingested_at, probe_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const v of [VIDEO_A, VIDEO_B]) {
    stmt.run(
      v.id,
      v.file_hash,
      v.path,
      v.duration_ms,
      v.width,
      v.height,
      v.fps,
      v.container,
      v.video_codec,
      v.audio_codec,
      v.size_bytes,
      v.ingested_at,
      v.probe_json,
    );
  }
}

function insertSubtitles(db: Database.Database): void {
  const stmt = db.prepare(
    `INSERT INTO subtitles
      (id, video_id, language, source, stream_index, start_ms, end_ms, text)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const ftsStmt = db.prepare(
    `INSERT INTO subtitles_fts (rowid, text) VALUES (?, ?)`,
  );
  const cues: Array<[number, number, string | null, string, number | null, number, number, string]> = [
    // Video A
    [1, VIDEO_A.id, "en", "whisper", null, 311_550, 315_000, "So, now let's take a look at some more database terminology, schema, instances, and state."],
    [2, VIDEO_A.id, "en", "whisper", null, 320_000, 324_000, "A schema describes the structure of the data."],
    [3, VIDEO_A.id, "en", "whisper", null, 330_000, 333_000, "An instance is the actual contents at a given moment."],
    // Video B
    [4, VIDEO_B.id, "en", "embedded", 0, 60_000, 63_000, "Normalization breaks tables down to reduce redundancy."],
    [5, VIDEO_B.id, "en", "embedded", 0, 64_000, 67_500, "We will revisit schema design in module three."],
  ];
  for (const c of cues) {
    stmt.run(...c);
    ftsStmt.run(c[0], c[7]);
  }
}

function insertFrames(db: Database.Database): void {
  const stmt = db.prepare(
    `INSERT INTO frames
      (id, video_id, timestamp_ms, path, sampling_strategy, width, height)
      VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  // Video A: 3 frames
  stmt.run(1, VIDEO_A.id, 100_000, "/srv/frames/a-100.jpg", "uniform", 1920, 1080);
  stmt.run(2, VIDEO_A.id, 200_000, "/srv/frames/a-200.jpg", "uniform", 1920, 1080);
  stmt.run(3, VIDEO_A.id, 300_000, "/srv/frames/a-300.jpg", "uniform", 1920, 1080);
  // Video B: 1 frame
  stmt.run(4, VIDEO_B.id, 50_000, "/srv/frames/b-50.jpg", "uniform", 1280, 720);
}

function insertSearches(db: Database.Database): void {
  const sStmt = db.prepare(
    `INSERT INTO person_searches
      (id, video_id, label, backend, positive_examples_json,
        negative_examples_json, config_json, threshold, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  sStmt.run(
    1,
    VIDEO_A.id,
    "Professor Smith",
    "clip-vit-b32",
    '["/refs/smith-1.jpg"]',
    "[]",
    '{"top_k":10}',
    0.72,
    "2026-05-11T08:00:00Z",
  );
  sStmt.run(
    2,
    VIDEO_B.id,
    "TA Lopez",
    "clip-vit-b32",
    '["/refs/lopez-1.jpg"]',
    "[]",
    '{"top_k":5}',
    0.68,
    "2026-05-13T10:15:00Z",
  );

  const mStmt = db.prepare(
    `INSERT INTO person_matches
      (id, search_id, frame_id, confidence, bbox_json, reasoning)
      VALUES (?, ?, ?, ?, ?, ?)`,
  );
  mStmt.run(1, 1, 1, 0.81, '{"x":10,"y":20,"w":50,"h":60}', "strong cheek match");
  mStmt.run(2, 1, 2, 0.95, '{"x":12,"y":22,"w":48,"h":58}', "frontal view");
  mStmt.run(3, 1, 3, 0.74, null, null);
  mStmt.run(4, 2, 4, 0.71, null, null);
}

function insertExports(db: Database.Database): void {
  const stmt = db.prepare(
    `INSERT INTO export_artifacts
      (id, video_id, kind, path, start_ms, end_ms, manifest_path, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  stmt.run(1, VIDEO_A.id, "screenshot", "/srv/exports/a-1.png", 305_000, null, null, "2026-05-11T09:00:00Z");
  stmt.run(2, VIDEO_A.id, "clip", "/srv/exports/a-1.mp4", 300_000, 360_000, "/srv/exports/a-1.json", "2026-05-11T09:05:00Z");
  stmt.run(3, VIDEO_A.id, "gif", "/srv/exports/a-1.gif", 310_000, 320_000, null, "2026-05-11T09:10:00Z");
  stmt.run(4, VIDEO_B.id, "screenshot", "/srv/exports/b-1.png", 60_000, null, null, "2026-05-13T11:00:00Z");
  stmt.run(5, VIDEO_B.id, "contact_sheet", "/srv/exports/b-sheet.png", null, null, "/srv/exports/b-sheet.json", "2026-05-13T11:05:00Z");
}

/** Build a fresh in-memory SQLite DB pre-loaded with the reelgrep v2 schema
 *  and a deterministic set of fixture rows.
 */
export function seededDb(): Database.Database {
  const db = new Database(":memory:");
  buildSchema(db);
  insertVideos(db);
  insertSubtitles(db);
  insertFrames(db);
  insertSearches(db);
  insertExports(db);
  return db;
}
