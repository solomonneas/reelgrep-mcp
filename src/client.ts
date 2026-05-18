// Read-only wrapper around the reelgrep SQLite v2 index. All queries use
// prepared statements with bound parameters; the underlying connection is
// opened in readonly mode so a misbehaving caller cannot mutate the index.

import Database from "better-sqlite3";

/** A row from the videos table with the raw probe columns. */
export interface VideoRow {
  id: number;
  file_hash: string;
  path: string;
  duration_ms: number | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  container: string | null;
  video_codec: string | null;
  audio_codec: string | null;
  size_bytes: number | null;
  ingested_at: string;
  probe_json: string;
}

/** A VideoRow enriched with per-video counts joined from related tables. */
export interface VideoSummary extends VideoRow {
  frames_count: number;
  subtitle_cues_count: number;
  exports_count: number;
  person_searches_count: number;
}

/** One subtitle cue row (a single FTS-searchable text segment). */
export interface CueRow {
  id: number;
  video_id: number;
  language: string | null;
  source: string;
  stream_index: number | null;
  start_ms: number;
  end_ms: number;
  text: string;
}

/** A cue joined with its parent video's hash and path for context. */
export interface CueWithVideo extends CueRow {
  video_hash: string;
  video_path: string;
}

/** A row from the frames table; one sampled still image. */
export interface FrameRow {
  id: number;
  video_id: number;
  timestamp_ms: number;
  path: string;
  sampling_strategy: string;
  width: number | null;
  height: number | null;
}

/** A person_search row, the parent of zero or more person_matches. */
export interface SearchRow {
  id: number;
  video_id: number;
  label: string;
  backend: string;
  positive_examples_json: string;
  negative_examples_json: string;
  config_json: string;
  threshold: number;
  created_at: string;
}

/** A SearchRow enriched with the parent video's hash, path, and match count. */
export interface SearchSummary extends SearchRow {
  video_hash: string;
  video_path: string;
  match_count: number;
}

/** A person_matches row joined with its frame's timestamp and path. */
export interface MatchWithFrame {
  id: number;
  search_id: number;
  frame_id: number;
  confidence: number;
  bbox_json: string | null;
  reasoning: string | null;
  frame_timestamp_ms: number;
  frame_path: string;
}

/** A row from the export_artifacts table. */
export interface ExportRow {
  id: number;
  video_id: number;
  kind: string;
  path: string;
  start_ms: number | null;
  end_ms: number | null;
  manifest_path: string | null;
  created_at: string;
}

/** An ExportRow enriched with the parent video's hash and path. */
export interface ExportWithVideo extends ExportRow {
  video_hash: string;
  video_path: string;
}

const VIDEO_SUMMARY_SELECT = `SELECT v.*,
    (SELECT COUNT(*) FROM frames WHERE video_id = v.id) AS frames_count,
    (SELECT COUNT(*) FROM subtitles WHERE video_id = v.id) AS subtitle_cues_count,
    (SELECT COUNT(*) FROM export_artifacts WHERE video_id = v.id) AS exports_count,
    (SELECT COUNT(*) FROM person_searches WHERE video_id = v.id) AS person_searches_count
  FROM videos v`;

export class ReelgrepClient {
  private db: Database.Database;

  /**
   * Open the reelgrep index in readonly mode.
   * Accepts either a filesystem path or an already-opened Database instance
   * (the latter is used by the test suite to drive an in-memory DB).
   */
  constructor(dbOrPath: string | Database.Database) {
    if (typeof dbOrPath === "string") {
      this.db = new Database(dbOrPath, { readonly: true, fileMustExist: true });
      this.db.pragma("journal_mode = WAL");
    } else {
      this.db = dbOrPath;
    }
  }

  /** Close the underlying SQLite handle. */
  close(): void {
    this.db.close();
  }

  /** Total number of indexed videos. Used by reelgrep_health. */
  videoCount(): number {
    const row = this.db.prepare("SELECT COUNT(*) AS n FROM videos").get() as {
      n: number;
    };
    return row.n;
  }

  /** List videos newest-first, with related-table counts attached. */
  listVideos(opts: { limit?: number; offset?: number } = {}): VideoSummary[] {
    const limit = Math.min(opts.limit ?? 20, 100);
    const offset = opts.offset ?? 0;
    return this.db
      .prepare(
        `${VIDEO_SUMMARY_SELECT} ORDER BY v.ingested_at DESC LIMIT ? OFFSET ?`,
      )
      .all(limit, offset) as VideoSummary[];
  }

  /**
   * Look up a video by its full file_hash or an unambiguous hex prefix.
   * Returns null when nothing matches or when a prefix has multiple hits.
   */
  resolveVideoByHashOrPrefix(hashOrPrefix: string): VideoSummary | null {
    const exact = this.db
      .prepare(`${VIDEO_SUMMARY_SELECT} WHERE v.file_hash = ?`)
      .get(hashOrPrefix) as VideoSummary | undefined;
    if (exact) return exact;

    const hex = hashOrPrefix.replace(/^blake2b:/, "");
    if (!/^[0-9a-f]{8,}$/i.test(hex)) return null;

    const matches = this.db
      .prepare(`${VIDEO_SUMMARY_SELECT} WHERE v.file_hash LIKE ?`)
      .all(`blake2b:${hex}%`) as VideoSummary[];
    if (matches.length === 1) return matches[0];
    return null;
  }

  /**
   * FTS5 search over the subtitles index. When `videoHash` is supplied the
   * search is scoped to that single video; otherwise it runs across the
   * whole library and results are returned newest-video-first.
   */
  searchSubtitles(opts: {
    query: string;
    videoHash?: string;
    limit?: number;
  }): CueWithVideo[] {
    const limit = Math.min(opts.limit ?? 25, 200);

    if (opts.videoHash) {
      const v = this.resolveVideoByHashOrPrefix(opts.videoHash);
      if (!v) return [];
      return this.db
        .prepare(
          `SELECT s.id, s.video_id, s.language, s.source, s.stream_index,
              s.start_ms, s.end_ms, s.text,
              ? AS video_hash, ? AS video_path
            FROM subtitles_fts
            JOIN subtitles s ON s.id = subtitles_fts.rowid
            WHERE subtitles_fts MATCH ? AND s.video_id = ?
            ORDER BY s.start_ms
            LIMIT ?`,
        )
        .all(v.file_hash, v.path, opts.query, v.id, limit) as CueWithVideo[];
    }

    return this.db
      .prepare(
        `SELECT s.id, s.video_id, s.language, s.source, s.stream_index,
            s.start_ms, s.end_ms, s.text,
            v.file_hash AS video_hash, v.path AS video_path
          FROM subtitles_fts
          JOIN subtitles s ON s.id = subtitles_fts.rowid
          JOIN videos v ON v.id = s.video_id
          WHERE subtitles_fts MATCH ?
          ORDER BY v.ingested_at DESC, s.start_ms
          LIMIT ?`,
      )
      .all(opts.query, limit) as CueWithVideo[];
  }

  /**
   * Cues for a single video whose start_ms falls within
   * [timestamp_ms - window*1000, timestamp_ms + window*1000].
   */
  recentCues(opts: {
    videoHash: string;
    timestampMs: number;
    windowSeconds?: number;
  }): CueWithVideo[] {
    const v = this.resolveVideoByHashOrPrefix(opts.videoHash);
    if (!v) return [];
    const windowMs = Math.max(0, opts.windowSeconds ?? 30) * 1000;
    const lo = opts.timestampMs - windowMs;
    const hi = opts.timestampMs + windowMs;
    return this.db
      .prepare(
        `SELECT s.id, s.video_id, s.language, s.source, s.stream_index,
            s.start_ms, s.end_ms, s.text,
            ? AS video_hash, ? AS video_path
          FROM subtitles s
          WHERE s.video_id = ? AND s.start_ms BETWEEN ? AND ?
          ORDER BY s.start_ms`,
      )
      .all(v.file_hash, v.path, v.id, lo, hi) as CueWithVideo[];
  }

  /** List person_searches, optionally scoped to one video. */
  listSearches(opts: { videoHash?: string; limit?: number } = {}): SearchSummary[] {
    const limit = Math.min(opts.limit ?? 20, 100);
    if (opts.videoHash) {
      const v = this.resolveVideoByHashOrPrefix(opts.videoHash);
      if (!v) return [];
      return this.db
        .prepare(
          `SELECT ps.*, v.file_hash AS video_hash, v.path AS video_path,
              (SELECT COUNT(*) FROM person_matches WHERE search_id = ps.id) AS match_count
            FROM person_searches ps
            JOIN videos v ON v.id = ps.video_id
            WHERE ps.video_id = ?
            ORDER BY ps.created_at DESC
            LIMIT ?`,
        )
        .all(v.id, limit) as SearchSummary[];
    }
    return this.db
      .prepare(
        `SELECT ps.*, v.file_hash AS video_hash, v.path AS video_path,
            (SELECT COUNT(*) FROM person_matches WHERE search_id = ps.id) AS match_count
          FROM person_searches ps
          JOIN videos v ON v.id = ps.video_id
          ORDER BY ps.created_at DESC
          LIMIT ?`,
      )
      .all(limit) as SearchSummary[];
  }

  /** Fetch a single person_search with its parent-video columns attached. */
  getSearch(searchId: number): SearchSummary | null {
    const row = this.db
      .prepare(
        `SELECT ps.*, v.file_hash AS video_hash, v.path AS video_path,
            (SELECT COUNT(*) FROM person_matches WHERE search_id = ps.id) AS match_count
          FROM person_searches ps
          JOIN videos v ON v.id = ps.video_id
          WHERE ps.id = ?`,
      )
      .get(searchId) as SearchSummary | undefined;
    return row ?? null;
  }

  /** All matches for a search, joined with frame metadata, highest-confidence first. */
  getMatches(searchId: number): MatchWithFrame[] {
    return this.db
      .prepare(
        `SELECT pm.id, pm.search_id, pm.frame_id, pm.confidence,
            pm.bbox_json, pm.reasoning,
            f.timestamp_ms AS frame_timestamp_ms, f.path AS frame_path
          FROM person_matches pm
          JOIN frames f ON f.id = pm.frame_id
          WHERE pm.search_id = ?
          ORDER BY pm.confidence DESC, pm.id`,
      )
      .all(searchId) as MatchWithFrame[];
  }

  /** List export_artifacts, optionally filtered by video and/or kind. */
  listExports(opts: {
    videoHash?: string;
    kind?: string;
    limit?: number;
  } = {}): ExportWithVideo[] {
    const limit = Math.min(opts.limit ?? 25, 200);
    const clauses: string[] = [];
    const params: Array<string | number> = [];

    let videoId: number | null = null;
    if (opts.videoHash) {
      const v = this.resolveVideoByHashOrPrefix(opts.videoHash);
      if (!v) return [];
      videoId = v.id;
      clauses.push("ea.video_id = ?");
      params.push(videoId);
    }
    if (opts.kind) {
      clauses.push("ea.kind = ?");
      params.push(opts.kind);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    params.push(limit);

    return this.db
      .prepare(
        `SELECT ea.id, ea.video_id, ea.kind, ea.path, ea.start_ms, ea.end_ms,
            ea.manifest_path, ea.created_at,
            v.file_hash AS video_hash, v.path AS video_path
          FROM export_artifacts ea
          JOIN videos v ON v.id = ea.video_id
          ${where}
          ORDER BY ea.created_at DESC
          LIMIT ?`,
      )
      .all(...params) as ExportWithVideo[];
  }

  /** Map of export kind -> count for a single video. */
  exportsByKindForVideo(videoId: number): Record<string, number> {
    const rows = this.db
      .prepare(
        `SELECT kind, COUNT(*) AS n FROM export_artifacts WHERE video_id = ? GROUP BY kind`,
      )
      .all(videoId) as Array<{ kind: string; n: number }>;
    const out: Record<string, number> = {};
    for (const r of rows) out[r.kind] = r.n;
    return out;
  }
}
