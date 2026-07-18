import { useRef, useState } from "react";
import { generatePhrase, sealFile } from "./crypto.js";
import { upload } from "./api.js";

const MAX_BYTES = 100 * 1024 * 1024;

function fmtSize(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export default function Send() {
  const inputRef = useRef(null);
  const [file, setFile] = useState(null);
  const [over, setOver] = useState(false);
  const [phase, setPhase] = useState("idle"); // idle | encrypting | uploading | done
  const [phrase, setPhrase] = useState("");
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");

  function pick(f) {
    setError("");
    setPhrase("");
    setPhase("idle");
    if (f && f.size > MAX_BYTES) {
      setError(`That file is ${fmtSize(f.size)}. The limit is 100 MB for now.`);
      setFile(null);
      return;
    }
    setFile(f);
  }

  async function send() {
    if (!file) return;
    setError("");
    setCopied(false);
    try {
      const words = generatePhrase();
      setPhase("encrypting");
      const sealed = await sealFile(file, words);
      setPhase("uploading");
      await upload(sealed);
      setPhrase(words);
      setPhase("done");
    } catch (e) {
      setError(e.message || "Upload failed.");
      setPhase("idle");
    }
  }

  const busy = phase === "encrypting" || phase === "uploading";

  return (
    <div className="card">
      {phase !== "done" && (
        <>
          <div
            className={`drop${over ? " over" : ""}`}
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setOver(true); }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => { e.preventDefault(); setOver(false); pick(e.dataTransfer.files[0]); }}
          >
            <div className="big">{file ? "Choose a different file" : "Drop a file, or click to choose"}</div>
            <div className="sub">Encrypted in your browser · 100 MB max · gone in 24h</div>
            <input
              ref={inputRef}
              type="file"
              onChange={(e) => pick(e.target.files[0])}
            />
          </div>

          {file && (
            <div className="filerow" style={{ marginTop: 16 }}>
              <span className="name">{file.name}</span>
              <span className="size">{fmtSize(file.size)}</span>
            </div>
          )}

          <button className="primary" onClick={send} disabled={!file || busy}>
            {busy ? "Working…" : "Encrypt & send"}
          </button>

          {busy && (
            <div className="status">
              <span className="spin" />
              {phase === "encrypting" ? "Deriving key & encrypting locally…" : "Uploading ciphertext…"}
            </div>
          )}
          {error && <div className="err">{error}</div>}
        </>
      )}

      {phase === "done" && (
        <>
          <div className="status ok" style={{ marginTop: 0, marginBottom: 14 }}>
            Sent. Share these words — nothing else can open the file.
          </div>
          <div className="phrase">
            <div className="words">{phrase.split("-").join(" · ")}</div>
            <div className="hint">The recipient types these to download & decrypt.</div>
          </div>
          <button
            className="copybtn"
            onClick={() => {
              navigator.clipboard?.writeText(phrase);
              setCopied(true);
            }}
          >
            {copied ? "Copied ✓" : "Copy phrase"}
          </button>
          <button
            className="primary"
            style={{ marginTop: 16 }}
            onClick={() => { setFile(null); setPhrase(""); setPhase("idle"); }}
          >
            Send another
          </button>
        </>
      )}

      <p className="note">
        <b>Zero-knowledge:</b> the phrase is your only key and it never leaves this
        tab. The server stores encrypted bytes and a one-way hash — it can't read
        the file, and neither can the operator. Lose the words and it's unrecoverable.
      </p>
    </div>
  );
}
