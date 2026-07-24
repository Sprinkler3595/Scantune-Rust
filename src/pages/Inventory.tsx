import { useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { api } from "../api";
import { ErrorBanner } from "../components/common";

const SCOPES = [
  { value: "all", label: "Tous les appareils" },
  { value: "compliant", label: "Appareils conformes" },
  { value: "noncompliant", label: "Appareils non conformes" },
  { value: "stale", label: "Appareils obsolètes (>30j)" },
];

export default function Inventory() {
  const [scope, setScope] = useState("all");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const run = async (
    label: string,
    ext: string,
    filterName: string,
    fn: (path: string) => Promise<void>
  ) => {
    setError("");
    setStatus("");
    try {
      const path = await save({
        defaultPath: `inventaire.${ext}`,
        filters: [{ name: filterName, extensions: [ext] }],
      });
      if (!path) return;
      setBusy(true);
      await fn(path);
      setStatus(`${label} généré : ${path}`);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h1 className="page-title">Export & rapports</h1>
      <p className="page-sub">Génère des exports d'inventaire (lecture seule).</p>

      {error && <ErrorBanner message={error} />}

      <div className="card" style={{ maxWidth: 640 }}>
        <div className="field">
          <label>Périmètre</label>
          <select value={scope} onChange={(e) => setScope(e.target.value)} style={{ width: "100%" }}>
            {SCOPES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>

        <div className="row" style={{ flexWrap: "wrap", gap: 12, marginTop: 8 }}>
          <button disabled={busy} onClick={() => run("CSV", "csv", "CSV", (p) => api.exportCsv(p, scope))}>
            Export CSV
          </button>
          <button
            disabled={busy}
            onClick={() => run("Excel", "xlsx", "Excel", (p) => api.exportDevicesXlsx(p, scope))}
          >
            Export Excel
          </button>
          <button
            disabled={busy}
            onClick={() => run("Rapport PDF", "pdf", "PDF", (p) => api.exportInventoryPdf(p, scope))}
          >
            Rapport PDF
          </button>
        </div>

        <hr style={{ margin: "22px 0", border: "none", borderTop: "1px solid var(--border)" }} />

        <button
          className="ghost"
          disabled={busy}
          onClick={() => run("Excel utilisateurs", "xlsx", "Excel", (p) => api.exportUsersXlsx(p))}
        >
          Export Excel — utilisateurs
        </button>

        {busy && <p className="muted" style={{ marginTop: 14 }}>Génération en cours…</p>}
        {status && <p style={{ marginTop: 14, color: "var(--green)" }}>✓ {status}</p>}
      </div>
    </>
  );
}
