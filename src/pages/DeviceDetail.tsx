import { ReactNode, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { Cell, Pie, PieChart } from "recharts";
import { openUrl } from "@tauri-apps/plugin-opener";
import { api, BitLockerRecoveryKey, DetectedApp, IntuneDevice } from "../api";
import {
  complianceColor,
  complianceDisplay,
  copyText,
  ErrorBanner,
  gb,
  Loading,
  relativeTime,
  statusBg,
  statusColor,
  storageColor,
} from "../components/common";

const MASK = "••••••-••••••-••••••-••••••-••••••-••••••-••••••-••••••";

/** Taille lisible (o / Ko / Mo / Go) — les apps pèsent souvent des Mo, pas des Go. */
function fmtAppSize(bytes: number): string {
  if (!bytes || bytes <= 0) return "—";
  const units = ["o", "Ko", "Mo", "Go", "To"];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function OsCircle({ os }: { os: string }) {
  const o = (os || "").toLowerCase();
  if (o.includes("windows")) {
    return (
      <div className="os-circle" style={{ background: "#E8EAF6" }}>
        <svg width="36" height="36" viewBox="0 0 24 24" fill="#3f51b5">
          <path d="M3 5.1 10.4 4v7.4H3zM10.4 12.6V20L3 18.9v-6.3zM11.3 3.9 21 2.5v9H11.3zM21 12.5v9l-9.7-1.4v-7.6z" />
        </svg>
      </div>
    );
  }
  const map: Record<string, { bg: string; emoji: string }> = {
    ios: { bg: "#F5F5F7", emoji: "" },
    macos: { bg: "#F5F5F7", emoji: "" },
    android: { bg: "#E8F5E9", emoji: "🤖" },
  };
  const m =
    Object.entries(map).find(([k]) => o.includes(k))?.[1] ?? { bg: "#ECEFF1", emoji: "💻" };
  return (
    <div className="os-circle" style={{ background: m.bg, fontSize: 30 }}>
      {m.emoji}
    </div>
  );
}

function Section({ icon, title, children }: { icon: string; title: string; children: ReactNode }) {
  return (
    <div className="detail-card">
      <div className="section-head">
        <span className="ico">{icon}</span>
        <span className="ttl">{title}</span>
      </div>
      {children}
    </div>
  );
}

function CopyField({ label, value }: { label: string; value: string }) {
  return (
    <>
      <div className="field-label">{label}</div>
      <div className="copy-row">
        <span className="field-value">{value || "—"}</span>
        <button className="copy-btn" title="Copier" onClick={() => copyText(value)}>
          ⧉
        </button>
      </div>
    </>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <div className="field-label">{label}</div>
      <div className="field-value">{children}</div>
    </>
  );
}

/**
 * Bannière d'alerte quand plusieurs appareils partagent le même numéro de série.
 * Un numéro de série est censé être unique : un doublon signale en général un
 * doublon d'inventaire (appareil ré-enrôlé, ré-imagé) ou une erreur de saisie.
 */
function DuplicateSerialWarning({
  serial,
  duplicates,
  onOpen,
}: {
  serial: string;
  duplicates: IntuneDevice[];
  onOpen: (id: string) => void;
}) {
  if (duplicates.length === 0) return null;
  const n = duplicates.length;
  const total = n + 1; // les doublons + l'appareil affiché
  return (
    <div className="dup-warning" role="alert">
      <div className="dup-head">
        <span className="dup-ico">⚠</span>
        <div>
          <div className="dup-title">
            Doublon de numéro de série détecté ({total} appareils)
          </div>
          <div className="dup-sub">
            Le numéro de série <code>{serial}</code> est également porté par {n} autre
            {n > 1 ? "s" : ""} appareil{n > 1 ? "s" : ""}. Un numéro de série devrait
            être unique : vérifiez qu'il ne s'agit pas d'un doublon d'inventaire
            (appareil ré-enrôlé ou ré-imagé) ou d'une erreur de saisie.
          </div>
        </div>
      </div>
      <div className="dup-list">
        {duplicates.map((o) => (
          <div className="dup-item" key={o.id}>
            <div className="dup-item-main">
              <span className="dup-name">{o.deviceName || "(sans nom)"}</span>
              <span className="dup-meta">
                👤 {o.userDisplayName || "Aucun utilisateur"} · 💻 {o.operatingSystem}{" "}
                {o.osVersion} · {o.manufacturer} {o.model || "—"}
              </span>
              <span className="dup-meta">
                🛡 {o.isCompliant ? "Conforme" : "Non conforme"} · ☁ Dernière sync{" "}
                {relativeTime(o.lastSyncDateTime)}
              </span>
            </div>
            <button className="ghost btn-sm dup-open" onClick={() => onOpen(o.id)}>
              Ouvrir →
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function DeviceDetail() {
  const { id = "" } = useParams();
  const nav = useNavigate();
  const [device, setDevice] = useState<IntuneDevice | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  // Doublons de numéro de série : autres appareils portant la même série.
  const [duplicates, setDuplicates] = useState<IntuneDevice[]>([]);

  // BitLocker
  const [keys, setKeys] = useState<BitLockerRecoveryKey[]>([]);
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const [blLoaded, setBlLoaded] = useState(false);
  const [blLoading, setBlLoading] = useState(false);
  const [blError, setBlError] = useState("");

  // Applications détectées
  const [apps, setApps] = useState<DetectedApp[]>([]);
  const [appsLoaded, setAppsLoaded] = useState(false);
  const [appsLoading, setAppsLoading] = useState(false);
  const [appsError, setAppsError] = useState("");
  const [appFilter, setAppFilter] = useState("");

  useEffect(() => {
    setLoading(true);
    setDuplicates([]);
    api
      .getDevice(id)
      .then((dev) => {
        setDevice(dev);
        // Détection des doublons : on compare la série (normalisée) à toute la
        // liste, servie depuis le cache. Best-effort — un échec ici ne doit pas
        // empêcher l'affichage de la fiche.
        const serial = (dev?.serialNumber || "").trim();
        if (dev && serial) {
          const key = serial.toLowerCase();
          api
            .getDevices()
            .then((all) => {
              setDuplicates(
                all.filter(
                  (o) =>
                    o.id !== dev.id &&
                    (o.serialNumber || "").trim().toLowerCase() === key
                )
              );
            })
            .catch(() => {
              /* détection de doublon indisponible : on ignore silencieusement */
            });
        }
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [id]);

  const copyInfo = () => {
    if (!device) return;
    const d = device;
    const lines = [
      `Nom : ${d.deviceName}`,
      `Utilisateur : ${d.userDisplayName} (${d.userPrincipalName})`,
      `Modèle : ${d.manufacturer} ${d.model}`,
      `N° Série : ${d.serialNumber}`,
      `OS : ${d.operatingSystem} ${d.osVersion}`,
      `Conformité : ${d.complianceState}`,
      `Dernière sync : ${d.lastSyncDateTime ? new Date(d.lastSyncDateTime).toLocaleString("fr-FR") : ""}`,
      `Enrollment : ${d.enrolledDateTime ? new Date(d.enrolledDateTime).toLocaleDateString("fr-FR") : ""}`,
      `Agent : ${d.managementAgent}`,
      `Catégorie : ${d.deviceCategoryDisplayName}`,
      `Azure AD ID : ${d.azureADDeviceId}`,
      `Stockage : ${d.storageUsedPercent}% utilisé`,
    ];
    if (d.notes.trim()) lines.push(`Notes : ${d.notes}`);
    copyText(lines.join("\n"));
  };

  const loadKeys = async () => {
    if (!device) return;
    if (!device.azureADDeviceId) {
      setBlError("Cet appareil n'a pas d'identifiant Azure AD : impossible de retrouver ses clés BitLocker.");
      setBlLoaded(true);
      return;
    }
    setBlLoading(true);
    setBlError("");
    setKeys([]);
    try {
      setKeys(await api.getBitlockerKeys(device.azureADDeviceId));
      setBlLoaded(true);
    } catch (e) {
      setBlError(
        `Impossible de récupérer les clés BitLocker : ${e}. Vérifiez la permission BitLockerKey.Read.All et votre rôle Entra.`
      );
      setBlLoaded(true);
    } finally {
      setBlLoading(false);
    }
  };

  const reveal = async (keyId: string) => {
    const v = await api.getBitlockerKeyValue(keyId);
    if (v) setRevealed((r) => ({ ...r, [keyId]: v }));
    else setBlError("La valeur de la clé n'a pas pu être récupérée.");
  };

  const loadApps = async () => {
    if (!device) return;
    setAppsLoading(true);
    setAppsError("");
    setApps([]);
    try {
      setApps(await api.getDeviceApps(device.id));
      setAppsLoaded(true);
    } catch (e) {
      setAppsError(
        `Impossible de récupérer les applications : ${e}. Vérifiez la permission DeviceManagementManagedDevices.Read.All et votre rôle Entra.`
      );
      setAppsLoaded(true);
    } finally {
      setAppsLoading(false);
    }
  };

  if (loading) return <Loading what="Chargement de l'appareil…" />;
  if (error) return <ErrorBanner message={error} />;
  if (!device) return <ErrorBanner message="Appareil introuvable." />;

  const d = device;
  const pct = d.storageUsedPercent;
  const usedBytes = Math.max(0, d.totalStorageSpaceInBytes - d.freeStorageSpaceInBytes);
  const fmtDT = (iso: string | null) =>
    iso ? new Date(iso).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" }) : "—";

  const badge = (status: string, icon: string, text: ReactNode) => (
    <span className="badge-pill" style={{ background: statusBg(status) }}>
      <span style={{ color: statusColor(status) }}>{icon}</span>
      {text}
    </span>
  );

  return (
    <>
      <div className="breadcrumb">
        Devices <span className="muted">/ {d.deviceName}</span>
      </div>

      {/* Action bar */}
      <div className="detail-actions">
        <button className="ghost btn-sm" onClick={() => nav("/devices")}>
          ← Retour à la liste
        </button>
        <div className="spacer" />
        <button className="ghost btn-sm" onClick={copyInfo}>
          ⧉ Copier les infos
        </button>
        {d.intunePortalUrl && (
          <button className="ghost btn-sm" onClick={() => openUrl(d.intunePortalUrl)}>
            ↗ Ouvrir dans Intune
          </button>
        )}
      </div>

      {/* Alerte doublon de numéro de série */}
      <DuplicateSerialWarning
        serial={d.serialNumber}
        duplicates={duplicates}
        onOpen={(otherId) => nav(`/devices/${otherId}`)}
      />

      {/* Header */}
      <div className="detail-card">
        <div className="hero">
          <OsCircle os={d.operatingSystem} />
          <div>
            <div className="name">{d.deviceName}</div>
            {d.userDisplayName && <div className="user">{d.userDisplayName}</div>}
            <div className="badges">
              {badge(d.complianceState, "🛡", complianceDisplay(d))}
              {badge(d.syncStatus, "☁", relativeTime(d.lastSyncDateTime))}
              {badge(d.storageStatus, "💾", <span>{pct}% <span className="dim">utilisé</span></span>)}
            </div>
          </div>
        </div>
      </div>

      {/* Mini KPIs */}
      <div className="mini-kpis">
        <div className="mini-kpi">
          <div className="circle" style={{ background: statusBg(d.complianceState), color: complianceColor(d.complianceState) }}>🛡</div>
          <div className="cap">Conformité</div>
          <div className="val">{complianceDisplay(d)}</div>
        </div>
        <div className="mini-kpi">
          <div className="circle" style={{ background: statusBg(d.syncStatus), color: statusColor(d.syncStatus) }}>☁</div>
          <div className="cap">Dernière sync</div>
          <div className="val">{relativeTime(d.lastSyncDateTime)}</div>
        </div>
        <div className="mini-kpi">
          <div className="circle" style={{ background: statusBg(d.storageStatus), color: statusColor(d.storageStatus) }}>💾</div>
          <div className="cap">Stockage</div>
          <div className="val">{pct}% utilisé</div>
        </div>
      </div>

      {/* Identité */}
      <Section icon="🪪" title="Identité">
        <div className="two-col">
          <div>
            <CopyField label="Nom de l'appareil" value={d.deviceName} />
            <div className="field-label">
              Numéro de série
              {duplicates.length > 0 && (
                <span className="dup-flag" title="Ce numéro de série est partagé par plusieurs appareils">
                  ⚠ Doublon ×{duplicates.length + 1}
                </span>
              )}
            </div>
            <div className="copy-row">
              <span className="field-value">{d.serialNumber || "—"}</span>
              <button className="copy-btn" title="Copier" onClick={() => copyText(d.serialNumber)}>
                ⧉
              </button>
            </div>
          </div>
          <div>
            <CopyField label="Azure AD Device ID" value={d.azureADDeviceId} />
            <CopyField label="Catégorie" value={d.deviceCategoryDisplayName || "Unknown"} />
          </div>
        </div>
      </Section>

      {/* Système + Utilisateur */}
      <div className="two-col">
        <Section icon="💻" title="Système">
          <Field label="Système d'exploitation">
            {d.operatingSystem} <span className="dim">{d.osVersion}</span>
          </Field>
          <Field label="Fabricant">{d.manufacturer || "—"}</Field>
          <Field label="Modèle">{d.model || "—"}</Field>
          <Field label="Type de propriétaire">{d.managedDeviceOwnerType || "—"}</Field>
          <Field label="État d'enregistrement">{d.deviceRegistrationState || "—"}</Field>
        </Section>
        <Section icon="👤" title="Utilisateur">
          <Field label="Nom complet">{d.userDisplayName || "—"}</Field>
          <Field label="Nom d'utilisateur (UPN)">{d.userPrincipalName || "—"}</Field>
        </Section>
      </div>

      {/* Gestion */}
      <Section icon="🛡" title="Gestion">
        <div className="two-col">
          <div>
            <div className="field-label">Conformité</div>
            <div className="row" style={{ gap: 8, marginBottom: 4 }}>
              <span className="dot" style={{ background: complianceColor(d.complianceState) }} />
              <span className="field-value">{d.complianceState || "—"}</span>
            </div>
            <Field label="Dernière synchronisation">
              {relativeTime(d.lastSyncDateTime)} <span className="dim">({fmtDT(d.lastSyncDateTime)})</span>
            </Field>
          </div>
          <div>
            <Field label="Date d'enrollment">{fmtDT(d.enrolledDateTime)}</Field>
            <Field label="Agent de gestion">{d.managementAgent || "—"}</Field>
          </div>
        </div>
      </Section>

      {/* Stockage */}
      <Section icon="💾" title="Stockage">
        <div className="storage-row">
          <div className="donut">
            <PieChart width={140} height={140}>
              <Pie
                data={[
                  { name: "Utilisé", value: pct },
                  { name: "Libre", value: 100 - pct },
                ]}
                dataKey="value"
                cx="50%"
                cy="50%"
                innerRadius={42}
                outerRadius={64}
                startAngle={90}
                endAngle={-270}
                stroke="none"
              >
                <Cell fill={storageColor(pct)} />
                <Cell fill="#E0E0E0" />
              </Pie>
            </PieChart>
            <div className="center">
              <span className="pct" style={{ color: storageColor(pct) }}>
                {pct}%
              </span>
              <span className="lbl">utilisé</span>
            </div>
          </div>
          <div className="storage-detail">
            <div className="row">
              <span style={{ fontWeight: 500 }}>
                {pct}% <span className="dim">utilisé</span>
              </span>
              <div className="spacer" />
              <span className="dim">
                {gb(usedBytes)} / {gb(d.totalStorageSpaceInBytes)}
              </span>
            </div>
            <div className="bar">
              <span style={{ width: `${pct}%`, background: storageColor(pct) }} />
            </div>
            <div className="storage-breakdown">
              <div>
                <div className="field-label">Total</div>
                <div style={{ fontWeight: 500 }}>{gb(d.totalStorageSpaceInBytes)}</div>
              </div>
              <div style={{ textAlign: "center" }}>
                <div className="field-label">Utilisé</div>
                <div style={{ fontWeight: 500 }}>{gb(usedBytes)}</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div className="field-label">Libre</div>
                <div style={{ fontWeight: 500 }}>{gb(d.freeStorageSpaceInBytes)}</div>
              </div>
            </div>
          </div>
        </div>
      </Section>

      {/* Applications installées */}
      <Section icon="📦" title="Applications installées">
        <div className="field-label">Droit requis</div>
        <div className="copy-row" style={{ marginBottom: 12 }}>
          <code>DeviceManagementManagedDevices.Read.All</code>
          <button
            className="copy-btn"
            title="Copier"
            onClick={() => copyText("DeviceManagementManagedDevices.Read.All")}
          >
            ⧉
          </button>
        </div>

        {!appsLoaded && !appsLoading && (
          <button onClick={loadApps} disabled={appsLoading}>
            📦 Charger les applications
          </button>
        )}
        {appsLoading && <p className="muted">Chargement…</p>}
        {appsError && <ErrorBanner message={appsError} />}
        {appsLoaded && !appsLoading && !appsError && apps.length === 0 && (
          <div className="bl-box" style={{ fontStyle: "italic", color: "var(--text-muted)" }}>
            Aucune application détectée pour cet appareil.
          </div>
        )}
        {appsLoaded && !appsLoading && apps.length > 0 && (
          <>
            <div className="row" style={{ gap: 8, marginBottom: 10 }}>
              <input
                type="text"
                placeholder="Filtrer par nom ou éditeur…"
                value={appFilter}
                onChange={(e) => setAppFilter(e.target.value)}
                style={{ flex: 1 }}
              />
              <span className="dim">{apps.length} apps</span>
            </div>
            {(() => {
              const q = appFilter.trim().toLowerCase();
              const list = q
                ? apps.filter(
                    (a) =>
                      a.displayName.toLowerCase().includes(q) ||
                      a.publisher.toLowerCase().includes(q)
                  )
                : apps;
              if (list.length === 0)
                return <p className="muted">Aucune application ne correspond au filtre.</p>;
              return list.map((a) => (
                <div className="bl-box" key={a.id} style={{ marginBottom: 8 }}>
                  <div className="row" style={{ gap: 8, alignItems: "baseline" }}>
                    <span style={{ fontWeight: 500 }}>{a.displayName || "—"}</span>
                    {a.version && <span className="dim">v{a.version}</span>}
                    <div className="spacer" />
                    {a.sizeInByte > 0 && <span className="dim">{fmtAppSize(a.sizeInByte)}</span>}
                  </div>
                  {a.publisher && (
                    <div className="field-label" style={{ marginTop: 2 }}>
                      {a.publisher}
                    </div>
                  )}
                </div>
              ));
            })()}
          </>
        )}
      </Section>

      {/* BitLocker */}
      <Section icon="🔐" title="Clés BitLocker">
        <button onClick={loadKeys} disabled={blLoading} style={{ marginBottom: 12 }}>
          🛡 Charger les clés BitLocker
        </button>
        {blLoading && <p className="muted">Chargement…</p>}
        {blError && <ErrorBanner message={blError} />}
        {blLoaded && !blLoading && !blError && keys.length === 0 && (
          <div className="bl-box" style={{ fontStyle: "italic", color: "var(--text-muted)" }}>
            Aucune clé BitLocker trouvée pour cet appareil.
          </div>
        )}
        {keys.map((k) => (
          <div className="bl-box" key={k.id}>
            <div className="field-label">Key ID</div>
            <div className="copy-row" style={{ marginBottom: 8 }}>
              <code>{k.id}</code>
              <button className="copy-btn" onClick={() => copyText(k.id)}>
                ⧉
              </button>
            </div>
            <div className="two-col">
              <div>
                <div className="field-label">Volume</div>
                <div style={{ fontWeight: 500 }}>{k.volumeType}</div>
              </div>
              <div>
                <div className="field-label">Créée le</div>
                <div style={{ fontWeight: 500 }}>{fmtDT(k.createdDateTime)}</div>
              </div>
            </div>
            <div className="field-label">Clé de récupération</div>
            <div className="copy-row">
              {revealed[k.id] ? (
                <code style={{ wordBreak: "break-all" }}>{revealed[k.id]}</code>
              ) : (
                <span className="mono" style={{ color: "var(--text-muted)" }}>{MASK}</span>
              )}
              <div className="spacer" />
              {revealed[k.id] ? (
                <button className="copy-btn" onClick={() => copyText(revealed[k.id])}>⧉</button>
              ) : (
                <button className="ghost btn-sm" onClick={() => reveal(k.id)}>👁 Afficher</button>
              )}
            </div>
          </div>
        ))}
      </Section>

      {/* Notes */}
      <Section icon="📝" title="Notes Intune">
        <div className="bl-box" style={{ minHeight: 40 }}>
          {d.notes.trim() ? (
            <span style={{ whiteSpace: "pre-wrap" }}>{d.notes}</span>
          ) : (
            <span style={{ fontStyle: "italic", color: "var(--text-muted)" }}>Aucune note</span>
          )}
        </div>
      </Section>

      {/* Historique (placeholder) */}
      <Section icon="🕐" title="Historique">
        <div className="empty-state">
          <div className="big">🕐</div>
          <p style={{ fontWeight: 300, fontSize: 16 }}>Historique des actions</p>
          <p className="muted">Module disponible dans une prochaine version</p>
        </div>
      </Section>
    </>
  );
}
