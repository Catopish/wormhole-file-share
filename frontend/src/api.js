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

async function errMsg(res) {
  try {
    const j = await res.json();
    return j.error || `Request failed (${res.status})`;
  } catch {
    return `Request failed (${res.status})`;
  }
}
