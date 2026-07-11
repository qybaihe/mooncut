import {randomUUID} from "node:crypto";
import {existsSync, mkdirSync} from "node:fs";
import {dirname, extname} from "node:path";
import {DatabaseSync} from "node:sqlite";
import {config} from "./config.ts";
import type {EditJobRecord} from "./types.ts";

export type CommunityPost = {
  id: string;
  jobId: string;
  authorName: string;
  title: string;
  caption: string;
  videoPath: string;
  posterPath?: string;
  durationMs: number;
  width: number;
  height: number;
  createdAt: string;
};

type CommunityPostRow = {
  id: string;
  job_id: string;
  author_name: string;
  title: string;
  caption: string;
  video_path: string;
  poster_path: string | null;
  duration_ms: number;
  width: number;
  height: number;
  created_at: string;
  user_id: string | null;
};

export type PublishCommunityPostInput = {
  authorName?: string;
  title?: string;
  caption?: string;
};

export class CommunityStoreError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const cleanText = (value: string | undefined, maximum: number) =>
  (value ?? "").replace(/[\u0000-\u001f\u007f]+/gu, " ").replace(/\s+/gu, " ").trim().slice(0, maximum);

const titleFromJob = (job: EditJobRecord) => {
  const requested = cleanText(job.request.title, 80);
  if (requested) return requested;
  const extension = extname(job.originalName);
  return cleanText(extension ? job.originalName.slice(0, -extension.length) : job.originalName, 80) || "我的 MoonCut 口播";
};

const fromRow = (row: CommunityPostRow): CommunityPost => ({
  id: row.id,
  jobId: row.job_id,
  authorName: row.author_name,
  title: row.title,
  caption: row.caption,
  videoPath: row.video_path,
  ...(row.poster_path ? {posterPath: row.poster_path} : {}),
  durationMs: row.duration_ms,
  width: row.width,
  height: row.height,
  createdAt: row.created_at,
});

export class CommunityStore {
  private database?: DatabaseSync;
  private readonly path: string;

  constructor(path = config.databasePath) {
    this.path = path;
  }

  private db() {
    if (this.database) return this.database;
    mkdirSync(dirname(this.path), {recursive: true});
    const database = new DatabaseSync(this.path);
    database.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000;");
    database.exec(`
      CREATE TABLE IF NOT EXISTS community_posts (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL UNIQUE,
        author_name TEXT NOT NULL,
        title TEXT NOT NULL,
        caption TEXT NOT NULL DEFAULT '',
        video_path TEXT NOT NULL,
        poster_path TEXT,
        duration_ms INTEGER NOT NULL CHECK(duration_ms >= 0),
        width INTEGER NOT NULL CHECK(width > 0),
        height INTEGER NOT NULL CHECK(height > 0),
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS community_posts_created_at_idx
        ON community_posts(created_at DESC, id DESC);
    `);
    const columns = database.prepare("PRAGMA table_info(community_posts)").all() as Array<{name: string}>;
    if (!columns.some((column) => column.name === "user_id")) {
      database.exec("ALTER TABLE community_posts ADD COLUMN user_id TEXT;");
    }
    const version = database.prepare("PRAGMA user_version").get() as {user_version: number};
    if (version.user_version < 2) database.exec("PRAGMA user_version = 2;");
    this.database = database;
    return database;
  }

  close() {
    this.database?.close();
    this.database = undefined;
  }

  publish(job: EditJobRecord, input: PublishCommunityPostInput = {}, userId?: string) {
    if (job.status !== "completed" || !job.result?.artifacts.video) {
      throw new CommunityStoreError(409, "Only a completed edit can be shared to the community");
    }
    if (job.result.quality?.ok !== true) {
      throw new CommunityStoreError(409, "The finished video must pass quality review before sharing");
    }
    const videoPath = job.result.artifacts.video;
    if (!existsSync(videoPath)) throw new CommunityStoreError(409, "The finished video artifact is unavailable");
    const existing = this.getByJobId(job.id);
    if (existing) return {post: existing, created: false};

    const authorName = cleanText(input.authorName, 32) || "MoonCut 创作者";
    const title = cleanText(input.title, 80) || titleFromJob(job);
    const caption = cleanText(input.caption, 280);
    const candidatePoster = job.result.artifacts.finalContactSheet;
    const posterPath = candidatePoster && existsSync(candidatePoster) ? candidatePoster : undefined;
    const post: CommunityPost = {
      id: randomUUID().replaceAll("-", ""),
      jobId: job.id,
      authorName,
      title,
      caption,
      videoPath,
      ...(posterPath ? {posterPath} : {}),
      durationMs: Math.max(0, Math.round(job.result.probe.durationMs)),
      width: job.result.probe.width,
      height: job.result.probe.height,
      createdAt: new Date().toISOString(),
    };
    try {
      this.db().prepare(`
        INSERT INTO community_posts (
          id, job_id, author_name, title, caption, video_path, poster_path,
          duration_ms, width, height, created_at, user_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        post.id,
        post.jobId,
        post.authorName,
        post.title,
        post.caption,
        post.videoPath,
        post.posterPath ?? null,
        post.durationMs,
        post.width,
        post.height,
        post.createdAt,
        userId ?? null,
      );
    } catch (error) {
      const concurrent = this.getByJobId(job.id);
      if (concurrent) return {post: concurrent, created: false};
      throw error;
    }
    return {post, created: true};
  }

  get(id: string) {
    const row = this.db().prepare("SELECT * FROM community_posts WHERE id = ?").get(id) as CommunityPostRow | undefined;
    return row ? fromRow(row) : undefined;
  }

  getByJobId(jobId: string) {
    const row = this.db().prepare("SELECT * FROM community_posts WHERE job_id = ?").get(jobId) as CommunityPostRow | undefined;
    return row ? fromRow(row) : undefined;
  }

  list(limit = 12, cursor?: string) {
    const safeLimit = Math.min(24, Math.max(1, Math.floor(limit)));
    let rows: CommunityPostRow[];
    if (cursor) {
      const cursorPost = this.get(cursor);
      if (!cursorPost) throw new CommunityStoreError(400, "Unknown community cursor");
      rows = this.db().prepare(`
        SELECT * FROM community_posts
        WHERE created_at < ? OR (created_at = ? AND id < ?)
        ORDER BY created_at DESC, id DESC
        LIMIT ?
      `).all(cursorPost.createdAt, cursorPost.createdAt, cursorPost.id, safeLimit + 1) as CommunityPostRow[];
    } else {
      rows = this.db().prepare(`
        SELECT * FROM community_posts
        ORDER BY created_at DESC, id DESC
        LIMIT ?
      `).all(safeLimit + 1) as CommunityPostRow[];
    }
    const hasMore = rows.length > safeLimit;
    const items = rows.slice(0, safeLimit).map(fromRow);
    return {items, nextCursor: hasMore ? items.at(-1)?.id : undefined};
  }

  count() {
    const row = this.db().prepare("SELECT COUNT(*) AS count FROM community_posts").get() as {count: number};
    return row.count;
  }
}

export const communityStore = new CommunityStore();
