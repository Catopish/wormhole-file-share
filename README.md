# wormhole

Zero-knowledge, wormhole-style file sharing. A phrase is the only key; it never
leaves the browser, so the server, the storage, and the operator all hold only
ciphertext. Homelab carries baseline load for free; AWS EC2 is rented as burst
capacity behind a NixOS nginx.

## Layout

- `frontend/` — static React. WebCrypto: 6-word phrase → Argon2id → AES-256-GCM.
  Encrypts file + filename client-side, uploads ciphertext, shows the phrase.
- `backend/` — Rust/Axum. Ciphertext pipe to/from S3, Redis metadata
  (`hash(words) → {s3_key, salt, enc_name}`, TTL 24h), rate-limited lookup,
  `/metrics` in-flight count. Identical binary on homelab + EC2.
- `autoscaler/` — Rust systemd service on the VPS. Scrapes `/metrics`, starts/stops
  EC2, rewrites the nginx upstream include, reloads nginx.

## Local dev

`docker compose up` brings up Redis + MinIO + the backend, then:

```
cd frontend && npm install && npm run dev
```

MinIO stands in for S3; the bucket and 24h lifecycle rule are created on start.

## What crosses the wire

Upload sends only: a SHA-256 hash of the phrase (lookup handle), a public salt,
the encrypted filename, and the ciphertext blob. The words and the key stay in
the tab. Lose the words → the file is unrecoverable, by design.
