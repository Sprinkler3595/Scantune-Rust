import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { api, EntraUser } from "../api";
import {
  ErrorBanner,
  Loading,
  PasswordChip,
  WarnBanner,
  fmtDate,
} from "../components/common";

export default function Users() {
  const [users, setUsers] = useState<EntraUser[]>([]);
  const [query, setQuery] = useState("");
  const [dept, setDept] = useState("");
  /** Filtre sur l'ancienneté du mot de passe : tous / à renouveler / bientôt. */
  const [pwd, setPwd] = useState("");
  const [maxAgeDays, setMaxAgeDays] = useState(180);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const nav = useNavigate();

  const load = (force = false) => {
    setLoading(true);
    setError("");
    api
      .getUsers(force)
      .then(setUsers)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // Seuil configuré (Paramètres) : sert uniquement au libellé affiché.
    api.getConfig().then((c) => setMaxAgeDays(c.passwordMaxAgeDays)).catch(() => {});
  }, []);

  const depts = useMemo(
    () => [...new Set(users.map((u) => u.department).filter(Boolean))].sort(),
    [users]
  );

  /** Comptes actifs dont le mot de passe a dépassé le seuil. */
  const alertCount = useMemo(
    () => users.filter((u) => u.accountEnabled && u.passwordAlert).length,
    [users]
  );

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    return users.filter((u) => {
      if (dept && u.department !== dept) return false;
      if (pwd === "alert" && u.passwordStatus !== "Alert") return false;
      if (pwd === "soon" && u.passwordStatus !== "Warning") return false;
      if (pwd === "unknown" && u.passwordStatus !== "Unknown") return false;
      if (!q) return true;
      return (
        u.displayName.toLowerCase().includes(q) ||
        u.userPrincipalName.toLowerCase().includes(q) ||
        u.mail.toLowerCase().includes(q)
      );
    });
  }, [users, query, dept, pwd]);

  const months = Math.round(maxAgeDays / 30);

  return (
    <>
      <div className="row">
        <div>
          <h1 className="page-title">Utilisateurs</h1>
          <p className="page-sub">{filtered.length} utilisateur(s)</p>
        </div>
        <div className="spacer" />
        <button className="ghost" onClick={() => load(true)}>
          ⟳ Rafraîchir
        </button>
      </div>

      <div className="toolbar">
        <input
          type="search"
          placeholder="Rechercher (nom, UPN, email)…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select value={dept} onChange={(e) => setDept(e.target.value)}>
          <option value="">Tous les départements</option>
          {depts.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
        <select value={pwd} onChange={(e) => setPwd(e.target.value)}>
          <option value="">Tous les mots de passe</option>
          <option value="alert">À renouveler (&gt; {months} mois)</option>
          <option value="soon">Échéance proche</option>
          <option value="unknown">Date inconnue</option>
        </select>
      </div>

      {error && <ErrorBanner message={error} />}
      {!loading && alertCount > 0 && (
        <WarnBanner>
          ⚠ <strong>{alertCount}</strong> compte(s) actif(s) n'ont pas changé de mot de
          passe depuis plus de {months} mois — à contacter.{" "}
          {pwd !== "alert" && (
            <button className="link-btn" onClick={() => setPwd("alert")}>
              Voir la liste
            </button>
          )}
        </WarnBanner>
      )}

      {loading ? (
        <Loading what="Chargement des utilisateurs…" />
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <table>
            <thead>
              <tr>
                <th>Nom</th>
                <th>Poste</th>
                <th>Département</th>
                <th>Email</th>
                <th>Dernier chgt MdP</th>
                <th>Ancienneté MdP</th>
                <th>Statut</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((u) => (
                <tr key={u.id} onClick={() => nav(`/users/${u.id}`)}>
                  <td>{u.displayName}</td>
                  <td>{u.jobTitle || "—"}</td>
                  <td>{u.department || "—"}</td>
                  <td>{u.mail || u.userPrincipalName}</td>
                  <td>{fmtDate(u.lastPasswordChangeDateTime)}</td>
                  <td>
                    <PasswordChip user={u} />
                  </td>
                  <td>
                    {u.accountEnabled ? (
                      <span className="chip green">Actif</span>
                    ) : (
                      <span className="chip red">Désactivé</span>
                    )}
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="muted center">
                    Aucun utilisateur ne correspond aux filtres.
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
