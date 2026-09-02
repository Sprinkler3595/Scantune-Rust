import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import {
  Bar,
  BarChart,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api, DashboardStats, PasswordAlertStats } from "../api";
import {
  ComplianceChip,
  ErrorBanner,
  Loading,
  PasswordChip,
  SyncChip,
  fmtDate,
} from "../components/common";

const OS_COLORS = ["#3f51b5", "#00897b", "#fb8c00", "#8e24aa", "#43a047", "#e53935", "#6d4c41"];

export default function Dashboard() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [pwd, setPwd] = useState<PasswordAlertStats | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const nav = useNavigate();

  const load = (force = false) => {
    setLoading(true);
    setError("");
    api
      .dashboardStats(force)
      .then(setStats)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
    // Requête séparée (appareils vs utilisateurs) : un échec côté mots de
    // passe ne doit pas vider le reste du tableau de bord.
    api
      .passwordAlerts(force)
      .then(setPwd)
      .catch(() => setPwd(null));
  };

  useEffect(() => {
    load();
    // Rafraîchissement auto toutes les 5 minutes (comme la version WPF).
    const t = setInterval(() => load(true), 5 * 60 * 1000);
    return () => clearInterval(t);
  }, []);

  if (loading && !stats) return <Loading what="Chargement du tableau de bord…" />;

  return (
    <>
      <div className="row">
        <div>
          <h1 className="page-title">Tableau de bord</h1>
          <p className="page-sub">Vue d'ensemble du parc Intune</p>
        </div>
        <div className="spacer" />
        <button className="ghost" onClick={() => load(true)}>
          ⟳ Rafraîchir
        </button>
      </div>

      {error && <ErrorBanner message={error} />}

      {stats && (
        <>
          <div className="grid kpi-grid">
            <div className="kpi">
              <div className="label">Total appareils</div>
              <div className="value">{stats.total}</div>
            </div>
            <div className="kpi green">
              <div className="label">Conformes</div>
              <div className="value">
                {stats.compliant}
                <span style={{ fontSize: 16 }}> ({stats.complianceRate}%)</span>
              </div>
            </div>
            <div className="kpi red">
              <div className="label">Non conformes</div>
              <div className="value">{stats.nonCompliant}</div>
            </div>
            <div className="kpi orange">
              <div className="label">Obsolètes (&gt;30j)</div>
              <div className="value">{stats.stale}</div>
            </div>
            {pwd && (
              <div className={pwd.alertCount > 0 ? "kpi red" : "kpi green"}>
                <div className="label">
                  Mots de passe &gt; {Math.round(pwd.maxAgeDays / 30)} mois
                </div>
                <div className="value">{pwd.alertCount}</div>
              </div>
            )}
          </div>

          <div className="grid charts">
            <div className="card">
              <h3 className="section-title">Répartition par OS</h3>
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie
                    data={stats.byOs}
                    dataKey="count"
                    nameKey="label"
                    cx="50%"
                    cy="50%"
                    outerRadius={90}
                    label={(e) => `${e.label} (${e.count})`}
                  >
                    {stats.byOs.map((_, i) => (
                      <Cell key={i} fill={OS_COLORS[i % OS_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="card">
              <h3 className="section-title">État de conformité</h3>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={stats.byCompliance}>
                  <XAxis dataKey="label" fontSize={12} />
                  <YAxis allowDecimals={false} fontSize={12} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="count" name="Appareils" fill="#3f51b5" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="grid charts">
            <div className="card">
              <h3 className="section-title">Inscrits récemment</h3>
              <table>
                <thead>
                  <tr>
                    <th>Nom</th>
                    <th>OS</th>
                    <th>Conformité</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.recentlyEnrolled.map((d) => (
                    <tr key={d.id} onClick={() => nav(`/devices/${d.id}`)}>
                      <td>{d.deviceName}</td>
                      <td>{d.operatingSystem}</td>
                      <td>
                        <ComplianceChip device={d} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="card">
              <h3 className="section-title">Appareils obsolètes</h3>
              <table>
                <thead>
                  <tr>
                    <th>Nom</th>
                    <th>Utilisateur</th>
                    <th>Sync</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.staleDevices.map((d) => (
                    <tr key={d.id} onClick={() => nav(`/devices/${d.id}`)}>
                      <td>{d.deviceName}</td>
                      <td>{d.userDisplayName || "—"}</td>
                      <td>
                        <SyncChip device={d} />
                      </td>
                    </tr>
                  ))}
                  {stats.staleDevices.length === 0 && (
                    <tr>
                      <td colSpan={3} className="muted center">
                        Aucun appareil obsolète 🎉
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
          {pwd && (
            <div className="card" style={{ marginBottom: 22 }}>
              <div className="row">
                <h3 className="section-title" style={{ margin: 0 }}>
                  Mots de passe à renouveler
                </h3>
                <div className="spacer" />
                <span className="muted" style={{ fontSize: 13 }}>
                  seuil : {pwd.maxAgeDays} j · {pwd.warningCount} échéance(s) proche(s) ·{" "}
                  {pwd.unknownCount} date(s) inconnue(s)
                </span>
              </div>
              <table style={{ marginTop: 12 }}>
                <thead>
                  <tr>
                    <th>Utilisateur</th>
                    <th>Email</th>
                    <th>Département</th>
                    <th>Dernier changement</th>
                    <th>Ancienneté</th>
                  </tr>
                </thead>
                <tbody>
                  {pwd.users.slice(0, 15).map((u) => (
                    <tr key={u.id} onClick={() => nav(`/users/${u.id}`)}>
                      <td>{u.displayName}</td>
                      <td>{u.mail || u.userPrincipalName}</td>
                      <td>{u.department || "—"}</td>
                      <td>{fmtDate(u.lastPasswordChangeDateTime)}</td>
                      <td>
                        <PasswordChip user={u} />
                      </td>
                    </tr>
                  ))}
                  {pwd.users.length === 0 && (
                    <tr>
                      <td colSpan={5} className="muted center">
                        Tous les mots de passe sont à jour 🎉
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
              {pwd.users.length > 15 && (
                <p className="muted" style={{ marginTop: 10 }}>
                  … et {pwd.users.length - 15} autre(s) —{" "}
                  <button className="link-btn" onClick={() => nav("/users")}>
                    voir tous les utilisateurs
                  </button>
                </p>
              )}
            </div>
          )}
        </>
      )}
    </>
  );
}
