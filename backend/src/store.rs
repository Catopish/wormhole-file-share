use redis::AsyncCommands;
use serde::{Deserialize, Serialize};

use crate::error::ApiError;
use crate::state::AppState;

// Everything here is opaque to the server: id is a hash of the words,
// salt is public, enc_name is ciphertext. No key, no plaintext.
#[derive(Serialize, Deserialize)]
pub struct Record {
    pub s3_key: String,
    pub salt: String,     // base64, client-provided
    pub enc_name: String, // base64 ciphertext of the filename
    pub size: u64,
}

// Persistent "served by" tally. Each backend bumps its own counter on every
// upload/download it handles; a durable INCR in Redis so it survives restarts
// and reflects the whole fleet's history. Keyed by node name.
pub async fn bump_served(state: &AppState) {
    let mut conn = state.redis.clone();
    let key = format!("wh:stats:served:{}", state.cfg.node_name);
    // Fire-and-forget: a stats miss must never fail a real request.
    let _: Result<i64, _> = conn.incr(&key, 1).await;
}

pub async fn get_served(state: &AppState) -> (i64, i64) {
    let mut conn = state.redis.clone();
    let homelab: i64 = conn.get("wh:stats:served:homelab").await.unwrap_or(0);
    let ec2: i64 = conn.get("wh:stats:served:ec2").await.unwrap_or(0);
    (homelab, ec2)
}

fn meta_key(id: &str) -> String {
    format!("wh:file:{id}")
}

pub async fn put_record(state: &AppState, id: &str, rec: &Record) -> Result<(), ApiError> {
    let mut conn = state.redis.clone();
    let payload = serde_json::to_string(rec).map_err(|e| ApiError::Internal(e.into()))?;
    let _: () = conn
        .set_ex(meta_key(id), payload, state.cfg.ttl_secs)
        .await?;
    Ok(())
}

pub async fn get_record(state: &AppState, id: &str) -> Result<Record, ApiError> {
    let mut conn = state.redis.clone();
    let payload: Option<String> = conn.get(meta_key(id)).await?;
    let payload = payload.ok_or(ApiError::NotFound)?;
    serde_json::from_str(&payload).map_err(|e| ApiError::Internal(e.into()))
}

// Fixed-window rate limit keyed by client ip; guards the lookup endpoint
// so a 6-word id can't be brute-forced by hammering it.
pub async fn check_lookup_limit(state: &AppState, who: &str) -> Result<(), ApiError> {
    let mut conn = state.redis.clone();
    let key = format!("wh:rl:{who}");
    let count: u32 = conn.incr(&key, 1).await?;
    if count == 1 {
        let _: () = conn.expire(&key, state.cfg.lookup_window_secs as i64).await?;
    }
    if count > state.cfg.lookup_limit {
        return Err(ApiError::RateLimited);
    }
    Ok(())
}
