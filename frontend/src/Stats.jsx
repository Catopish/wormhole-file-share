import { useEffect, useState } from "react";

// Persistent fleet counter: how many transfers each backend has served, ever.
// Polls /api/stats so it stays live while the page is open.
export default function Stats() {
  const [stats, setStats] = useState(null);

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const r = await fetch("/api/stats");
        if (!r.ok) return;
        const s = await r.json();
        if (alive) setStats(s);
      } catch {
        /* ignore — stats are best-effort */
      }
    }
    load();
    const t = setInterval(load, 5000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  if (!stats) return null;

  const total = stats.homelab + stats.ec2;
  const ec2Pct = total ? (stats.ec2 / total) * 100 : 0;
  const homelabPct = total ? (stats.homelab / total) * 100 : 100;

  return (
    <div className="served">
      <div className="served-head">
        <span>transfers served</span>
        <span className="served-total">{total.toLocaleString()}</span>
      </div>
      <div className="splitbar" aria-hidden="true">
        <div className="seg homelab" style={{ width: `${homelabPct}%` }} />
        <div className="seg ec2" style={{ width: `${ec2Pct}%` }} />
      </div>
      <div className="served-legend">
        <span>
          <i className="dot homelab" /> homelab {stats.homelab.toLocaleString()}
        </span>
        <span>
          <i className="dot ec2" /> aws burst {stats.ec2.toLocaleString()}
        </span>
      </div>
    </div>
  );
}
