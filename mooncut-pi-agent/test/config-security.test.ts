import assert from "node:assert/strict";
import test from "node:test";
import {
  DEVELOPMENT_CAPABILITY_SIGNING_KEY,
  assertPublicDeploymentSecurity,
  isLoopbackHost,
  publicDeploymentSecurityErrors,
} from "../src/config.ts";

const securePublicSettings = {
  host: "0.0.0.0",
  apiKeys: ["mooncut_test_key_0123456789abcdef"],
  capabilitySigningKey: "a-long-unique-test-signing-key",
  cookieSecure: true,
};

test("loopback includes localhost, IPv4, and IPv6 only", () => {
  assert.equal(isLoopbackHost("localhost"), true);
  assert.equal(isLoopbackHost("127.0.0.1"), true);
  assert.equal(isLoopbackHost("[::1]"), true);
  assert.equal(isLoopbackHost("0.0.0.0"), false);
  assert.equal(isLoopbackHost("10.0.0.8"), false);
});

test("public bindings fail closed without real credentials and secure cookies", () => {
  const errors = publicDeploymentSecurityErrors({
    host: "0.0.0.0",
    apiKeys: [],
    capabilitySigningKey: DEVELOPMENT_CAPABILITY_SIGNING_KEY,
    cookieSecure: false,
  });
  assert.equal(errors.length, 3);
  assert.throws(
    () => assertPublicDeploymentSecurity({
      host: "0.0.0.0",
      apiKeys: [],
      capabilitySigningKey: DEVELOPMENT_CAPABILITY_SIGNING_KEY,
      cookieSecure: false,
    }),
    /Unsafe MoonCut public deployment/u,
  );
});

test("secure public and local Studio configurations remain valid", () => {
  assert.deepEqual(publicDeploymentSecurityErrors(securePublicSettings), []);
  assert.doesNotThrow(() => assertPublicDeploymentSecurity(securePublicSettings));
  assert.deepEqual(publicDeploymentSecurityErrors({...securePublicSettings, host: "127.0.0.1", apiKeys: []}), []);
});
