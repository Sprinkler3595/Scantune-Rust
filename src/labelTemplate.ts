import { IntuneDevice } from "./api";

/**
 * Modèle de template d'étiquette — miroir de `src-tauri/src/label_template.rs`.
 *
 * Toutes les grandeurs sont des pourcentages de la boîte étiquette. Aucun pixel,
 * aucun DPI, aucun millimètre : c'est le pilote d'imprimante qui décide de la
 * taille réelle à l'impression.
 *
 * Le template par défaut n'est volontairement PAS dupliqué ici : il vit côté
 * Rust et arrive par `api.getLabelTemplate()`. Deux définitions dériveraient.
 */

export type ElementKind = "qr" | "field" | "text" | "image";
export type Align = "left" | "center" | "right";

export interface LabelElement {
  id: string;
  kind: ElementKind;
  /** `kind: "field"` — clé d'`IntuneDevice`. */
  field: string;
  /** `kind: "text"` — texte libre. */
  text: string;
  /** `kind: "image"` — data URI. */
  imageDataUrl: string;
  /** Position et taille, en % de l'étiquette. */
  x: number;
  y: number;
  w: number;
  /** Pour un QR, `h` fait foi : la largeur suit en aspect-ratio 1. */
  h: number;
  /** Taille de police en % de la hauteur d'étiquette. */
  fontPct: number;
  bold: boolean;
  align: Align;
  contrast: number;
  brightness: number;
  threshold: boolean;
}

export interface LabelTemplate {
  version: number;
  /** Ratio du canvas de l'éditeur uniquement — jamais imprimé. */
  previewWidthMm: number;
  previewHeightMm: number;
  elements: LabelElement[];
}

/**
 * Champs imprimables, du plus au moins utile sur une étiquette d'actif.
 * Les identifiants techniques sont en fin de liste : ils tiennent rarement sur
 * 51 mm, mais le QR les porte déjà.
 */
export const FIELDS: { key: string; label: string }[] = [
  { key: "deviceName", label: "Nom de l'appareil" },
  { key: "serialNumber", label: "N° de série" },
  { key: "model", label: "Modèle" },
  { key: "manufacturer", label: "Fabricant" },
  { key: "userDisplayName", label: "Utilisateur" },
  { key: "userPrincipalName", label: "E-mail utilisateur" },
  { key: "deviceCategoryDisplayName", label: "Catégorie" },
  { key: "operatingSystem", label: "Système" },
  { key: "osVersion", label: "Version OS" },
  { key: "complianceState", label: "Conformité" },
  { key: "displayStatus", label: "Statut" },
  { key: "managedDeviceOwnerType", label: "Propriété" },
  { key: "enrolledDateTime", label: "Date d'inscription" },
  { key: "lastSyncDateTime", label: "Dernière synchro" },
  { key: "notes", label: "Notes" },
  { key: "azureADDeviceId", label: "ID Azure AD" },
  { key: "id", label: "ID Intune" },
];

export const fieldLabel = (key: string) =>
  FIELDS.find((f) => f.key === key)?.label ?? key;

/** Rend un champ tel qu'il doit apparaître sur l'étiquette. */
export function formatField(device: IntuneDevice, key: string): string {
  const v = (device as unknown as Record<string, unknown>)[key];
  if (v === null || v === undefined || v === "") return "";
  if (typeof v === "boolean") return v ? "Oui" : "Non";
  if (key.endsWith("DateTime")) {
    const d = new Date(String(v));
    return isNaN(d.getTime()) ? "" : d.toLocaleDateString("fr-CH");
  }
  return String(v);
}

/**
 * Taille de sonde, en pixels.
 *
 * Les métriques de police ne sont PAS linéaires : le même texte mesure 15.10 ×
 * sa taille à 100 px, mais 15.33 à 41 px et 17.07 à 7.6 px — aux petites
 * tailles les avances de glyphes s'arrondissent vers le haut et le texte
 * s'élargit proportionnellement. Mesurer à 100 px puis appliquer à 40
 * sous-estimerait donc la largeur, et laisserait déborder ce qu'on croyait
 * avoir fait tenir.
 *
 * 40 px, c'est la taille qu'atteint un texte de ~14 % de hauteur sur une
 * étiquette de 25 mm imprimée à 300 dpi : on mesure là où ça compte.
 */
const PROBE_PX = 40;
let probe: HTMLSpanElement | null = null;
const probeCache = new Map<string, number>();

/**
 * Largeur d'un texte, exprimée en multiples de sa taille de police.
 *
 * Mesurée par un vrai `<span>` hors écran plutôt qu'avec `canvas.measureText` :
 * le canvas ne résout pas la même police que le DOM pour une même pile CSS, et
 * sous-estimait la largeur de plus de 10 % sur les textes longs — assez pour
 * laisser déborder ce que le calcul croyait avoir fait tenir.
 *
 * La sonde est rattachée au `body` (donc réellement mise en page) et hérite de
 * la police de l'app, exactement comme le texte de l'étiquette.
 */
function widthPerFontSize(text: string, bold: boolean): number {
  const key = `${bold ? 1 : 0}|${text}`;
  const hit = probeCache.get(key);
  if (hit !== undefined) return hit;

  if (!probe) {
    probe = document.createElement("span");
    probe.setAttribute("aria-hidden", "true");
    probe.style.cssText =
      "position:absolute;left:-9999px;top:0;white-space:pre;visibility:hidden;pointer-events:none;";
    probe.style.fontSize = `${PROBE_PX}px`;
    document.body.appendChild(probe);
  }
  probe.style.fontWeight = bold ? "700" : "400";
  probe.textContent = text;
  const ratio = probe.getBoundingClientRect().width / PROBE_PX;
  probeCache.set(key, ratio);
  return ratio;
}

/**
 * Facteur de rétrécissement pour qu'un texte tienne dans sa boîte.
 *
 * Les noms d'appareils n'ont pas tous la même longueur : une taille fixe qui
 * convient à « LT-042 » fait déborder « LT-COMPTA-042 » par-dessus le QR, et
 * une étiquette dont le QR ne scanne plus n'a plus d'objet. On rétrécit donc
 * le texte au besoin — jamais on ne l'agrandit : la taille réglée dans
 * l'éditeur reste un maximum.
 *
 * Le calcul est purement géométrique, sans mesure du DOM. C'est indispensable :
 * la zone d'impression est masquée (`display: none`) jusqu'à l'impression, donc
 * toute mesure de layout y renverrait zéro. Et comme tout est exprimé en
 * proportions de l'étiquette, le résultat vaut pour n'importe quelle taille
 * décidée par le pilote.
 *
 * @param aspect largeur/hauteur de l'étiquette.
 */
export function fitFactor(el: LabelElement, value: string, aspect: number): number {
  if (!value || el.w <= 0 || el.fontPct <= 0) return 1;
  const perFs = widthPerFontSize(value, el.bold);
  if (!perFs) return 1;
  // Tout ramené à une même unité : le % de la hauteur d'étiquette.
  const textPct = el.fontPct * perFs;
  // 2 % de garde : l'arrondi sub-pixel du moteur ne doit pas rogner la
  // dernière lettre d'un texte qui « tient tout juste ».
  const boxPct = el.w * aspect * 0.98;
  return Math.min(1, boxPct / textPct);
}

/** Appareil d'exemple : l'éditeur doit rester utilisable hors sélection. */
export const SAMPLE_DEVICE = {
  id: "00000000-0000-0000-0000-000000000000",
  deviceName: "PC-EXEMPLE-01",
  serialNumber: "SN1234567",
  model: "Latitude 5540",
  manufacturer: "Dell Inc.",
  userDisplayName: "Marie Exemple",
  userPrincipalName: "marie.exemple@contoso.ch",
  deviceCategoryDisplayName: "Portable",
  operatingSystem: "Windows",
  osVersion: "10.0.22631",
  complianceState: "compliant",
  displayStatus: "Conforme",
  managedDeviceOwnerType: "company",
  notes: "",
  azureADDeviceId: "11111111-2222-3333-4444-555555555555",
} as unknown as IntuneDevice;

let seq = 0;
const nextId = () => `el-${Date.now().toString(36)}-${seq++}`;

/** Élément neuf, posé à un endroit visible et sensé pour son type. */
export function newElement(kind: ElementKind): LabelElement {
  const base: LabelElement = {
    id: nextId(),
    kind,
    field: "",
    text: "",
    imageDataUrl: "",
    x: 30,
    y: 40,
    w: 40,
    h: 20,
    fontPct: 16,
    bold: false,
    align: "left",
    contrast: 1,
    brightness: 1,
    threshold: false,
  };
  switch (kind) {
    case "qr":
      return { ...base, x: 3, y: 12, h: 76, w: 0 };
    case "field":
      return { ...base, field: "deviceName", fontPct: 14 };
    case "text":
      return { ...base, text: "Texte", fontPct: 12 };
    case "image":
      return { ...base, x: 60, y: 55, w: 35, h: 35 };
  }
}
