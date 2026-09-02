import { ReactNode } from "react";
import { EntraUser, IntuneDevice, PasswordStatus } from "../api";

export function fmtBytes(bytes: number): string {
  if (bytes <= 0) return "—";
  return (bytes / 1_073_741_824).toFixed(1) + " Go";
}

/** "476.0 Go" — équivalent de BytesToGbConverter. */
export function gb(bytes: number): string {
  return (Math.max(0, bytes) / 1_073_741_824).toFixed(1) + " Go";
}

/** Port de RelativeTimeConverter ("il y a 4 mois"). */
export function relativeTime(iso: string | null): string {
  if (!iso) return "—";
  const mins = (Date.now() - new Date(iso).getTime()) / 60000;
  if (mins < 1) return "à l'instant";
  if (mins < 60) return `il y a ${Math.floor(mins)} min`;
  const hours = mins / 60;
  if (hours < 24) return `il y a ${Math.floor(hours)}h`;
  const days = hours / 24;
  if (days < 7) {
    const d = Math.floor(days);
    return `il y a ${d} jour${d > 1 ? "s" : ""}`;
  }
  if (days < 30) return `il y a ${Math.floor(days / 7)} sem.`;
  if (days < 365) return `il y a ${Math.floor(days / 30)} mois`;
  const y = Math.floor(days / 365);
  return `il y a ${y} an${y > 1 ? "s" : ""}`;
}

/** Port de StatusToColorConverter. */
export function statusColor(status: string): string {
  switch ((status || "").toLowerCase()) {
    case "healthy":
    case "fresh":
    case "recent":
    case "compliant":
      return "#4CAF50";
    case "warning":
    case "ingraceperiod":
      return "#FF9800";
    case "stale":
    case "critical":
    case "noncompliant":
    case "non-compliant":
      return "#F44336";
    default:
      return "#B0BEC5";
  }
}

/** Port de StatusToBackgroundConverter. */
export function statusBg(status: string): string {
  switch ((status || "").toLowerCase()) {
    case "healthy":
    case "fresh":
    case "recent":
    case "compliant":
      return "#E8F5E9";
    case "warning":
    case "ingraceperiod":
      return "#FFF3E0";
    case "stale":
    case "critical":
    case "noncompliant":
    case "non-compliant":
      return "#FFEBEE";
    default:
      return "#ECEFF1";
  }
}

/** Port de ComplianceToColorConverter. */
export function complianceColor(state: string): string {
  const s = (state || "").toLowerCase();
  if (s === "compliant") return "#4CAF50";
  if (s === "noncompliant") return "#F44336";
  return "#FF9800";
}

/** Port de StorageToColorConverter. */
export function storageColor(pct: number): string {
  if (pct >= 90) return "#F44336";
  if (pct >= 75) return "#FF9800";
  return "#4CAF50";
}

export function complianceDisplay(d: IntuneDevice): string {
  return d.isCompliant ? "Compliant" : "Non-compliant";
}

export async function copyText(value: string | null | undefined) {
  if (!value) return;
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    /* clipboard indisponible */
  }
}

export function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("fr-FR");
}

export function fmtDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
}

export function ComplianceChip({ device }: { device: IntuneDevice }) {
  if (device.isCompliant) return <span className="chip green">Conforme</span>;
  return <span className="chip red">Non conforme</span>;
}

export function SyncChip({ device }: { device: IntuneDevice }) {
  const d = device.daysSinceLastSync;
  if (d < 0) return <span className="chip grey">Jamais</span>;
  if (d <= 7) return <span className="chip green">{d} j</span>;
  if (d <= 30) return <span className="chip orange">{d} j</span>;
  return <span className="chip red">{d} j</span>;
}

// --- Mot de passe : ancienneté & alerte ---

/** "5 mois", "1 an et 2 mois", "12 jours" — à partir d'un nombre de jours. */
export function ageInDays(days: number): string {
  if (days < 0) return "inconnu";
  if (days < 31) return `${days} jour${days > 1 ? "s" : ""}`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} mois`;
  const years = Math.floor(months / 12);
  const rest = months % 12;
  const y = `${years} an${years > 1 ? "s" : ""}`;
  return rest > 0 ? `${y} et ${rest} mois` : y;
}

/** Libellé lisible de l'état du mot de passe. */
export function passwordLabel(status: PasswordStatus): string {
  switch (status) {
    case "Alert":
      return "À renouveler";
    case "Warning":
      return "Bientôt";
    case "Ok":
      return "OK";
    default:
      return "Inconnu";
  }
}

/**
 * Pastille d'ancienneté du mot de passe.
 * Rouge = seuil dépassé (contacter l'utilisateur), orange = échéance proche,
 * gris = Entra ID ne fournit pas la date.
 */
export function PasswordChip({ user }: { user: EntraUser }) {
  const age = ageInDays(user.daysSincePasswordChange);
  switch (user.passwordStatus) {
    case "Alert":
      return <span className="chip red">⚠ {age}</span>;
    case "Warning":
      return <span className="chip orange">{age}</span>;
    case "Ok":
      return <span className="chip green">{age}</span>;
    default:
      return <span className="chip grey">Inconnu</span>;
  }
}

/** Bandeau d'avertissement (orange), pendant de `ErrorBanner`. */
export function WarnBanner({ children }: { children: ReactNode }) {
  return <div className="warn-banner">{children}</div>;
}

export function Loading({ what = "Chargement…" }: { what?: string }) {
  return <div className="loading">{what}</div>;
}

export function ErrorBanner({ message }: { message: string }) {
  return <div className="error-banner">⚠ {message}</div>;
}
