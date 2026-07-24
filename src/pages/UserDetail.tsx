import { ReactNode, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { api, EntraUser } from "../api";
import { ComplianceChip, ErrorBanner, Loading } from "../components/common";

export default function UserDetail() {
  const { id = "" } = useParams();
  const [user, setUser] = useState<EntraUser | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const nav = useNavigate();

  useEffect(() => {
    setLoading(true);
    api
      .getUser(id)
      .then(setUser)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <Loading what="Chargement…" />;
  if (error) return <ErrorBanner message={error} />;
  if (!user) return <ErrorBanner message="Utilisateur introuvable." />;

  const Row = ({ k, v }: { k: string; v: ReactNode }) => (
    <tr>
      <td className="muted" style={{ width: 180 }}>
        {k}
      </td>
      <td>{v || "—"}</td>
    </tr>
  );

  return (
    <>
      <h1 className="page-title">{user.displayName}</h1>
      <p className="page-sub">
        {user.jobTitle} {user.department && `· ${user.department}`}
      </p>

      <div className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <div className="card">
          <h3 className="section-title">Profil</h3>
          <table>
            <tbody>
              <Row k="UPN" v={user.userPrincipalName} />
              <Row k="Email" v={user.mail} />
              <Row k="Société" v={user.companyName} />
              <Row k="Bureau" v={user.officeLocation} />
              <Row k="Téléphone" v={user.mobilePhone} />
              <Row
                k="Compte"
                v={user.accountEnabled ? <span className="chip green">Actif</span> : <span className="chip red">Désactivé</span>}
              />
            </tbody>
          </table>
        </div>

        <div className="card">
          <h3 className="section-title">Appareils associés ({user.devices.length})</h3>
          <table>
            <thead>
              <tr>
                <th>Nom</th>
                <th>OS</th>
                <th>Conformité</th>
              </tr>
            </thead>
            <tbody>
              {user.devices.map((d) => (
                <tr key={d.id} onClick={() => nav(`/devices/${d.id}`)}>
                  <td>{d.deviceName}</td>
                  <td>{d.operatingSystem}</td>
                  <td>
                    <ComplianceChip device={d} />
                  </td>
                </tr>
              ))}
              {user.devices.length === 0 && (
                <tr>
                  <td colSpan={3} className="muted center">
                    Aucun appareil.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
