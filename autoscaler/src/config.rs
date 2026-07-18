use std::env;

#[derive(Clone)]
pub struct Config {
    // The always-on baseline backend. Never scaled, always in the pool.
    pub homelab_backend: String,
    // Burst EC2 instances to manage, in priority order.
    pub ec2_instances: Vec<Instance>,
    // File nginx includes; we own it. Autoscaler writes the server list here.
    pub upstreams_path: String,
    pub reload_cmd: String,
    // Scale when summed inflight exceeds this; scale down under low_watermark.
    pub scale_up_at: i64,
    pub scale_down_at: i64,
    pub cooldown_secs: u64,
    pub poll_secs: u64,
    pub backend_port: u16,
    pub aws_region: Option<String>,
}

#[derive(Clone)]
pub struct Instance {
    pub id: String,   // i-xxxx
    pub ip: String,   // wireguard ip the backend answers on
}

impl Config {
    pub fn from_env() -> Self {
        Config {
            homelab_backend: env::var("WH_HOMELAB_BACKEND")
                .unwrap_or_else(|_| "10.0.0.2".into()),
            ec2_instances: parse_instances(
                &env::var("WH_EC2_INSTANCES").unwrap_or_default(),
            ),
            upstreams_path: env::var("WH_UPSTREAMS_PATH")
                .unwrap_or_else(|_| "/var/lib/wormhole/upstreams.conf".into()),
            reload_cmd: env::var("WH_RELOAD_CMD")
                .unwrap_or_else(|_| "nginx -s reload".into()),
            scale_up_at: parse("WH_SCALE_UP_AT", 40),
            scale_down_at: parse("WH_SCALE_DOWN_AT", 10),
            cooldown_secs: parse("WH_COOLDOWN_SECS", 300),
            poll_secs: parse("WH_POLL_SECS", 15),
            backend_port: parse("WH_BACKEND_PORT", 8080),
            aws_region: env::var("AWS_REGION").ok(),
        }
    }
}

// Format: "i-abc123=10.0.0.50,i-def456=10.0.0.51"
fn parse_instances(raw: &str) -> Vec<Instance> {
    raw.split(',')
        .filter(|s| !s.trim().is_empty())
        .filter_map(|pair| {
            let (id, ip) = pair.trim().split_once('=')?;
            Some(Instance { id: id.trim().into(), ip: ip.trim().into() })
        })
        .collect()
}

fn parse<T: std::str::FromStr>(key: &str, default: T) -> T {
    env::var(key).ok().and_then(|v| v.parse().ok()).unwrap_or(default)
}
