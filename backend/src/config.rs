use std::env;

#[derive(Clone)]
pub struct Config {
    pub bind_addr: String,
    pub s3_bucket: String,
    pub redis_url: String,
    pub ttl_secs: u64,
    pub max_upload_bytes: u64,
    pub lookup_limit: u32,
    pub lookup_window_secs: u64,
}

impl Config {
    pub fn from_env() -> Self {
        Config {
            bind_addr: env::var("WH_BIND").unwrap_or_else(|_| "0.0.0.0:8080".into()),
            s3_bucket: env::var("WH_S3_BUCKET").expect("WH_S3_BUCKET is required"),
            redis_url: env::var("WH_REDIS_URL").unwrap_or_else(|_| "redis://127.0.0.1/".into()),
            ttl_secs: parse("WH_TTL_SECS", 86_400),
            max_upload_bytes: parse("WH_MAX_UPLOAD_BYTES", 100 * 1024 * 1024),
            lookup_limit: parse("WH_LOOKUP_LIMIT", 20) as u32,
            lookup_window_secs: parse("WH_LOOKUP_WINDOW_SECS", 60),
        }
    }
}

fn parse<T: std::str::FromStr>(key: &str, default: T) -> T {
    env::var(key).ok().and_then(|v| v.parse().ok()).unwrap_or(default)
}
