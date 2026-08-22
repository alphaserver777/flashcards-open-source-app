import assert from "node:assert/strict";
import test from "node:test";
import {
  createProfessorITAuthRoutes,
  verifyProfessorITSessionToken,
} from "./professorit";

const requiredEnvironment = {
  PROFESSORIT_LMS_BASE_URL: "https://academy.example.test",
  PROFESSORIT_OAUTH_CLIENT_ID: "cards-client",
  PROFESSORIT_OAUTH_CLIENT_SECRET: "cards-secret",
  PROFESSORIT_APP_BASE_URL: "https://professorit.example.test/cards",
  PROFESSORIT_OAUTH_CALLBACK_URL: "https://professorit.example.test/cards/v1/auth/callback",
  PROFESSORIT_COOKIE_PATH: "/cards",
  PROFESSORIT_SESSION_SECRET: "session-signing-secret-for-tests",
};

function setProfessorITEnvironment(): void {
  Object.assign(process.env, requiredEnvironment);
}

function getCookieValue(header: string, name: string): string {
  const match = header.match(new RegExp(`${name}=([^;]+)`));
  if (match === null) {
    assert.fail(`Cookie ${name} is missing`);
  }
  return decodeURIComponent(match[1] ?? "");
}

test("Professor IT login exchanges the LMS code and creates a signed session", { concurrency: false }, async () => {
  setProfessorITEnvironment();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.endsWith(".get_token")) {
      assert.equal(init?.method, "POST");
      return Response.json({ message: { access_token: "lms-access-token" } });
    }
    if (url.endsWith(".openid_profile")) {
      assert.equal((init?.headers as Record<string, string>).authorization, "Bearer lms-access-token");
      return Response.json({ message: { sub: "lms-user-42", email: "Student@Example.Test", name: "Иван Иванов" } });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };

  try {
    const app = createProfessorITAuthRoutes();
    const login = await app.request("https://professorit.example.test/auth/login?redirect_uri=https%3A%2F%2Fprofessorit.example.test%2Fcards%2Freview");
    assert.equal(login.status, 302);
    const authorize = new URL(login.headers.get("location") ?? "");
    assert.equal(authorize.origin, "https://academy.example.test");
    assert.equal(authorize.searchParams.get("client_id"), "cards-client");
    const stateCookie = login.headers.get("set-cookie") ?? "";
    assert.match(stateCookie, /professorit_oauth_state=/);

    const callback = await app.request(
      `https://professorit.example.test/auth/callback?code=code-42&state=${encodeURIComponent(authorize.searchParams.get("state") ?? "")}`,
      { headers: { cookie: `professorit_oauth_state=${getCookieValue(stateCookie, "professorit_oauth_state")}` } },
    );
    assert.equal(callback.status, 302);
    assert.equal(callback.headers.get("location"), "https://professorit.example.test/cards/review");
    const sessionCookie = callback.headers.get("set-cookie") ?? "";
    assert.match(sessionCookie, /session=/);
    const identity = await verifyProfessorITSessionToken(getCookieValue(sessionCookie, "session"));
    assert.deepEqual(identity, { userId: "lms-user-42", email: "student@example.test", cognitoUsername: "Иван Иванов" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Professor IT uses a stable email fallback when LMS does not expose an OpenID subject", { concurrency: false }, async () => {
  setProfessorITEnvironment();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.endsWith(".get_token")) return Response.json({ message: { access_token: "lms-access-token" } });
    if (url.endsWith(".openid_profile")) return Response.json({ message: { email: "student@example.test", name: "Student" } });
    throw new Error(`Unexpected fetch: ${url}`);
  };

  try {
    const app = createProfessorITAuthRoutes();
    const login = await app.request("https://professorit.example.test/auth/login");
    const authorize = new URL(login.headers.get("location") ?? "");
    const stateCookie = login.headers.get("set-cookie") ?? "";
    const callback = await app.request(
      `https://professorit.example.test/auth/callback?code=code-42&state=${encodeURIComponent(authorize.searchParams.get("state") ?? "")}`,
      { headers: { cookie: `professorit_oauth_state=${getCookieValue(stateCookie, "professorit_oauth_state")}` } },
    );
    const identity = await verifyProfessorITSessionToken(getCookieValue(callback.headers.get("set-cookie") ?? "", "session"));
    assert.equal(identity.userId, "frappe:student@example.test");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
