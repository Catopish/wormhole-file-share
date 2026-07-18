# wormhole

A personal project exploring a **hybrid homelab + AWS** setup: a real,
end-to-end deployment that runs on my own hardware for free and rents AWS
services only when it needs to burst. Built as a hands-on way to integrate
several AWS pieces (S3, EC2, IAM roles/users) with a self-hosted NixOS fleet.

The app itself is a **zero-knowledge, wormhole-style file drop**. You send a
file and get a 6-word phrase; whoever has the phrase can download it. The phrase
is the only key and it never leaves the browser — files are encrypted client-side
(Argon2id + AES-256-GCM), so the backend, the storage, and the operator only ever
hold ciphertext. Files auto-expire after 24h.

## Why it's built this way

The point isn't just "a file sharer" — it's the **infrastructure story**:

- **Homelab is free baseline compute.** The backend runs on my own hardware as
  the always-on primary.
- **AWS is rented burst capacity.** When the homelab backend saturates, an
  autoscaler spins up EC2 instances to share the load, then stops them when
  traffic drains — so the AWS bill is a few cents, not a monthly server.
- **The backend is stateless** (all shared state lives in Redis + S3), which is
  what makes scaling out to identical EC2 clones possible at all.
- **Everything is declarative** — the VPS side (nginx, Redis, the autoscaler
  service) is a NixOS module in my `nix-anywhere` config.

## Topology

```
                    browser  (encrypts / decrypts — holds the phrase)
                       │  ciphertext only, over HTTPS
                       ▼
        ┌─ VPS · NixOS · always-on anchor ─────────────────────────┐
        │   nginx      serves the static frontend + load-balances   │
        │              /api across the backend pool via a mutable   │
        │              upstream include the autoscaler owns          │
        │   autoscaler (systemd) — scrapes /metrics, aws ec2         │
        │              start|stop, rewrites include, reloads nginx   │
        │   Redis      hash(phrase) → {s3_key, salt, enc_name}       │
        │              TTL 24h + lookup rate-limit counters          │
        └──────┬────────────────────────────────┬───────────────────┘
          wireguard                         wireguard
               ▼                                 ▼
          homelab backend                   EC2 backend(s)   ← burst only
          (always on, free)                 (baked AMI, IAM instance role)
          IAM user key                      no stored secret
               └─────────────────┬──────────────┘
                        stream ciphertext
                                 ▼
                        private S3 bucket   · 24h lifecycle expiry
```

**Data path:** bytes stream *through* the backend to a private S3 bucket — the
browser never gets a direct-to-S3 URL, so the bucket stays fully private
(reachable only by IAM-signed calls). Because the backend actually handles every
byte, it saturates on real load, which is what gives the autoscaler something to
react to.

**Scale signal:** each backend reports its in-flight request count on `/metrics`;
the autoscaler sums these and scales on concurrency (the real bottleneck for a
byte pipe), not CPU.

## Components

- `frontend/` — static React. WebCrypto: 6-word phrase → Argon2id → AES-256-GCM.
  Encrypts file + filename client-side, uploads ciphertext, shows the phrase.
- `backend/` — Rust / Axum. Ciphertext pipe to/from S3, Redis metadata
  (`hash(phrase) → {s3_key, salt, enc_name}`, TTL 24h), rate-limited lookup,
  `/metrics` in-flight count. The identical binary runs on homelab and EC2.
- `autoscaler/` — Rust systemd service on the VPS. Scrapes `/metrics`, starts and
  stops EC2 burst backends, rewrites the nginx upstream include, reloads nginx.

## AWS pieces used

| Service | Role in the project |
|---|---|
| **S3** (private bucket) | Encrypted blob storage; 24h lifecycle rule for auto-expiry |
| **EC2** | Burst backends, started/stopped on demand |
| **IAM user** | Credentials for out-of-AWS hosts (homelab backend, VPS autoscaler) |
| **IAM role** | Instance role on EC2 backends — S3 access with no stored key |

## What crosses the wire

Upload sends only: a SHA-256 hash of the phrase (lookup handle), a public salt,
the encrypted filename, and the ciphertext blob. The words and the derived key
stay in the tab. Lose the words → the file is unrecoverable, by design.

## Local dev

```
docker compose up          # Redis + MinIO (S3 stand-in) + backend
cd frontend && npm install && npm run dev
```

MinIO fakes S3 locally; the bucket and 24h lifecycle rule are created on start.

## Tests

```
cd frontend && npm test    # Vitest crypto suite: round-trip, integrity, no-leak
```

CI (GitHub Actions) runs the frontend tests + build and `cargo check`/`test` for
both Rust crates on every push.

## Status

Working end-to-end against real S3: client-side encryption, backend ciphertext
pipe, Redis metadata with TTL, rate-limited lookup. The homelab path and the
Nix wiring are in place; the EC2 burst path (AMI bake + WireGuard peering) is the
remaining deployment step. Large-file support is capped at ~100 MB for now
(one-shot encryption); chunked streaming encryption is a planned follow-up.
