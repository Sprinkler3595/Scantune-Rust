import { useEffect, useState } from "react";
import { NavLink, Route, Routes } from "react-router";
import { api, AuthStatus } from "./api";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Devices from "./pages/Devices";
import DeviceDetail from "./pages/DeviceDetail";
import Users from "./pages/Users";
import UserDetail from "./pages/UserDetail";
import QRCodes from "./pages/QRCodes";
import Inventory from "./pages/Inventory";
import Settings from "./pages/Settings";

const NAV = [
  { to: "/", label: "Tableau de bord", icon: "▦", end: true },
  { to: "/devices", label: "Appareils", icon: "▣" },
  { to: "/users", label: "Utilisateurs", icon: "☺" },
  { to: "/qrcodes", label: "QR / Étiquettes", icon: "▤" },
  { to: "/inventory", label: "Export & rapports", icon: "⤓" },
  { to: "/settings", label: "Paramètres", icon: "⚙" },
];

export default function App() {
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    api
      .authStatus()
      .then(setAuth)
      .catch(() => setAuth(null))
      .finally(() => setReady(true));
  }, []);

  // Avant le premier statut connu : écran neutre (pas d'appel Graph).
  if (!ready) {
    return (
      <div className="login-screen">
        <div className="loading" style={{ color: "#fff" }}>
          Chargement…
        </div>
      </div>
    );
  }

  // Porte d'entrée : tant qu'on n'est pas authentifié, on ne monte aucune page.
  if (!auth?.isAuthenticated) {
    return <Login onAuthenticated={setAuth} />;
  }

  const signOut = async () => {
    await api.signOut().catch(() => {});
    setAuth(await api.authStatus().catch(() => null));
  };

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <span>⬡ ScanTune</span>
        </div>
        <nav className="nav">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => (isActive ? "active" : "")}>
              <span className="icon">{n.icon}</span>
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="footer">
          Connecté
          <div className="badge">{auth.userName || "—"}</div>
          <div className="badge" style={{ marginLeft: 6 }}>
            Lecture seule
          </div>
          <button className="ghost signout-btn" onClick={signOut}>
            Se déconnecter
          </button>
        </div>
      </aside>
      <main className="main">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/devices" element={<Devices />} />
          <Route path="/devices/:id" element={<DeviceDetail />} />
          <Route path="/users" element={<Users />} />
          <Route path="/users/:id" element={<UserDetail />} />
          <Route path="/qrcodes" element={<QRCodes />} />
          <Route path="/inventory" element={<Inventory />} />
          <Route path="/settings" element={<Settings onSaved={() => api.authStatus().then(setAuth)} />} />
        </Routes>
      </main>
    </div>
  );
}
