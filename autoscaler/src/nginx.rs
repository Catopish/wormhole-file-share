use std::io::Write;
use std::process::Command;

use crate::config::Config;

// Rewrites the include file with the current live backends and reloads nginx.
// Nix declares the `include` directive; this file is the one mutable seam.
pub fn apply_upstreams(cfg: &Config, active_ec2_ips: &[String]) -> anyhow::Result<()> {
    let mut body = String::new();
    body.push_str("# managed by wormhole-autoscaler — do not edit by hand\n");
    body.push_str(&format!("server {}:{};\n", cfg.homelab_backend, cfg.backend_port));
    for ip in active_ec2_ips {
        body.push_str(&format!("server {}:{};\n", ip, cfg.backend_port));
    }

    // Write atomically: temp file + rename, so nginx never reads a half file.
    let tmp = format!("{}.tmp", cfg.upstreams_path);
    let mut f = std::fs::File::create(&tmp)?;
    f.write_all(body.as_bytes())?;
    f.sync_all()?;
    std::fs::rename(&tmp, &cfg.upstreams_path)?;

    reload(cfg)
}

fn reload(cfg: &Config) -> anyhow::Result<()> {
    let parts: Vec<&str> = cfg.reload_cmd.split_whitespace().collect();
    let (bin, args) = parts.split_first().ok_or_else(|| anyhow::anyhow!("empty reload cmd"))?;
    let status = Command::new(bin).args(args).status()?;
    if !status.success() {
        anyhow::bail!("nginx reload exited with {status}");
    }
    tracing::info!("nginx reloaded");
    Ok(())
}
