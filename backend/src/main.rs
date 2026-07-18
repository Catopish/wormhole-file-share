mod config;
mod error;
mod handlers;
mod state;
mod store;

use axum::extract::DefaultBodyLimit;
use axum::routing::{get, post};
use axum::Router;
use tower_http::cors::CorsLayer;
use tower_http::trace::TraceLayer;

use config::Config;
use state::AppState;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "wormhole_backend=info,tower_http=warn".into()),
        )
        .init();

    let cfg = Config::from_env();
    let bind = cfg.bind_addr.clone();
    let max_body = cfg.max_upload_bytes as usize + 4096; // headroom for framing
    let state = AppState::new(cfg).await?;

    let app = Router::new()
        .route("/healthz", get(handlers::healthz))
        .route("/metrics", get(handlers::metrics))
        .route("/api/upload", post(handlers::upload))
        .route("/api/lookup", post(handlers::lookup))
        .route("/api/download/:id", get(handlers::download))
        .route("/api/stats", get(handlers::stats))
        .layer(DefaultBodyLimit::max(max_body))
        .layer(CorsLayer::permissive())
        .layer(TraceLayer::new_for_http())
        .with_state(state);

    let listener = tokio::net::TcpListener::bind(&bind).await?;
    tracing::info!("wormhole-backend listening on {bind}");
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<std::net::SocketAddr>(),
    )
    .await?;
    Ok(())
}
