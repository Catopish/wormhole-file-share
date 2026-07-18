import { webcrypto } from "node:crypto";
if (!globalThis.crypto) globalThis.crypto = webcrypto;
const { generatePhrase, normalizePhrase, phraseId, sealFile, openFile } =
  await import("./src/crypto.js");

const BASE = "http://127.0.0.1:8080/api";
class FakeFile {
  constructor(b, n){ this._b=b; this.name=n; this.size=b.length; }
  async arrayBuffer(){ return this._b.buffer.slice(this._b.byteOffset, this._b.byteOffset+this._b.byteLength); }
}

const payload = new TextEncoder().encode("real S3 bucket wormhole-blobs-dwiesta 🔑 " + new Date().toISOString() + "\n".repeat(50));
const file = new FakeFile(payload, "hello-from-laptop.txt");
const phrase = generatePhrase();
console.log("phrase :", phrase);

const sealed = await sealFile(file, phrase);
let r = await fetch(`${BASE}/upload`, { method:"POST", headers:{
  "x-wh-id":sealed.id, "x-wh-salt":sealed.salt, "x-wh-name":sealed.encName,
  "x-wh-size":String(sealed.size), "content-type":"application/octet-stream" }, body: sealed.blob });
console.log("upload :", r.status, (await r.text()).slice(0,60));
if (!r.ok) { console.log("\nUPLOAD FAILED — likely IAM/S3 permission. Stopping."); process.exit(1); }

const id = await phraseId(normalizePhrase(phrase));
r = await fetch(`${BASE}/lookup`, { method:"POST", headers:{"content-type":"application/json"}, body: JSON.stringify({ id }) });
const meta = await r.json();
console.log("lookup :", r.status);

r = await fetch(`${BASE}/download/${id}`);
const blob = await r.arrayBuffer();
console.log("download:", r.status, blob.byteLength, "bytes");

const { filename, fileBytes } = await openFile(blob, phrase, meta.salt, meta.enc_name);
const ok = filename === "hello-from-laptop.txt" &&
  fileBytes.length === payload.length && fileBytes.every((b,i)=>b===payload[i]);
console.log("decrypt:", filename, ok ? "ROUND-TRIP OK" : "MISMATCH");
console.log(ok ? "\n✅ FULL ORCHESTRA PASS — real S3, real IAM key, crypto round-trip" : "\n❌ FAIL");
