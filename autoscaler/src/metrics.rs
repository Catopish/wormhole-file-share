use std::time::Duration;

// Scrapes one backend's /metrics and returns its inflight count.
// Unreachable backends count as 0 so a down instance can't stall scaling.
pub async fn scrape_inflight(client: &reqwest::Client, host: &str, port: u16) -> i64 {
    let url = format!("http://{host}:{port}/metrics");
    match client.get(&url).timeout(Duration::from_secs(3)).send().await {
        Ok(resp) => resp
            .text()
            .await
            .ok()
            .and_then(|body| parse_inflight(&body))
            .unwrap_or(0),
        Err(_) => 0,
    }
}

fn parse_inflight(body: &str) -> Option<i64> {
    body.lines()
        .find_map(|l| l.strip_prefix("inflight "))
        .and_then(|v| v.trim().parse().ok())
}

pub async fn total_inflight(
    client: &reqwest::Client,
    hosts: &[String],
    port: u16,
) -> i64 {
    let mut total = 0;
    for h in hosts {
        total += scrape_inflight(client, h, port).await;
    }
    total
}
