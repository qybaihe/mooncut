import {createHash, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual} from "node:crypto";
import {mkdirSync} from "node:fs";
import {dirname} from "node:path";
import {promisify} from "node:util";
import {DatabaseSync} from "node:sqlite";
import {config} from "./config.ts";

const scrypt = promisify(scryptCallback);
const SESSION_COOKIE = "mooncut_session";

export type AuthUser = {
  id: string;
  email: string;
  createdAt: string;
};

type UserRow = {
  id: string;
  email: string;
  password_hash: string;
  password_salt: string;
  created_at: string;
};

type SessionUserRow = UserRow & {expires_at: string};

export class AuthError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const publicUser = (row: UserRow): AuthUser => ({
  id: row.id,
  email: row.email,
  createdAt: row.created_at,
});

const normalizeEmail = (value: string) => value.trim().toLowerCase();

export const validateCredentials = (emailValue: unknown, password: unknown) => {
  if (typeof emailValue !== "string" || typeof password !== "string") {
    throw new AuthError(400, "INVALID_CREDENTIALS", "请输入邮箱和密码");
  }
  const email = normalizeEmail(emailValue);
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) {
    throw new AuthError(400, "INVALID_EMAIL", "请输入有效的邮箱地址");
  }
  if (password.length < 8 || password.length > 128) {
    throw new AuthError(400, "INVALID_PASSWORD", "密码长度需要在 8 到 128 个字符之间");
  }
  return {email, password};
};

const hashSessionToken = (token: string) => createHash("sha256").update(token).digest("hex");

const hashPassword = async (password: string, salt: Buffer) => {
  const derived = await scrypt(password, salt, 64) as Buffer;
  return derived.toString("hex");
};

const passwordMatches = async (password: string, row: UserRow) => {
  const actual = Buffer.from(await hashPassword(password, Buffer.from(row.password_salt, "hex")), "hex");
  const expected = Buffer.from(row.password_hash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
};

export class AuthStore {
  private database?: DatabaseSync;
  private readonly path: string;
  private readonly sessionDays: number;

  constructor(path = config.databasePath, sessionDays = config.sessionDays) {
    this.path = path;
    this.sessionDays = sessionDays;
  }

  private db() {
    if (this.database) return this.database;
    mkdirSync(dirname(this.path), {recursive: true});
    const database = new DatabaseSync(this.path);
    database.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;");
    database.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE COLLATE NOCASE,
        password_hash TEXT NOT NULL,
        password_salt TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions(user_id);
      CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions(expires_at);
    `);
    const version = database.prepare("PRAGMA user_version").get() as {user_version: number};
    if (version.user_version < 2) database.exec("PRAGMA user_version = 2;");
    this.database = database;
    return database;
  }

  close() {
    this.database?.close();
    this.database = undefined;
  }

  async register(emailValue: unknown, passwordValue: unknown) {
    const {email, password} = validateCredentials(emailValue, passwordValue);
    const salt = randomBytes(16);
    const passwordHash = await hashPassword(password, salt);
    const row: UserRow = {
      id: randomUUID().replaceAll("-", ""),
      email,
      password_hash: passwordHash,
      password_salt: salt.toString("hex"),
      created_at: new Date().toISOString(),
    };
    try {
      this.db().prepare(`
        INSERT INTO users (id, email, password_hash, password_salt, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(row.id, row.email, row.password_hash, row.password_salt, row.created_at);
    } catch (error) {
      if (error instanceof Error && /UNIQUE constraint failed: users\.email/iu.test(error.message)) {
        throw new AuthError(409, "EMAIL_EXISTS", "这个邮箱已经注册，可以直接登录");
      }
      throw error;
    }
    return {user: publicUser(row), sessionToken: this.createSession(row.id)};
  }

  async login(emailValue: unknown, passwordValue: unknown) {
    const {email, password} = validateCredentials(emailValue, passwordValue);
    const row = this.db().prepare("SELECT * FROM users WHERE email = ? COLLATE NOCASE").get(email) as UserRow | undefined;
    if (!row || !(await passwordMatches(password, row))) {
      throw new AuthError(401, "LOGIN_FAILED", "邮箱或密码不正确");
    }
    return {user: publicUser(row), sessionToken: this.createSession(row.id)};
  }

  private createSession(userId: string) {
    const token = randomBytes(32).toString("base64url");
    const createdAt = new Date();
    const expiresAt = new Date(createdAt.getTime() + this.sessionDays * 86_400_000);
    this.db().prepare(`
      INSERT INTO sessions (token_hash, user_id, created_at, expires_at, last_seen_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(hashSessionToken(token), userId, createdAt.toISOString(), expiresAt.toISOString(), createdAt.toISOString());
    return token;
  }

  getUserBySession(token: string | undefined) {
    if (!token || token.length > 256) return undefined;
    const now = new Date().toISOString();
    const row = this.db().prepare(`
      SELECT users.*, sessions.expires_at
      FROM sessions JOIN users ON users.id = sessions.user_id
      WHERE sessions.token_hash = ? AND sessions.expires_at > ?
    `).get(hashSessionToken(token), now) as SessionUserRow | undefined;
    if (!row) return undefined;
    this.db().prepare("UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?")
      .run(now, hashSessionToken(token));
    return publicUser(row);
  }

  deleteSession(token: string | undefined) {
    if (!token || token.length > 256) return;
    this.db().prepare("DELETE FROM sessions WHERE token_hash = ?").run(hashSessionToken(token));
  }

  deleteExpiredSessions() {
    return this.db().prepare("DELETE FROM sessions WHERE expires_at <= ?").run(new Date().toISOString()).changes;
  }
}

export const parseSessionCookie = (header: string | undefined) => {
  if (!header) return undefined;
  for (const item of header.split(";")) {
    const separator = item.indexOf("=");
    if (separator < 0) continue;
    if (item.slice(0, separator).trim() === SESSION_COOKIE) return decodeURIComponent(item.slice(separator + 1).trim());
  }
  return undefined;
};

export const sessionCookie = (token: string, secure = config.cookieSecure) => [
  `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
  "HttpOnly",
  "SameSite=Lax",
  "Path=/",
  `Max-Age=${config.sessionDays * 86_400}`,
  ...(secure ? ["Secure"] : []),
].join("; ");

export const clearSessionCookie = (secure = config.cookieSecure) => [
  `${SESSION_COOKIE}=`,
  "HttpOnly",
  "SameSite=Lax",
  "Path=/",
  "Max-Age=0",
  ...(secure ? ["Secure"] : []),
].join("; ");

export const authStore = new AuthStore();
