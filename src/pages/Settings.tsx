import { useEffect, useState } from "react";
import { api, AppConfig, AuthStatus } from "../api";
import { ErrorBanner } from "../components/common";
import LabelEditor from "../components/LabelEditor";

type Tab = "azure" | "label";

export default function Settings({ onSaved }: { onSaved?: () => void }) {
  const [tab, setTab] = useState<Tab>("azure");
  const [cfg, setCfg] = useState<AppConfig | null>(null);
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.getConfig().then(setCfg);
    api.authStatus().then(setAuth);
  }, []);

  if (!cfg) return null;

  const update = (patch: Partial<AppConfig>) => setCfg({ ...cfg, ...patch });

  const saveCfg = async () => {
    setError("");
    setStatus("");
    try {
      await api.saveConfig(cfg);
      setStatus("Configuration enregistrée. Reconnecte-toi pour appliquer.");
      setAuth(await api.authStatus());
      onSaved?.();
    } catch (e) {
      setError(String(e));
    }
  };

  const signIn = async () => {
    setBusy(true);
    setError("");
    try {
      const s = await api.signIn();
      setAuth(s);
      setStatus(`Connecté : ${s.userName}`);
      onSaved?.();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const signOut = async () => {
    await api.signOut();
    setAuth(await api.authStatus());
    setStatus("Déconnecté.");
    onSaved?.();
  };

  return (
    <>
      <h1 className="page-title">Paramètres</h1>
      <p className="page-sub">
        {tab === "azure"
          ? "Configuration Azure AD / Microsoft Entra ID"
          : "Mise en page des étiquettes imprimées"}
      </p>

      <div className="tabs">
        <button className={tab === "azure" ? "active" : ""} onClick={() => setTab("azure")}>
          Azure AD
        </button>
        <button className={tab === "label" ? "active" : ""} onClick={() => setTab("label")}>
          Étiquette
        </button>
      </div>

      {tab === "label" ? (
        <LabelEditor />
      ) : (
        <>
          {error && <ErrorBanner message={error} />}

          <div className="card" style={{ maxWidth: 640 }}>
            <h3 className="section-title">Connexion</h3>
            <p className="muted">
              {auth?.isAuthenticated ? `Connecté : ${auth.userName || "—"}` : "Non connecté"}
            </p>
            <div className="row" style={{ gap: 12 }}>
              <button onClick={signIn} disabled={busy}>
                {busy ? "Connexion…" : "Se connecter"}
              </button>
              <button className="ghost" onClick={signOut}>
                Se déconnecter
              </button>
            </div>
          </div>

          <div className="card" style={{ maxWidth: 640, marginTop: 18 }}>
            <h3 className="section-title">App Registration</h3>
            <div className="field">
              <label>Tenant ID</label>
              <input type="text" value={cfg.tenantId} onChange={(e) => update({ tenantId: e.target.value })} />
            </div>
            <div className="field">
              <label>Client ID</label>
              <input type="text" value={cfg.clientId} onChange={(e) => update({ clientId: e.target.value })} />
            </div>
            <div className="field">
              <label>Scopes (un par ligne)</label>
              <textarea
                value={cfg.scopes.join("\n")}
                onChange={(e) => update({ scopes: e.target.value.split("\n").map((s) => s.trim()).filter(Boolean) })}
              />
            </div>
            <div className="field">
              <label>Alerte mot de passe — ancienneté maximale (jours)</label>
              <input
                type="number"
                min={1}
                value={cfg.passwordMaxAgeDays}
                onChange={(e) =>
                  update({ passwordMaxAgeDays: Number(e.target.value) || 0 })
                }
              />
              <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>
                Au-delà de ce délai, l'utilisateur est signalé comme « à contacter »
                (180 j ≈ 6 mois). Un avertissement apparaît déjà 30 jours avant.
              </p>
            </div>
            <label className="row" style={{ gap: 8, marginBottom: 16 }}>
              <input
                type="checkbox"
                checked={cfg.readOnlyMode}
                onChange={(e) => update({ readOnlyMode: e.target.checked })}
              />
              Mode lecture seule
            </label>
            <button onClick={saveCfg}>Enregistrer</button>
            {status && <p style={{ marginTop: 14, color: "var(--green)" }}>✓ {status}</p>}
          </div>
        </>
      )}
    </>
  );
}
