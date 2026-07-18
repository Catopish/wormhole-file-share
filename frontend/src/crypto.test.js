import { describe, it, expect } from "vitest";
import {
  generatePhrase,
  normalizePhrase,
  phraseId,
  sealFile,
  openFile,
  b64,
  unb64,
} from "./crypto.js";

// Minimal File stand-in: crypto.js only calls .arrayBuffer() and reads .name.
class FakeFile {
  constructor(bytes, name) {
    this._b = bytes;
    this.name = name;
    this.size = bytes.length;
  }
  async arrayBuffer() {
    return this._b.buffer.slice(
      this._b.byteOffset,
      this._b.byteOffset + this._b.byteLength
    );
  }
}

function bytesOf(str) {
  return new TextEncoder().encode(str);
}

describe("phrase generation", () => {
  it("produces 6 dash-joined words", () => {
    const p = generatePhrase();
    expect(p.split("-")).toHaveLength(6);
  });

  it("is effectively unique across calls", () => {
    const seen = new Set();
    for (let i = 0; i < 200; i++) seen.add(generatePhrase());
    expect(seen.size).toBe(200);
  });
});

describe("normalizePhrase", () => {
  it("collapses spacing and casing to the canonical form", () => {
    const canonical = "energy-fix-merry-puzzle-unit-horse";
    expect(normalizePhrase("  Energy fix   MERRY puzzle-unit  horse ")).toBe(
      canonical
    );
    expect(normalizePhrase(canonical)).toBe(canonical);
  });
});

describe("base64 helpers", () => {
  it("round-trip arbitrary bytes", () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 255, 128, 64]);
    expect([...unb64(b64(bytes))]).toEqual([...bytes]);
  });
});

describe("sealFile / openFile", () => {
  it("round-trips file bytes and filename", async () => {
    const payload = bytesOf("secret payload ".repeat(500));
    const file = new FakeFile(payload, "report.pdf");
    const phrase = generatePhrase();

    const sealed = await sealFile(file, phrase);
    const { filename, fileBytes } = await openFile(
      sealed.blob.buffer,
      phrase,
      sealed.salt,
      sealed.encName
    );

    expect(filename).toBe("report.pdf");
    expect([...fileBytes]).toEqual([...payload]);
  });

  it("id is reproducible from a normalized phrase (send vs receive path)", async () => {
    const file = new FakeFile(bytesOf("x"), "a.txt");
    const phrase = generatePhrase();
    const sealed = await sealFile(file, phrase);

    const messy = phrase.split("-").join("  ").toUpperCase();
    expect(await phraseId(normalizePhrase(messy))).toBe(sealed.id);
  });

  it("the id is a 64-char hex string and leaks no words", async () => {
    const file = new FakeFile(bytesOf("x"), "a.txt");
    const phrase = generatePhrase();
    const sealed = await sealFile(file, phrase);

    expect(sealed.id).toMatch(/^[0-9a-f]{64}$/);
    for (const word of phrase.split("-")) {
      expect(sealed.id).not.toContain(word);
    }
  });

  it("ciphertext contains no plaintext of the file or name", async () => {
    const marker = "TOP-SECRET-MARKER-STRING";
    const file = new FakeFile(bytesOf(marker.repeat(20)), marker + ".txt");
    const sealed = await sealFile(file, generatePhrase());

    const blobText = new TextDecoder().decode(sealed.blob);
    expect(blobText).not.toContain(marker);
    expect(unb64(sealed.encName)).not.toContain(marker); // encName is ciphertext
  });

  it("a wrong phrase fails to decrypt — no plaintext leak", async () => {
    const file = new FakeFile(bytesOf("confidential"), "secret.txt");
    const phrase = generatePhrase();
    const sealed = await sealFile(file, phrase);

    let wrongWord;
    do {
      wrongWord = generatePhrase();
    } while (wrongWord === phrase);

    await expect(
      openFile(sealed.blob.buffer, wrongWord, sealed.salt, sealed.encName)
    ).rejects.toThrow();
  });

  it("a tampered ciphertext byte is rejected (AES-GCM integrity)", async () => {
    const file = new FakeFile(bytesOf("integrity matters"), "x.txt");
    const phrase = generatePhrase();
    const sealed = await sealFile(file, phrase);

    // Flip a byte well past the 12-byte IV, inside the ciphertext.
    sealed.blob[20] ^= 0xff;
    await expect(
      openFile(sealed.blob.buffer, phrase, sealed.salt, sealed.encName)
    ).rejects.toThrow();
  });
});
