const BASE = "/api";

export async function upload({ id, salt, encName, blob, size }) {
  const res = await fetch(`${BASE}/upload`, {
    method: "POST",
    headers: {
      "x-wh-id": id,
      "x-wh-salt": salt,
      "x-wh-name": encName,
      "x-wh-size": String(size),
      "content-type": "application/octet-stream",
    },
    body: blob,
  });
  if (!res.ok) throw new Error(await errMsg(res));
  return res.json();
}

export async function lookup(id) {
  const res = await fetch(`${BASE}/lookup`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id }),
  });
  if (res.status === 404) throw new Error("No file for that phrase — it may have expired.");
  if (res.status === 429) throw new Error("Too many attempts. Wait a moment and try again.");
  if (!res.ok) throw new Error(await errMsg(res));
  return res.json();
}

export async function download(id) {
  const res = await fetch(`${BASE}/download/${id}`);
  if (!res.ok) throw new Error(await errMsg(res));
  return res.arrayBuffer();
}

// Load-test request. Sends `bytes` to the drain-and-discard endpoint and
// returns which node served it ("homelab" / "ec2"). Nothing is stored.
export async function benchmark(bytes, timeoutMs = 20000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${BASE}/benchmark`, {
      method: "POST",
      headers: { "content-type": "application/octet-stream" },
      body: bytes,
      signal: ctrl.signal,
    });
    if (res.status === 429) throw new Error("rate limited");
    if (!res.ok) throw new Error(`benchmark failed (${res.status})`);
    // Prefer the header (available without reading the body).
    const served = res.headers.get("x-served-by");
    // Drain the (tiny) response so the connection frees for reuse.
    await res.text();
    return served || "unknown";
  } finally {
    clearTimeout(t);
  }
}

async function errMsg(res) {
  try {
    const j = await res.json();
    return j.error || `Request failed (${res.status})`;
  } catch {
    return `Request failed (${res.status})`;
  }
}
