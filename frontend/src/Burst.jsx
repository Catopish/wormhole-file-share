import { useState, useRef } from "react";
import { benchmark } from "./api.js";

const MB = 1024 * 1024;
const PAYLOAD_SIZE = 5 * MB;

// One shared 5MB buffer reused for every request — avoids allocating
// N × 5MB when firing 100 concurrent.
const payload = crypto.getRandomValues(new Uint8Array(PAYLOAD_SIZE));

export default function Burst() {
  const [concurrency, setConcurrency] = useState(50);
  const [running, setRunning] = useState(false);
  const [counts, setCounts] = useState({ homelab: 0, ec2: 0, other: 0, failed: 0 });
  const [total, setTotal] = useState(0);
  const [ec2Seen, setEc2Seen] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const abortRef = useRef(false);

  async function run() {
    abortRef.current = false;
    setRunning(true);
    setCounts({ homelab: 0, ec2: 0, other: 0, failed: 0 });
    setTotal(0);
    setEc2Seen(false);
    setElapsed(0);

    const start = performance.now();
    const timer = setInterval(
      () => setElapsed((performance.now() - start) / 1000),
      100
    );

    // Keep `concurrency` requests in flight continuously for the run window so
    // the autoscaler has time (~15-20s) to spin up EC2 and start serving.
    const RUN_MS = 45_000;
    async function worker() {
      while (!abortRef.current && performance.now() - start < RUN_MS) {
        try {
          const node = await benchmark(payload);
          setTotal((t) => t + 1);
          setCounts((c) => ({ ...c, [key(node)]: c[key(node)] + 1 }));
          if (node === "ec2") setEc2Seen(true);
        } catch {
          setTotal((t) => t + 1);
          setCounts((c) => ({ ...c, failed: c.failed + 1 }));
        }
      }
    }

    await Promise.all(Array.from({ length: concurrency }, worker));
    clearInterval(timer);
    setElapsed((performance.now() - start) / 1000);
    setRunning(false);
  }

  function stop() {
    abortRef.current = true;
  }

  const served = counts.homelab + counts.ec2;
  const homelabPct = served ? (counts.homelab / served) * 100 : 100;
  const ec2Pct = served ? (counts.ec2 / served) * 100 : 0;

  return (
    <div className="card">
      <div className="field">
        <label htmlFor="conc">
          concurrency — {concurrency} parallel 5MB requests
        </label>
        <input
          id="conc"
          type="range"
          min="1"
          max="100"
          value={concurrency}
          disabled={running}
          onChange={(e) => setConcurrency(Number(e.target.value))}
        />
      </div>

      {!running ? (
        <button className="primary" onClick={run}>
          Run burst test
        </button>
      ) : (
        <button className="primary" onClick={stop}>
          Stop ({elapsed.toFixed(0)}s)
        </button>
      )}

      <div className={`burst-flag ${ec2Seen ? "on" : ""}`}>
        {ec2Seen ? "⚡ EC2 BURST ACTIVE" : "homelab only"}
      </div>

      <div className="burst-stats">
        <div>
          <span className="num">{total}</span>
          <span className="lbl">requests</span>
        </div>
        <div>
          <span className="num homelab">{counts.homelab}</span>
          <span className="lbl">homelab</span>
        </div>
        <div>
          <span className="num ec2">{counts.ec2}</span>
          <span className="lbl">ec2</span>
        </div>
        <div>
          <span className="num fail">{counts.failed}</span>
          <span className="lbl">failed</span>
        </div>
      </div>

      <div className="splitbar" aria-hidden="true">
        <div className="seg homelab" style={{ width: `${homelabPct}%` }} />
        <div className="seg ec2" style={{ width: `${ec2Pct}%` }} />
      </div>

      <p className="note">
        Fires real requests that the backend <b>drains and discards</b> — nothing
        is stored in S3. When the pool is homelab-only every response comes back
        <b> homelab</b>. Once concurrency crosses the autoscaler's threshold it
        starts an EC2 instance (~15–20s), which joins the pool and begins serving
        — you'll see the <b>ec2</b> tally climb and the bar split as nginx
        round-robins across both. Idle for a bit and the autoscaler stops the
        instance again.
      </p>
    </div>
  );
}

function key(node) {
  return node === "homelab" || node === "ec2" ? node : "other";
}
