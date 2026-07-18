import { useState } from "react";
import { normalizePhrase, phraseId, openFile } from "./crypto.js";
import { lookup, download } from "./api.js";

export default function Receive() {
  const [input, setInput] = useState("");
  const [phase, setPhase] = useState("idle"); // idle | working | done
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);

  async function fetchIt(e) {
    e.preventDefault();
    setError("");
    setResult(null);
    const phrase = normalizePhrase(input);
    if (phrase.split("-").length < 4) {
      setError("That doesn't look like a full phrase.");
      return;
    }
    try {
      setPhase("working");
      const id = await phraseId(phrase);
      const meta = await lookup(id);
      const blob = await download(id);
      const { filename, fileBytes } = await openFile(
        blob, phrase, meta.salt, meta.enc_name
      );
      setResult({ filename, fileBytes });
      setPhase("done");
    } catch (e) {
      // A decrypt failure means wrong words, not a server problem.
      const msg = /operation-specific reason|decrypt/i.test(e.message || "")
        ? "Those words didn't decrypt the file — check the phrase."
        : e.message || "Download failed.";
      setError(msg);
      setPhase("idle");
    }
  }

  function save() {
    const blob = new Blob([result.fileBytes]);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = result.filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="card">
      <form onSubmit={fetchIt}>
        <div className="field">
          <label htmlFor="phrase">Enter the phrase</label>
          <input
            id="phrase"
            placeholder="six words separated by spaces"
            value={input}
            autoComplete="off"
            spellCheck="false"
            onChange={(e) => setInput(e.target.value)}
          />
        </div>
        <button className="primary" type="submit" disabled={phase === "working"}>
          {phase === "working" ? "Working…" : "Fetch & decrypt"}
        </button>
      </form>

      {phase === "working" && (
        <div className="status">
          <span className="spin" />
          Looking up, downloading & decrypting locally…
        </div>
      )}
      {error && <div className="err">{error}</div>}

      {phase === "done" && result && (
        <>
          <div className="status ok" style={{ marginBottom: 14 }}>
            Decrypted in your browser.
          </div>
          <div className="filerow">
            <span className="name">{result.filename}</span>
            <span className="size">{(result.fileBytes.length / 1024 / 1024).toFixed(1)} MB</span>
          </div>
          <button className="primary" onClick={save}>Save file</button>
        </>
      )}

      <p className="note">
        The phrase is turned into a key <b>here</b>, then used to decrypt the bytes
        after they arrive. The server never sees the words or the key. Wrong words
        simply fail to decrypt — there's no way to tell it "close."
      </p>
    </div>
  );
}
