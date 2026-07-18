use aws_sdk_ec2::Client;

pub struct Ec2 {
    client: Client,
}

impl Ec2 {
    pub async fn new(region: Option<String>) -> Self {
        let mut loader =
            aws_config::defaults(aws_config::BehaviorVersion::latest());
        if let Some(r) = region {
            loader = loader.region(aws_config::Region::new(r));
        }
        let cfg = loader.load().await;
        Ec2 { client: Client::new(&cfg) }
    }

    pub async fn start(&self, id: &str) -> anyhow::Result<()> {
        tracing::info!(instance = id, "starting EC2 instance");
        self.client.start_instances().instance_ids(id).send().await?;
        Ok(())
    }

    pub async fn stop(&self, id: &str) -> anyhow::Result<()> {
        tracing::info!(instance = id, "stopping EC2 instance");
        self.client.stop_instances().instance_ids(id).send().await?;
        Ok(())
    }
}
