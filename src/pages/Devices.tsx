import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { api, IntuneDevice } from "../api";
import { ComplianceChip, ErrorBanner, fmtDate, Loading, SyncChip } from "../components/common";

export default function Devices() {
  const [devices, setDevices] = useState<IntuneDevice[]>([]);
  const [query, setQuery] = useState("");
  const [osFilter, setOsFilter] = useState("");
  const [compFilter, setCompFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const nav = useNavigate();

  const load = (force = false) => {
    setLoading(true);
    setError("");
    api
      .getDevices(force)
      .then(setDevices)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  };

  useEffect(() => load(), []);

  const osList = useMemo(
    () => [...new Set(devices.map((d) => d.operatingSystem).filter(Boolean))].sort(),
    [devices]
  );

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    return devices.filter((d) => {
      if (osFilter && d.operatingSystem !== osFilter) return false;
      if (compFilter === "compliant" && !d.isCompliant) return false;
      if (compFilter === "noncompliant" && d.isCompliant) return false;
      if (compFilter === "stale" && d.daysSinceLastSync <= 30) return false;
      if (!q) return true;
      return (
        d.deviceName.toLowerCase().includes(q) ||
        d.serialNumber.toLowerCase().includes(q) ||
        d.userDisplayName.toLowerCase().includes(q)
      );
    });
  }, [devices, query, osFilter, compFilter]);

  return (
    <>
      <div className="row">
        <div>
          <h1 className="page-title">Appareils</h1>
          <p className="page-sub">{filtered.length} appareil(s) affiché(s)</p>
        </div>
        <div className="spacer" />
        <button className="ghost" onClick={() => load(true)}>
          ⟳ Rafraîchir
        </button>
      </div>

      <div className="toolbar">
        <input
          type="search"
          placeholder="Rechercher (nom, série, utilisateur)…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select value={osFilter} onChange={(e) => setOsFilter(e.target.value)}>
          <option value="">Tous les OS</option>
          {osList.map((os) => (
            <option key={os} value={os}>
              {os}
            </option>
          ))}
        </select>
        <select value={compFilter} onChange={(e) => setCompFilter(e.target.value)}>
          <option value="">Toute conformité</option>
          <option value="compliant">Conformes</option>
          <option value="noncompliant">Non conformes</option>
          <option value="stale">Obsolètes (&gt;30j)</option>
        </select>
      </div>

      {error && <ErrorBanner message={error} />}
      {loading ? (
        <Loading what="Chargement des appareils…" />
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <table>
            <thead>
              <tr>
                <th>Nom</th>
                <th>Utilisateur</th>
                <th>OS</th>
                <th>Modèle</th>
                <th>N° Série</th>
                <th>Conformité</th>
                <th>Dernière sync</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((d) => (
                <tr key={d.id} onClick={() => nav(`/devices/${d.id}`)}>
                  <td>{d.deviceName}</td>
                  <td>{d.userDisplayName || "—"}</td>
                  <td>
                    {d.operatingSystem} {d.osVersion}
                  </td>
                  <td>
                    {d.manufacturer} {d.model}
                  </td>
                  <td>{d.serialNumber}</td>
                  <td>
                    <ComplianceChip device={d} />
                  </td>
                  <td>
                    <SyncChip device={d} /> <span className="muted">{fmtDate(d.lastSyncDateTime)}</span>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="muted center" style={{ padding: 40 }}>
                    Aucun appareil ne correspond.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
