// Web Push with nothing but WebCrypto: the message is encrypted for the browser
// (RFC 8291, aes128gcm) and signed with this server's VAPID key (RFC 8292).
// A VAPID key is a P-256 key pair kept as a JWK; the browser is given its raw public half.

export type Sub = { endpoint: string; p256dh: string; auth: string };
const te = new TextEncoder();
export const b64u = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export const unb64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
const cat = (...a: Uint8Array[]) => { const o = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of a) { o.set(x, i); i += x.length; } return o; };
async function hmac(key: Uint8Array, data: Uint8Array) {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, data));
}

/** A new VAPID key pair, as a private JWK. */
export async function newVapid(): Promise<JsonWebKey> {
  const k = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign"]);
  return await crypto.subtle.exportKey("jwk", k.privateKey);
}
/** The public half, as the browser's applicationServerKey wants it (base64url of the raw point). */
export const vapidPublic = (jwk: JsonWebKey) => b64u(cat(new Uint8Array([4]), unb64u(jwk.x!), unb64u(jwk.y!)));

/** The encrypted body for one browser. salt and the sender key can be given, for tests. */
export async function encrypt(sub: Sub, payload: string, fixed?: { salt: Uint8Array; keys: CryptoKeyPair }) {
  const ua = unb64u(sub.p256dh), auth = unb64u(sub.auth);
  const keys = fixed?.keys ?? await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]) as CryptoKeyPair;
  const asPub = new Uint8Array(await crypto.subtle.exportKey("raw", keys.publicKey));
  const uaKey = await crypto.subtle.importKey("raw", ua, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, keys.privateKey, 256));
  const ikm = await hmac(await hmac(auth, ecdh), cat(te.encode("WebPush: info\0"), ua, asPub, new Uint8Array([1])));
  const salt = fixed?.salt ?? crypto.getRandomValues(new Uint8Array(16));
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, cat(te.encode("Content-Encoding: aes128gcm\0"), new Uint8Array([1])))).slice(0, 16);
  const nonce = (await hmac(prk, cat(te.encode("Content-Encoding: nonce\0"), new Uint8Array([1])))).slice(0, 12);
  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, cat(te.encode(payload), new Uint8Array([2]))));
  const head = new Uint8Array(21); head.set(salt); new DataView(head.buffer).setUint32(16, 4096); head[20] = asPub.length;
  return cat(head, asPub, ct);
}

async function vapidAuth(endpoint: string, jwk: JsonWebKey, subject: string) {
  const enc = (o: unknown) => b64u(te.encode(JSON.stringify(o)));
  const unsigned = `${enc({ typ: "JWT", alg: "ES256" })}.${enc({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject })}`;
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, te.encode(unsigned)));
  return `vapid t=${unsigned}.${b64u(sig)}, k=${vapidPublic(jwk)}`;
}

/** Sends one notification. Returns the push service's status: 201 is sent, 404 or 410 means the browser is gone. */
export async function send(sub: Sub, payload: unknown, jwk: JsonWebKey, subject: string, ttl = 1800): Promise<number> {
  const body = await encrypt(sub, JSON.stringify(payload));
  const res = await fetch(sub.endpoint, {
    method: "POST",
    headers: { "Content-Encoding": "aes128gcm", "Content-Type": "application/octet-stream", TTL: String(ttl), Urgency: "high", Authorization: await vapidAuth(sub.endpoint, jwk, subject) },
    body,
  });
  await res.body?.cancel();
  return res.status;
}
