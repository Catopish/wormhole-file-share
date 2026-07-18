FROM rust:1.97-slim-bookworm AS build
WORKDIR /app
RUN apt-get update && apt-get install -y pkg-config && rm -rf /var/lib/apt/lists/*
COPY Cargo.toml Cargo.lock ./
COPY src ./src
RUN cargo build --release

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/target/release/wormhole-autoscaler /usr/local/bin/wormhole-autoscaler
ENTRYPOINT ["wormhole-autoscaler"]
