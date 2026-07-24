import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { api, EntraUser } from "../api";
import { ErrorBanner, Loading } from "../components/common";

export default function Users() {
  const [users, setUsers] = useState<EntraUser[]>([]);
  const [query, setQuery] = useState("");
  const [dept, setDept] = useState("");
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

  useEffect(() => load(), []);

  const depts = useMemo(
    () => [...new Set(users.map((u) => u.department).filter(Boolean))].sort(),
    [users]
  );

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    return users.filter((u) => {
      if (dept && u.department !== dept) return false;
      if (!q) return true;
      return (
        u.displayName.toLowerCase().includes(q) ||
        u.userPrincipalName.toLowerCase().includes(q) ||
        u.mail.toLowerCase().includes(q)
      );
    });
  }, [users, query, dept]);

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
      </div>

      {error && <ErrorBanner message={error} />}
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
                  <td>
                    {u.accountEnabled ? (
                      <span className="chip green">Actif</span>
                    ) : (
                      <span className="chip red">Désactivé</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
