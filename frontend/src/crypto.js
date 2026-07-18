import { argon2id } from "hash-wasm";
import { WORDLIST } from "./wordlist.js";

const WORD_COUNT = 6;
const ARGON = { parallelism: 1, iterations: 3, memorySize: 65536 }; // 64 MiB

const enc = new TextEncoder();
const dec = new TextDecoder();

// --- helpers ---------------------------------------------------------------
export function b64(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
export function unb64(str) {
  const s = atob(str);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
function hex(bytes) {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Cryptographically-random phrase. WORD_COUNT words from a large list is the
// only secret in the system, so it's drawn from the CSPRNG, not Math.random.
export function generatePhrase() {
  const idx = new Uint32Array(WORD_COUNT);
  crypto.getRandomValues(idx);
  return Array.from(idx, (n) => WORDLIST[n % WORDLIST.length]).join("-");
}

// The words are normalized the same way on both ends so typing variance
// (spaces vs dashes, casing) still resolves to the same key.
export function normalizePhrase(phrase) {
  return phrase
    .trim()
    .toLowerCase()
    .split(/[\s-]+/)
    .filter(Boolean)
    .join("-");
}

// Lookup handle: one-way, never reveals the words.
export async function phraseId(phrase) {
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(phrase));
  return hex(new Uint8Array(digest));
}

// Argon2id(words, salt) -> AES-256-GCM key. Slow by design so each brute-force
// guess is expensive.
async function deriveKey(phrase, salt) {
  const raw = await argon2id({
    password: phrase,
    salt,
    ...ARGON,
    hashLength: 32,
    outputType: "binary",
  });
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

async function encryptBytes(key, bytes) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, bytes);
  // Prefix the iv so decrypt is self-contained.
  const out = new Uint8Array(iv.length + ct.byteLength);
  out.set(iv, 0);
  out.set(new Uint8Array(ct), iv.length);
  return out;
}

async function decryptBytes(key, packed) {
  const iv = packed.slice(0, 12);
  const ct = packed.slice(12);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
  return new Uint8Array(pt);
}

// --- public API ------------------------------------------------------------

// Encrypt a File for upload. Returns everything the server needs — all opaque.
export async function sealFile(file, phrase) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveKey(phrase, salt);

  const fileBytes = new Uint8Array(await file.arrayBuffer());
  const blob = await encryptBytes(key, fileBytes);
  const encName = await encryptBytes(key, enc.encode(file.name));

  return {
    id: await phraseId(phrase),
    salt: b64(salt),
    encName: b64(encName),
    blob, // Uint8Array of ciphertext, streamed as the request body
    size: blob.byteLength,
  };
}

// Decrypt a downloaded blob given the phrase + the server's metadata.
export async function openFile(blob, phrase, saltB64, encNameB64) {
  const salt = unb64(saltB64);
  const key = await deriveKey(phrase, salt);
  const filename = dec.decode(await decryptBytes(key, unb64(encNameB64)));
  const fileBytes = await decryptBytes(key, new Uint8Array(blob));
  return { filename, fileBytes };
}
