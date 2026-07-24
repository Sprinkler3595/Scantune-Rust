import { useEffect, useMemo, useState } from "react";
import { api, EntraUser, IntuneDevice } from "../api";
import { ErrorBanner, Loading } from "../components/common";
import LabelRender from "../components/LabelRender";
import PrintPortal from "../components/PrintPortal";
import { LabelTemplate, SAMPLE_DEVICE } from "../labelTemplate";

/**
 * Attend que toutes les images de la zone imprimable soient décodées.
 *
 * Sans ça, l'impression peut partir avec des QR vides : `print()` ne patiente
 * pas après le chargement des images.
 */
async function awaitPrintImages() {
  const root = document.querySelector(".print-root");
  if (!root) return;
  await Promise.all(
    Array.from(root.querySelectorAll("img")).map((img) => img.decode().catch(() => {}))
  );
}

export default function QRCodes() {
  const [devices, setDevices] = useState<IntuneDevice[]>([]);
  const [companyByUpn, setCompanyByUpn] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [search, setSearch] = useState("");
  const [filterOs, setFilterOs] = useState("Tous");
  const [filterCompliance, setFilterCompliance] = useState("Tous");
  const [filterCompany, setFilterCompany] = useState("Tous");

  const [template, setTemplate] = useState<LabelTemplate | null>(null);
  const [qrSvgs, setQrSvgs] = useState<Record<string, string>>({});
  const [status, setStatus] = useState("Chargez d'abord les appareils.");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = () => {
    setLoading(true);
    setError("");
    api
      .getDevices()
      .then(async (devs) => {
        setDevices(devs);
        try {
          const users: EntraUser[] = await api.getUsers();
          const map: Record<string, string> = {};
          for (const u of users)
            if (u.companyName && u.userPrincipalName)
              map[u.userPrincipalName.toLowerCase()] = u.companyName;
          setCompanyByUpn(map);
        } catch {
          /* users peut échouer sans permission — on continue */
        }
        setStatus(`${devs.length} appareils disponibles`);
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  };

  useEffect(() => load(), []);

  // Le template peut avoir changé dans les Paramètres : on le relit à chaque
  // arrivée sur la page plutôt que de le mettre en cache.
  useEffect(() => {
    api.getLabelTemplate().then(setTemplate).catch((e) => setError(String(e)));
  }, []);

  const companyOf = (d: IntuneDevice) => companyByUpn[d.userPrincipalName?.toLowerCase()] ?? "";

  const osList = useMemo(
    () => ["Tous", ...new Set(devices.map((d) => d.operatingSystem).filter(Boolean))].sort((a, b) => (a === "Tous" ? -1 : a.localeCompare(b))),
    [devices]
  );
  const companies = useMemo(
    () => ["Tous", ...[...new Set(Object.values(companyByUpn))].sort()],
    [companyByUpn]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return devices.filter((d) => {
      if (q) {
        const hit =
          d.deviceName.toLowerCase().includes(q) ||
          d.serialNumber.toLowerCase().includes(q) ||
          d.userDisplayName.toLowerCase().includes(q) ||
          d.userPrincipalName.toLowerCase().includes(q) ||
          d.model.toLowerCase().includes(q) ||
          d.manufacturer.toLowerCase().includes(q);
        if (!hit) return false;
      }
      if (filterOs !== "Tous" && !d.operatingSystem.toLowerCase().includes(filterOs.toLowerCase())) return false;
      if (filterCompliance === "Compliant" && !d.isCompliant) return false;
      if (filterCompliance === "NonCompliant" && d.isCompliant) return false;
      if (filterCompany !== "Tous" && companyOf(d) !== filterCompany) return false;
      return true;
    });
  }, [devices, search, filterOs, filterCompliance, filterCompany, companyByUpn]);

  const selectedDevices = useMemo(
    () =>
      devices
        .filter((d) => selected.has(d.id))
        .sort((a, b) => a.deviceName.toLowerCase().localeCompare(b.deviceName.toLowerCase())),
    [devices, selected]
  );

  // Les QR de la sélection, en un seul aller-retour IPC.
  useEffect(() => {
    const ids = selectedDevices.map((d) => d.id);
    if (!ids.length) return setQrSvgs({});
    let cancelled = false;
    api
      .generateQrSvgs(ids)
      .then((svgs) => {
        if (cancelled) return;
        setQrSvgs(Object.fromEntries(ids.map((id, i) => [id, svgs[i]])));
      })
      .catch((e) => !cancelled && setError(String(e)));
    return () => {
      cancelled = true;
    };
  }, [selectedDevices]);

  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  const selectAll = () => setSelected(new Set(filtered.map((d) => d.id)));
  const deselectAll = () => setSelected(new Set());
  const clearFilters = () => {
    setSearch("");
    setFilterOs("Tous");
    setFilterCompliance("Tous");
    setFilterCompany("Tous");
  };

  const print = async () => {
    if (!selectedDevices.length) return setStatus("Aucun appareil sélectionné");
    setBusy(true);
    setError("");
    try {
      await awaitPrintImages();
      await api.printLabels();
      setStatus(`${selectedDevices.length} étiquette(s) envoyée(s) au dialogue d'impression`);
    } catch (e) {
      setError(`Impression impossible : ${e}`);
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <Loading what="Chargement des appareils…" />;

  const previewDevice = selectedDevices[0] ?? SAMPLE_DEVICE;

  return (
    <>
      <div className="row">
        <div>
          <h1 className="page-title">QR codes & étiquettes</h1>
          <p className="page-sub">{status}</p>
        </div>
        <div className="spacer" />
        <button className="ghost" onClick={load}>⟳ Recharger</button>
      </div>

      {error && <ErrorBanner message={error} />}

      <div className="toolbar">
        <input
          type="search"
          placeholder="Rechercher (nom, série, utilisateur, modèle)…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select value={filterOs} onChange={(e) => setFilterOs(e.target.value)}>
          {osList.map((o) => (
            <option key={o} value={o}>{o === "Tous" ? "Tous les OS" : o}</option>
          ))}
        </select>
        <select value={filterCompliance} onChange={(e) => setFilterCompliance(e.target.value)}>
          <option value="Tous">Toute conformité</option>
          <option value="Compliant">Conformes</option>
          <option value="NonCompliant">Non conformes</option>
        </select>
        <select value={filterCompany} onChange={(e) => setFilterCompany(e.target.value)}>
          {companies.map((c) => (
            <option key={c} value={c}>{c === "Tous" ? "Toutes sociétés" : c}</option>
          ))}
        </select>
        <button className="ghost" onClick={clearFilters}>Effacer</button>
      </div>

      <div className="grid" style={{ gridTemplateColumns: "2fr 1fr" }}>
        {/* Liste sélectionnable */}
        <div className="card" style={{ padding: 0 }}>
          <div className="toolbar" style={{ padding: 14, marginBottom: 0 }}>
            <button className="ghost" onClick={selectAll}>Tout sélectionner</button>
            <button className="ghost" onClick={deselectAll}>Tout désélectionner</button>
            <div className="spacer" />
            <span className="muted">
              {selected.size} sélectionné(s) · {filtered.length} affiché(s)
            </span>
          </div>
          <div style={{ maxHeight: "calc(100vh - 360px)", overflowY: "auto" }}>
            <table>
              <thead>
                <tr>
                  <th></th>
                  <th>Nom</th>
                  <th>N° Série</th>
                  <th>Utilisateur</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((d) => (
                  <tr key={d.id} style={{ cursor: "default" }} onClick={() => toggle(d.id)}>
                    <td>
                      <input type="checkbox" checked={selected.has(d.id)} readOnly />
                    </td>
                    <td>{d.deviceName}</td>
                    <td>{d.serialNumber}</td>
                    <td>{d.userDisplayName || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Aperçu + impression */}
        <div>
          <div className="card" style={{ marginBottom: 18 }}>
            <h3 className="section-title">Aperçu étiquette</h3>
            {template ? (
              <LabelRender
                template={template}
                device={previewDevice}
                qrSvg={qrSvgs[previewDevice.id]}
                className="label-canvas"
              />
            ) : (
              <p className="muted">Chargement du template…</p>
            )}
            <p className="muted" style={{ marginTop: 10, fontSize: 12 }}>
              {selectedDevices.length ? "Première sélection." : "Exemple — sélectionne un appareil."}{" "}
              Mise en page modifiable dans Paramètres › Étiquette.
            </p>
          </div>

          <div className="card">
            <h3 className="section-title">Impression</h3>
            <p className="muted">
              Une étiquette par appareil sélectionné. Le format et la résolution viennent des
              réglages de ton imprimante, pas de l'application.
            </p>
            <button onClick={print} disabled={busy || selected.size === 0}>
              ⎙ Imprimer {selected.size || ""} étiquette{selected.size > 1 ? "s" : ""}
            </button>
            {busy && <p className="muted" style={{ marginTop: 12 }}>Préparation…</p>}
          </div>
        </div>
      </div>

      {/* Hors de `.app` (voir PrintPortal) et jamais démonté après impression. */}
      {template && (
        <PrintPortal>
          {selectedDevices.map((d) => (
            <LabelRender
              key={d.id}
              template={template}
              device={d}
              qrSvg={qrSvgs[d.id]}
              className="print-page"
            />
          ))}
        </PrintPortal>
      )}
    </>
  );
}
