import assert from "node:assert/strict";
import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import test from "node:test";
import {DatabaseSync} from "node:sqlite";
import {AuthError, AuthStore, clearSessionCookie, parseSessionCookie, sessionCookie} from "../src/auth.ts";
import {RequestRateLimiter} from "../src/server.ts";

test("register, session lookup, logout and case-insensitive login", async () => {
  const directory = await mkdtemp(join(tmpdir(), "mooncut-auth-"));
  const path = join(directory, "mooncut.sqlite");
  const store = new AuthStore(path, 30);
  try {
    const registered = await store.register(" Creator@Example.com ", "correct horse battery staple");
    assert.equal(registered.user.email, "creator@example.com");
    assert.equal(store.getUserBySession(registered.sessionToken)?.id, registered.user.id);

    store.deleteSession(registered.sessionToken);
    assert.equal(store.getUserBySession(registered.sessionToken), undefined);

    const loggedIn = await store.login("CREATOR@example.com", "correct horse battery staple");
    assert.equal(loggedIn.user.id, registered.user.id);

    const database = new DatabaseSync(path);
    const row = database.prepare("SELECT password_hash, password_salt FROM users WHERE id = ?").get(registered.user.id) as {
      password_hash: string;
      password_salt: string;
    };
    assert.notEqual(row.password_hash, "correct horse battery staple");
    assert.equal(row.password_hash.length, 128);
    assert.equal(row.password_salt.length, 32);
    database.close();
  } finally {
    store.close();
    await rm(directory, {recursive: true, force: true});
  }
});

test("duplicate registration and wrong password return safe auth errors", async () => {
  const directory = await mkdtemp(join(tmpdir(), "mooncut-auth-errors-"));
  const store = new AuthStore(join(directory, "mooncut.sqlite"));
  try {
    await store.register("user@example.com", "password-123");
    await assert.rejects(
      store.register("USER@example.com", "password-456"),
      (error) => error instanceof AuthError && error.status === 409 && error.code === "EMAIL_EXISTS",
    );
    await assert.rejects(
      store.login("user@example.com", "password-456"),
      (error) => error instanceof AuthError && error.status === 401 && error.code === "LOGIN_FAILED",
    );
  } finally {
    store.close();
    await rm(directory, {recursive: true, force: true});
  }
});

test("session cookie is HttpOnly and can be parsed and cleared", () => {
  const cookie = sessionCookie("secret token", false);
  assert.match(cookie, /^mooncut_session=secret%20token;/u);
  assert.match(cookie, /HttpOnly/u);
  assert.match(cookie, /SameSite=Lax/u);
  assert.equal(parseSessionCookie(`theme=dark; ${cookie.split(";", 1)[0]}`), "secret token");
  assert.match(clearSessionCookie(false), /Max-Age=0/u);
});

test("auth rate limiter enforces a sliding window and can reset", () => {
  const limiter = new RequestRateLimiter();
  assert.equal(limiter.allow("login:test", 2, 1_000, 1_000), true);
  assert.equal(limiter.allow("login:test", 2, 1_000, 1_100), true);
  assert.equal(limiter.allow("login:test", 2, 1_000, 1_200), false);
  assert.equal(limiter.allow("login:test", 2, 1_000, 2_100), true);
  limiter.reset("login:test");
  assert.equal(limiter.allow("login:test", 2, 1_000, 2_100), true);
});
