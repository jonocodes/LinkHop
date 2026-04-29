import { useState } from "react";
import { App as AppClass, type AppScreen } from "./app";

interface SetupProps {
  onComplete: () => void;
}

export function Setup({ onComplete }: SetupProps) {
  const [name, setName] = useState("");
  const [rsUser, setRsUser] = useState("");
  const [ntfyUrl, setNtfyUrl] = useState("https://ntfy.sh");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const trimmedName = name.trim();
    const trimmedRsUser = rsUser.trim();
    const trimmedNtfyUrl = ntfyUrl.trim();

    if (!trimmedName) {
      setError("Device name is required");
      return;
    }
    if (!trimmedRsUser || !trimmedRsUser.includes("@")) {
      setError("RemoteStorage address must be in the form user@provider.example");
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
        onError: (msg: string) => {
          setError(msg);
          setLoading(false);
        },
      });
      // setup() triggers RS OAuth — the page may redirect to the RS provider.
      // On return, init() picks up pending setup from sessionStorage.
      await app.setup(trimmedName, trimmedRsUser, trimmedNtfyUrl);
    } catch (err) {
      setError(`Setup failed: ${err}`);
      setLoading(false);
    }
  };

  return (
    <div className="screen active">
      <h1>LinkHop</h1>
      <p className="setup-intro">
        Share links and messages across your devices using your own RemoteStorage account.
        No servers to run — your data stays yours.
      </p>

      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label htmlFor="setup-name">Device name</label>
          <input
            id="setup-name"
            type="text"
            placeholder="My Phone"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="off"
          />
        </div>

        <div className="form-group">
          <label htmlFor="setup-rs-user">RemoteStorage address</label>
          <input
            id="setup-rs-user"
            type="text"
            placeholder="you@5apps.com"
            value={rsUser}
            onChange={(e) => setRsUser(e.target.value)}
            autoComplete="off"
            inputMode="email"
          />
          <div className="form-hint">
            Your account at a RemoteStorage provider (e.g. 5apps.com).
            A browser login prompt will follow.
          </div>
        </div>

        <button
          type="button"
          className="secondary advanced-toggle"
          onClick={() => setShowAdvanced(!showAdvanced)}
        >
          {showAdvanced ? "Hide advanced ▲" : "Advanced ▼"}
        </button>

        {showAdvanced && (
          <div className="advanced-panel">
            <div className="form-group">
              <label htmlFor="setup-ntfy-url">ntfy server URL</label>
              <input
                id="setup-ntfy-url"
                type="url"
                placeholder="https://ntfy.sh"
                value={ntfyUrl}
                onChange={(e) => setNtfyUrl(e.target.value)}
              />
              <div className="form-hint">
                Used for real-time delivery and push notifications.
                Defaults to the public ntfy.sh server.
                Use a self-hosted instance for better reliability.
              </div>
            </div>
          </div>
        )}

        {error && <div className="error-message">{error}</div>}

        <button type="submit" disabled={loading} style={{ marginTop: 8 }}>
          {loading ? "Connecting…" : "Connect"}
        </button>
      </form>
    </div>
  );
}
