import { useEffect, useState } from "react";

interface HealthStatus {
  status: string;
  db: string;
  uptime: number;
  timestamp: string;
  version: string;
}

export default function App() {
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchHealth() {
      try {
        const res = await fetch("/health");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as HealthStatus;
        if (!cancelled) {
          setHealth(data);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Unknown error");
      }
    }

    fetchHealth();
    const id = setInterval(fetchHealth, 5000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const apiUp = health?.status === "ok";
  const dbUp = health?.db === "connected";

  return (
    <div className="container">
      <header className="hero">
        <span className="hero-mark">✈</span>
        <h1 className="hero-title">Triply</h1>
        <p className="hero-subtitle">Plan smarter trips, powered by AI.</p>
      </header>

      <section className="card">
        <h2 className="card-title">Connection status</h2>
        <div className="status-grid">
          <div className="status-item">
            <span className={`dot ${apiUp ? "dot-ok" : "dot-bad"}`} />
            <div>
              <strong>API</strong>
              <span className="dim">{apiUp ? "running" : "unreachable"}</span>
            </div>
          </div>
          <div className="status-item">
            <span className={`dot ${dbUp ? "dot-ok" : "dot-bad"}`} />
            <div>
              <strong>Database</strong>
              <span className="dim">{health?.db ?? "unknown"} {health ? "· mongo" : ""}</span>
            </div>
          </div>
        </div>

        {health ? (
          <div className="meta">
            <span>v{health.version}</span>
            <span>uptime {Math.round(health.uptime)}s</span>
            <span>{new Date(health.timestamp).toLocaleTimeString()}</span>
          </div>
        ) : error ? (
          <p className="error">Backend not reachable: {error}</p>
        ) : (
          <p className="dim">Checking…</p>
        )}
      </section>

      <section className="card">
        <h2 className="card-title">Your trips</h2>
        <p className="dim">No trips yet. Coming soon.</p>
      </section>
    </div>
  );
}