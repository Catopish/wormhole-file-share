use std::sync::atomic::AtomicI64;
use std::sync::Arc;

use aws_sdk_s3::Client as S3Client;
use redis::aio::ConnectionManager;

use crate::config::Config;

#[derive(Clone)]
pub struct AppState {
    pub cfg: Config,
    pub s3: S3Client,
    pub redis: ConnectionManager,
    pub inflight: Arc<AtomicI64>,
}

impl AppState {
    pub async fn new(cfg: Config) -> anyhow::Result<Self> {
        let aws = aws_config::load_defaults(aws_config::BehaviorVersion::latest()).await;
        // A custom endpoint (e.g. MinIO for local dev) needs path-style
        // addressing; real S3 ignores this and uses virtual-host style.
        let s3_cfg = aws_sdk_s3::config::Builder::from(&aws)
            .force_path_style(std::env::var("AWS_ENDPOINT_URL_S3").is_ok())
            .build();
        let s3 = S3Client::from_conf(s3_cfg);

        let client = redis::Client::open(cfg.redis_url.clone())?;
        let redis = ConnectionManager::new(client).await?;

        Ok(AppState {
            cfg,
            s3,
            redis,
            inflight: Arc::new(AtomicI64::new(0)),
        })
    }
}
