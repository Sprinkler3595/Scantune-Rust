import { useEffect, useState } from "react";
import { api, AppConfig, AuthStatus } from "../api";
import { ErrorBanner } from "../components/common";

/**
 * Porte d'entrée de l'application : tant que l'utilisateur n'est pas connecté,
 * on n'affiche que cet écran (aucune page ne se monte, donc aucun appel Graph
 * au démarrage). La fenêtre de connexion Microsoft ne s'ouvre que sur clic.
 */
export default function Login({ onAuthenticated }: { onAuthenticated: (s: AuthStatus) => void }) {
  const [cfg, setCfg] = useState<AppConfig | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showConfig, setShowConfig] = useState(false);
  const [savedMsg, setSavedMsg] = useState("");

  useEffect(() => {
    api.getConfig().then((c) => {
      setCfg(c);
      // Première utilisation (Tenant/Client absents) → on déplie la config.
      if (!c.tenantId || !c.clientId) setShowConfig(true);
    });
  }, []);

  const configReady = !!cfg && !!cfg.tenantId && !!cfg.clientId;

  const signIn = async () => {
    setBusy(true);
    setError("");
    try {
      const s = await api.signIn();
      if (s.isAuthenticated) onAuthenticated(s);
      else setError("La connexion n'a pas abouti. Réessaie.");
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const update = (patch: Partial<AppConfig>) => cfg && setCfg({ ...cfg, ...patch });

  const saveCfg = async () => {
    if (!cfg) return;
    setError("");
    setSavedMsg("");
    try {
      await api.saveConfig(cfg);
      setSavedMsg("Configuration enregistrée. Tu peux te connecter.");
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="login-brand">⬡ ScanTune</div>
        <p className="login-sub">Gestion d'inventaire IT Intune</p>

        {error && <ErrorBanner message={error} />}

        <button className="login-btn" onClick={signIn} disabled={busy || !configReady}>
          {busy ? "Connexion en cours…" : "Se connecter avec Microsoft"}
        </button>

        {busy && (
          <p className="muted login-hint">
            Une fenêtre Microsoft va s'ouvrir. Termine la connexion, elle se fermera
            automatiquement.
          </p>
        )}
        {!configReady && !busy && (
          <p className="muted login-hint">
            Renseigne d'abord le Tenant ID et le Client ID ci-dessous.
          </p>
        )}

        <button
          type="button"
          className="ghost login-config-toggle"
          onClick={() => setShowConfig((v) => !v)}
        >
          {showConfig ? "Masquer les paramètres de connexion" : "Paramètres de connexion"}
        </button>

        {showConfig && cfg && (
          <div className="login-config">
            <div className="field">
              <label>Tenant ID</label>
              <input
                type="text"
                value={cfg.tenantId}
                onChange={(e) => update({ tenantId: e.target.value })}
                placeholder="00000000-0000-0000-0000-000000000000"
              />
            </div>
            <div className="field">
              <label>Client ID</label>
              <input
                type="text"
                value={cfg.clientId}
                onChange={(e) => update({ clientId: e.target.value })}
                placeholder="00000000-0000-0000-0000-000000000000"
              />
            </div>
            <label className="row" style={{ gap: 8, marginBottom: 14 }}>
              <input
                type="checkbox"
                checked={cfg.readOnlyMode}
                onChange={(e) => update({ readOnlyMode: e.target.checked })}
              />
              Mode lecture seule
            </label>
            <button onClick={saveCfg}>Enregistrer</button>
            {savedMsg && <p style={{ marginTop: 12, color: "var(--green)" }}>✓ {savedMsg}</p>}
          </div>
        )}
      </div>
    </div>
  );
}
