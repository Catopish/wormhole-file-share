use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::json;

#[derive(Debug, thiserror::Error)]
pub enum ApiError {
    #[error("not found")]
    NotFound,
    #[error("payload too large")]
    TooLarge,
    #[error("too many attempts")]
    RateLimited,
    #[error("bad request: {0}")]
    BadRequest(String),
    #[error(transparent)]
    Internal(#[from] anyhow::Error),
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let (status, msg) = match &self {
            ApiError::NotFound => (StatusCode::NOT_FOUND, "no file for that phrase".into()),
            ApiError::TooLarge => (StatusCode::PAYLOAD_TOO_LARGE, "file exceeds the size limit".into()),
            ApiError::RateLimited => (StatusCode::TOO_MANY_REQUESTS, "too many attempts, slow down".into()),
            ApiError::BadRequest(m) => (StatusCode::BAD_REQUEST, m.clone()),
            ApiError::Internal(e) => {
                tracing::error!(error = ?e, "internal error");
                (StatusCode::INTERNAL_SERVER_ERROR, "something went wrong".into())
            }
        };
        (status, Json(json!({ "error": msg }))).into_response()
    }
}

// Redis errors bubble up as internal.
impl From<redis::RedisError> for ApiError {
    fn from(e: redis::RedisError) -> Self {
        ApiError::Internal(anyhow::Error::new(e))
    }
}
