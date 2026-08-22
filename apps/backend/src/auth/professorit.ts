import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import { setCookie } from "hono/cookie";
import type { AuthenticatedUserIdentity } from "./index";
import type { AppEnv } from "../server/appEnv";
import { HttpError } from "../shared/errors";

type ProfessorITAuthConfig = Readonly<{
  lmsBaseUrl: string;
  clientId: string;
  clientSecret: string;
  appBaseUrl: string;
  callbackUrl: string;
  cookiePath: string;
  sessionSecret: string;
}>;

type SessionPayload = Readonly<{
  sub: string;
  email: string;
  name: string;
  exp: number;
}>;

const stateCookieName = "professorit_oauth_state";
const sessionCookieName = "session";
const stateLifetimeSeconds = 10 * 60;
const sessionLifetimeSeconds = 8 * 60 * 60;

function readRequiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (value === undefined || value === "") {
    throw new Error(`${name} is required when AUTH_MODE=professorit`);
  }
  return value;
}

function normalizeUrl(value: string, name: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${name} must be an absolute URL`);
  }
  if (parsed.protocol !== "https:") {
    throw new Error(`${name} must use HTTPS`);
  }
  return parsed.toString().replace(/\/$/u, "");
}

export function getProfessorITAuthConfig(): ProfessorITAuthConfig {
  const lmsBaseUrl = normalizeUrl(readRequiredEnvironment("PROFESSORIT_LMS_BASE_URL"), "PROFESSORIT_LMS_BASE_URL");
  const appBaseUrl = normalizeUrl(readRequiredEnvironment("PROFESSORIT_APP_BASE_URL"), "PROFESSORIT_APP_BASE_URL");
  const callbackUrl = normalizeUrl(readRequiredEnvironment("PROFESSORIT_OAUTH_CALLBACK_URL"), "PROFESSORIT_OAUTH_CALLBACK_URL");
  if (!callbackUrl.startsWith(`${appBaseUrl}/v1/auth/`)) {
    throw new Error("PROFESSORIT_OAUTH_CALLBACK_URL must be under PROFESSORIT_APP_BASE_URL/v1/auth/");
  }
  return {
    lmsBaseUrl,
    clientId: readRequiredEnvironment("PROFESSORIT_OAUTH_CLIENT_ID"),
    clientSecret: readRequiredEnvironment("PROFESSORIT_OAUTH_CLIENT_SECRET"),
    appBaseUrl,
    callbackUrl,
    cookiePath: process.env.PROFESSORIT_COOKIE_PATH?.trim() || "/cards",
    sessionSecret: readRequiredEnvironment("PROFESSORIT_SESSION_SECRET"),
  };
}

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function decode(value: string): unknown {
  return JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as unknown;
}

function sign(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

function isSignedValueValid(value: string, signature: string, secret: string): boolean {
  const expected = sign(value, secret);
  return expected.length === signature.length && timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

function createSignedToken(payload: SessionPayload, secret: string): string {
  const encodedPayload = encode(payload);
  return `${encodedPayload}.${sign(encodedPayload, secret)}`;
}

function parseSessionToken(token: string): SessionPayload {
  const [encodedPayload, signature, ...rest] = token.split(".");
  if (encodedPayload === undefined || signature === undefined || rest.length !== 0) {
    throw new HttpError(401, "Invalid Professor IT session");
  }
  const config = getProfessorITAuthConfig();
  if (!isSignedValueValid(encodedPayload, signature, config.sessionSecret)) {
    throw new HttpError(401, "Invalid Professor IT session");
  }
  let payload: unknown;
  try {
    payload = decode(encodedPayload);
  } catch {
    throw new HttpError(401, "Invalid Professor IT session");
  }
  if (typeof payload !== "object" || payload === null) {
    throw new HttpError(401, "Invalid Professor IT session");
  }
  const record = payload as Record<string, unknown>;
  if (typeof record.sub !== "string" || typeof record.email !== "string" || typeof record.name !== "string" || typeof record.exp !== "number") {
    throw new HttpError(401, "Invalid Professor IT session");
  }
  if (record.exp <= Math.floor(Date.now() / 1000)) {
    throw new HttpError(401, "Professor IT session expired");
  }
  return { sub: record.sub, email: record.email, name: record.name, exp: record.exp };
}

export async function verifyProfessorITSessionToken(token: string): Promise<AuthenticatedUserIdentity> {
  const payload = parseSessionToken(token);
  return { userId: payload.sub, email: payload.email, cognitoUsername: payload.name };
}

function getCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (header === null) return null;
  for (const item of header.split(";")) {
    const [key, ...parts] = item.trim().split("=");
    if (key === name) return decodeURIComponent(parts.join("="));
  }
  return null;
}

function writeCookie(context: Parameters<typeof setCookie>[0], name: string, value: string, path: string, maxAge: number): void {
  setCookie(context, name, value, { path, maxAge, httpOnly: true, secure: true, sameSite: "Lax" });
}

function removeCookie(context: Parameters<typeof setCookie>[0], name: string, path: string): void {
  setCookie(context, name, "", { path, maxAge: 0, httpOnly: true, secure: true, sameSite: "Lax" });
}

function assertReturnUrl(value: string | null, config: ProfessorITAuthConfig): string {
  const fallback = `${config.appBaseUrl}/`;
  if (value === null || value === "") return fallback;
  let target: URL;
  try {
    target = new URL(value);
  } catch {
    return fallback;
  }
  if (!target.toString().startsWith(`${config.appBaseUrl}/`)) return fallback;
  return target.toString();
}

type OAuthState = Readonly<{ nonce: string; returnUrl: string; expiresAt: number }>;

function createState(returnUrl: string): OAuthState {
  return { nonce: randomBytes(24).toString("base64url"), returnUrl, expiresAt: Math.floor(Date.now() / 1000) + stateLifetimeSeconds };
}

function readState(value: string, secret: string): OAuthState | null {
  const [encodedPayload, signature, ...rest] = value.split(".");
  if (encodedPayload === undefined || signature === undefined || rest.length !== 0 || !isSignedValueValid(encodedPayload, signature, secret)) return null;
  try {
    const parsed = decode(encodedPayload) as Record<string, unknown>;
    if (typeof parsed.nonce !== "string" || typeof parsed.returnUrl !== "string" || typeof parsed.expiresAt !== "number" || parsed.expiresAt <= Math.floor(Date.now() / 1000)) return null;
    return { nonce: parsed.nonce, returnUrl: parsed.returnUrl, expiresAt: parsed.expiresAt };
  } catch {
    return null;
  }
}

function unwrapMessage(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null) throw new Error("LMS returned an invalid OAuth response");
  const record = value as Record<string, unknown>;
  return typeof record.message === "object" && record.message !== null ? record.message as Record<string, unknown> : record;
}

async function exchangeCode(code: string, config: ProfessorITAuthConfig): Promise<AuthenticatedUserIdentity> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: config.callbackUrl,
  });
  const tokenResponse = await fetch(`${config.lmsBaseUrl}/api/method/frappe.integrations.oauth2.get_token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body,
  });
  if (!tokenResponse.ok) throw new Error("LMS rejected OAuth code exchange");
  const tokenData = unwrapMessage(await tokenResponse.json());
  const accessToken = typeof tokenData.access_token === "string" ? tokenData.access_token : "";
  if (accessToken === "") throw new Error("LMS OAuth response did not contain an access token");
  const profileResponse = await fetch(`${config.lmsBaseUrl}/api/method/frappe.integrations.oauth2.openid_profile`, {
    headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" },
  });
  if (!profileResponse.ok) throw new Error("LMS did not return a user profile");
  const profile = unwrapMessage(await profileResponse.json());
  const email = typeof profile.email === "string" ? profile.email.trim().toLowerCase() : "";
  if (email === "") throw new Error("LMS user profile does not contain an email");
  const stableSubject = typeof profile.sub === "string" && profile.sub.trim() !== "" ? profile.sub.trim() : `frappe:${email}`;
  const name = typeof profile.name === "string" && profile.name.trim() !== "" ? profile.name.trim() : email;
  return { userId: stableSubject, email, cognitoUsername: name };
}

export function createProfessorITAuthRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>({ strict: false });
  app.get("/auth/login", (context) => {
    const config = getProfessorITAuthConfig();
    const returnUrl = assertReturnUrl(context.req.query("redirect_uri") ?? null, config);
    const state = createState(returnUrl);
    const encodedState = encode(state);
    const signedState = `${encodedState}.${sign(encodedState, config.sessionSecret)}`;
    const authorizationUrl = new URL(`${config.lmsBaseUrl}/api/method/frappe.integrations.oauth2.authorize`);
    authorizationUrl.searchParams.set("response_type", "code");
    authorizationUrl.searchParams.set("client_id", config.clientId);
    authorizationUrl.searchParams.set("redirect_uri", config.callbackUrl);
    authorizationUrl.searchParams.set("scope", "openid");
    authorizationUrl.searchParams.set("state", state.nonce);
    writeCookie(context, stateCookieName, signedState, `${config.cookiePath}/v1/auth`, stateLifetimeSeconds);
    return context.redirect(authorizationUrl.toString(), 302);
  });
  app.get("/auth/callback", async (context) => {
    const config = getProfessorITAuthConfig();
    const storedState = getCookie(context.req.raw, stateCookieName);
    const state = storedState === null ? null : readState(storedState, config.sessionSecret);
    if (state === null || context.req.query("state") !== state.nonce) return context.text("Невозможно подтвердить вход. Начните вход заново.", 400);
    const code = context.req.query("code");
    if (code === undefined || code === "") return context.text("LMS не передала код входа.", 400);
    const identity = await exchangeCode(code, config);
    const session = createSignedToken({ sub: identity.userId, email: identity.email, name: identity.cognitoUsername ?? identity.email, exp: Math.floor(Date.now() / 1000) + sessionLifetimeSeconds }, config.sessionSecret);
    removeCookie(context, stateCookieName, `${config.cookiePath}/v1/auth`);
    writeCookie(context, sessionCookieName, session, config.cookiePath, sessionLifetimeSeconds);
    return context.redirect(state.returnUrl, 302);
  });
  app.post("/auth/api/refresh-session", async (context) => {
    const token = getCookie(context.req.raw, sessionCookieName);
    if (token === null) return context.text("", 401);
    await verifyProfessorITSessionToken(token);
    return context.body(null, 204);
  });
  app.get("/auth/logout", (context) => {
    const config = getProfessorITAuthConfig();
    removeCookie(context, sessionCookieName, config.cookiePath);
    return context.redirect(assertReturnUrl(context.req.query("redirect_uri") ?? null, config), 302);
  });
  return app;
}
