mod config;
mod ec2;
mod metrics;
mod nginx;

use std::time::{Duration, Instant};

use config::Config;
use ec2::Ec2;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "wormhole_autoscaler=info".into()),
        )
        .init();

    let cfg = Config::from_env();
    let ec2 = Ec2::new(cfg.aws_region.clone()).await;
    let http = reqwest::Client::new();

    // How many of the configured burst instances are currently in the pool.
    let mut active = 0usize;
    let mut last_scale = Instant::now() - Duration::from_secs(cfg.cooldown_secs);

    // Start with just the homelab in the upstream file.
    nginx::apply_upstreams(&cfg, &[])?;
    tracing::info!(
        homelab = %cfg.homelab_backend,
        burst = cfg.ec2_instances.len(),
        "autoscaler started"
    );

    loop {
        let hosts = current_hosts(&cfg, active);
        let load = metrics::total_inflight(&http, &hosts, cfg.backend_port).await;
        let cooled = last_scale.elapsed().as_secs() >= cfg.cooldown_secs;

        tracing::debug!(load, active, cooled, "tick");

        if load >= cfg.scale_up_at && active < cfg.ec2_instances.len() && cooled {
            let inst = cfg.ec2_instances[active].clone();
            if let Err(e) = scale_up(&cfg, &ec2, &http, &inst.id, &inst.ip).await {
                tracing::error!(error = ?e, "scale up failed");
            } else {
                active += 1;
                last_scale = Instant::now();
                tracing::info!(active, "scaled up");
            }
        } else if load <= cfg.scale_down_at && active > 0 && cooled {
            let inst = cfg.ec2_instances[active - 1].clone();
            if let Err(e) = scale_down(&cfg, &ec2, active - 1, &inst.id).await {
                tracing::error!(error = ?e, "scale down failed");
            } else {
                active -= 1;
                last_scale = Instant::now();
                tracing::info!(active, "scaled down");
            }
        }

        tokio::time::sleep(Duration::from_secs(cfg.poll_secs)).await;
    }
}

fn current_hosts(cfg: &Config, active: usize) -> Vec<String> {
    let mut hosts = vec![cfg.homelab_backend.clone()];
    hosts.extend(cfg.ec2_instances[..active].iter().map(|i| i.ip.clone()));
    hosts
}

async fn scale_up(
    cfg: &Config,
    ec2: &Ec2,
    http: &reqwest::Client,
    id: &str,
    ip: &str,
) -> anyhow::Result<()> {
    ec2.start(id).await?;
    wait_healthy(http, ip, cfg.backend_port).await?;
    // active count in the caller hasn't advanced yet, so include this ip now.
    let mut ips: Vec<String> = cfg
        .ec2_instances
        .iter()
        .take_while(|i| i.id != id)
        .map(|i| i.ip.clone())
        .collect();
    ips.push(ip.to_string());
    nginx::apply_upstreams(cfg, &ips)
}

async fn scale_down(cfg: &Config, ec2: &Ec2, keep: usize, id: &str) -> anyhow::Result<()> {
    // Deregister first so nginx stops routing before the box goes away.
    let ips: Vec<String> = cfg.ec2_instances[..keep].iter().map(|i| i.ip.clone()).collect();
    nginx::apply_upstreams(cfg, &ips)?;
    ec2.stop(id).await
}

// Poll /healthz until the newly-started instance answers or we give up.
async fn wait_healthy(http: &reqwest::Client, ip: &str, port: u16) -> anyhow::Result<()> {
    let url = format!("http://{ip}:{port}/healthz");
    for attempt in 0..40 {
        if http
            .get(&url)
            .timeout(Duration::from_secs(3))
            .send()
            .await
            .map(|r| r.status().is_success())
            .unwrap_or(false)
        {
            tracing::info!(ip, "burst backend healthy");
            return Ok(());
        }
        tracing::debug!(ip, attempt, "waiting for burst backend");
        tokio::time::sleep(Duration::from_secs(3)).await;
    }
    anyhow::bail!("burst backend {ip} never became healthy")
}
