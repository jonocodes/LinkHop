import { useState } from "react";
import { App as AppClass, type AppScreen, type ConnectionStatus } from "./app";
import type { TransportKind } from "./db";

interface SetupProps {
  onComplete: () => void;
}

export function Setup({ onComplete }: SetupProps) {
  const [name, setName] = useState("");
  const [pool, setPool] = useState("");
  const [password, setPassword] = useState("");
  const [transportUrl, setTransportUrl] = useState("https://ntfy.sh");
  const [transportKind, setTransportKind] = useState<TransportKind>("ntfy");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !pool || !password) {
      setError("Name, pool, and password are required");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const app = new AppClass({
        onStateChange: () => {},
        onScreenChange: (screen: AppScreen) => {
          if (screen === "main") onComplete();
        },
        onConnectionChange: () => {},
        onError: (msg: string) => setError(msg),
      });
      await app.setup(name, pool, password, transportUrl, transportKind);
    } catch (err) {
      setError(`Setup failed: ${err}`);
      setLoading(false);
    }
  };

  const transports = [
    { kind: "ntfy" as const, label: "ntfy.sh (free)", url: "https://ntfy.sh" },
    { kind: "ntfy" as const, label: "ntfy (self-hosted)", url: "https://ntfy.example.com" },
    { kind: "relay" as const, label: "Local Deno relay", url: "http://localhost:8000" },
    { kind: "supabase" as const, label: "Supabase Edge Function", url: "https://your-project.supabase.co" },
    { kind: "cloudflare" as const, label: "Cloudflare Worker", url: "https://your-worker.workers.dev" },
  ];

  return (
    <div className="screen active">
      <h1>LinkHop Lite</h1>
      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label htmlFor="setup-name">Device name</label>
          <input
            id="setup-name"
            type="text"
            placeholder="My Phone"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="form-group">
          <label htmlFor="setup-pool">Pool name</label>
          <input
            id="setup-pool"
            type="text"
            placeholder="my-family"
            value={pool}
            onChange={(e) => setPool(e.target.value)}
          />
        </div>
        <div className="form-group">
          <label htmlFor="setup-password">Password</label>
          <input
            id="setup-password"
            type="password"
            placeholder="shared secret"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <button type="submit" disabled={loading}>
          {loading ? "Joining..." : "Join network"}
        </button>
        <button
          type="button"
          className="secondary"
          onClick={() => setShowSettings(!showSettings)}
        >
          Settings
        </button>
        {error && <div className="error-message">{error}</div>}
      </form>

      {showSettings && (
        <div className="settings-panel">
          <div className="settings-section">
            <div className="settings-label">Backend</div>
            <div className="settings-row">
              <select
                value={transportKind}
                onChange={(e) => {
                  const t = e.target.value as TransportKind;
                  setTransportKind(t);
                  const found = transports.find((tr) => tr.kind === t);
                  if (found) setTransportUrl(found.url);
                }}
              >
                {transports.map((t) => (
                  <option key={t.kind} value={t.kind}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="settings-section">
            <div className="settings-label">Server URL</div>
            <div className="settings-row">
              <input
                type="url"
                value={transportUrl}
                onChange={(e) => setTransportUrl(e.target.value)}
                placeholder="https://ntfy.sh"
              />
            </div>
            <div className="settings-hint">Enter the base URL for your backend</div>
          </div>
        </div>
      )}
    </div>
  );
}