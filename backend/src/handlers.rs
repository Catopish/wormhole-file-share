use std::sync::atomic::Ordering;

use axum::body::Body;
use axum::extract::{Path, State};
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::Deserialize;
use serde_json::json;

use crate::error::ApiError;
use crate::state::AppState;
use crate::store::{self, Record};

// Increments inflight on construction, decrements on drop — even on early
// return or panic, so /metrics always reflects live concurrency.
pub struct InflightGuard(std::sync::Arc<std::sync::atomic::AtomicI64>);
impl InflightGuard {
    pub fn new(state: &AppState) -> Self {
        state.inflight.fetch_add(1, Ordering::Relaxed);
        InflightGuard(state.inflight.clone())
    }
}
impl Drop for InflightGuard {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::Relaxed);
    }
}

pub async fn healthz() -> impl IntoResponse {
    StatusCode::OK
}

pub async fn metrics(State(state): State<AppState>) -> impl IntoResponse {
    let inflight = state.inflight.load(Ordering::Relaxed);
    // Plain text so the autoscaler can scrape it trivially.
    format!("inflight {inflight}\n")
}

// Load-test endpoint for the burst simulator. Registers in-flight load exactly
// like a real upload (so the autoscaler bursts), but DRAINS AND DISCARDS the
// body — nothing is written to S3 or Redis. Reports which node served it so the
// UI can show homelab-vs-ec2 split. Rate-limited per IP to blunt abuse.
pub async fn benchmark(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Body,
) -> Result<Response, ApiError> {
    let _guard = InflightGuard::new(&state);

    store::check_benchmark_limit(&state, &client_ip(&headers)).await?;

    // Drain the body (up to the cap) and throw it away — this exercises the
    // network path and holds the connection, without persisting anything.
    let _ = axum::body::to_bytes(body, state.cfg.max_upload_bytes as usize)
        .await
        .map_err(|_| ApiError::TooLarge)?;

    // Hold the in-flight slot briefly so concurrent requests actually overlap
    // and the autoscaler sees real load — otherwise tiny requests complete too
    // fast to accumulate concurrency.
    tokio::time::sleep(std::time::Duration::from_millis(750)).await;

    let node = state.cfg.node_name.clone();
    Ok((
        [("x-served-by", node.clone())],
        Json(json!({ "served_by": node })),
    )
        .into_response())
}

// Client sends the opaque bits as headers; the body is the raw ciphertext
// stream. The server understands none of it.
pub async fn upload(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Body,
) -> Result<Response, ApiError> {
    let _guard = InflightGuard::new(&state);

    let id = header_str(&headers, "x-wh-id")?;
    let salt = header_str(&headers, "x-wh-salt")?;
    let enc_name = header_str(&headers, "x-wh-name")?;
    let size: u64 = header_str(&headers, "x-wh-size")?
        .parse()
        .map_err(|_| ApiError::BadRequest("x-wh-size must be an integer".into()))?;

    if !is_hex_id(&id) {
        return Err(ApiError::BadRequest("x-wh-id must be a hex hash".into()));
    }
    if size > state.cfg.max_upload_bytes {
        return Err(ApiError::TooLarge);
    }

    let s3_key = format!("blobs/{id}");

    // Collect the ciphertext (capped at max_upload_bytes) then hand it to S3.
    // The upload size is bounded, so a single buffered PUT is fine here; the
    // streaming-to-S3 path is a phase-2 concern alongside chunked encryption.
    let bytes = axum::body::to_bytes(body, state.cfg.max_upload_bytes as usize)
        .await
        .map_err(|_| ApiError::TooLarge)?;

    state
        .s3
        .put_object()
        .bucket(&state.cfg.s3_bucket)
        .key(&s3_key)
        .content_length(bytes.len() as i64)
        .body(bytes.to_vec().into())
        .send()
        .await
        .map_err(|e| ApiError::Internal(anyhow::anyhow!("s3 put failed: {e}")))?;

    // Only after the blob lands do we publish the pointer.
    store::put_record(&state, &id, &Record { s3_key, salt, enc_name, size }).await?;

    Ok((StatusCode::CREATED, Json(json!({ "id": id }))).into_response())
}

#[derive(Deserialize)]
pub struct LookupBody {
    pub id: String,
}

// Metadata lookup is rate-limited (this is the brute-force surface).
pub async fn lookup(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<LookupBody>,
) -> Result<Response, ApiError> {
    let who = client_ip(&headers);
    store::check_lookup_limit(&state, &who).await?;

    let rec = store::get_record(&state, &req.id).await?;
    Ok(Json(json!({
        "salt": rec.salt,
        "enc_name": rec.enc_name,
        "size": rec.size,
    }))
    .into_response())
}

// Streams ciphertext back. The record must still exist (TTL) for the blob
// to be reachable, so an expired phrase 404s here too.
pub async fn download(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Response, ApiError> {
    let _guard = InflightGuard::new(&state);

    if !is_hex_id(&id) {
        return Err(ApiError::BadRequest("bad id".into()));
    }
    let rec = store::get_record(&state, &id).await?;

    let obj = state
        .s3
        .get_object()
        .bucket(&state.cfg.s3_bucket)
        .key(&rec.s3_key)
        .send()
        .await
        .map_err(|_| ApiError::NotFound)?;

    let stream = tokio_util::io::ReaderStream::new(obj.body.into_async_read());
    let body = Body::from_stream(stream);

    Ok(([
        (header::CONTENT_TYPE, "application/octet-stream".to_string()),
        (header::CONTENT_LENGTH, rec.size.to_string()),
    ], body)
        .into_response())
}

fn header_str(headers: &HeaderMap, name: &str) -> Result<String, ApiError> {
    headers
        .get(name)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string())
        .ok_or_else(|| ApiError::BadRequest(format!("missing header {name}")))
}

fn is_hex_id(id: &str) -> bool {
    id.len() == 64 && id.bytes().all(|b| b.is_ascii_hexdigit())
}

fn client_ip(headers: &HeaderMap) -> String {
    headers
        .get("x-forwarded-for")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.split(',').next())
        .map(|s| s.trim().to_string())
        .unwrap_or_else(|| "unknown".into())
}
