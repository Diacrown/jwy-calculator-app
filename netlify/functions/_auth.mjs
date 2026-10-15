import crypto from "node:crypto";
import { getStore } from "@netlify/blobs";

// Developer-console authentication.
//  * The secret lives ONLY in the Netlify environment variable DEV_ADMIN_TOKEN
//    (METAL_ADMIN_TOKEN is still accepted so an existing setup keeps working).
//    It is never in the code, the repo, or the browser bundle.
//  * If the variable is missing or shorter than 16 characters, every request
//    is refused -- the console cannot be used with a weak or absent secret.
//  * The comparison is constant-time, and after 5 wrong attempts within
//    15 minutes all attempts are blocked for the rest of that window.
export const MAX_FAILS = 5;
export const WINDOW_MS = 15 * 60 * 1000;
export const MIN_TOKEN_LEN = 16;

const digest = (s) => crypto.createHash("sha256").update(String(s)).digest();

export function configuredToken(env = process.env) {
  return env.DEV_ADMIN_TOKEN || env.METAL_ADMIN_TOKEN || "";
}

/**
 * Returns { ok:true } or { ok:false, status, error }.
 * `lockStore` is any object with get/setJSON (a Netlify Blobs store in production).
 */
export async function authorize(req, { env = process.env, lockStore = null, now = Date.now() } = {}) {
  const expected = configuredToken(env);
  if (expected.length < MIN_TOKEN_LEN) {
    return { ok: false, status: 503, error: "Developer console is not set up on this site (admin token missing or too short)." };
  }
  const store = lockStore || getStore("admin-security");
  let fails = [];
  try {
    const doc = await store.get("fails", { type: "json" });
    if (doc && Array.isArray(doc.at)) fails = doc.at.filter((t) => now - t < WINDOW_MS);
  } catch {}
  if (fails.length >= MAX_FAILS) {
    return { ok: false, status: 429, error: "Too many wrong attempts. Try again in about 15 minutes." };
  }
  const given = req.headers.get("x-admin-token") || "";
  const same = crypto.timingSafeEqual(digest(given), digest(expected));
  if (!same) {
    fails.push(now);
    try { await store.setJSON("fails", { at: fails }); } catch {}
    return { ok: false, status: 401, error: "Wrong token." };
  }
  if (fails.length) {
    try { await store.setJSON("fails", { at: [] }); } catch {}
  }
  return { ok: true };
}
