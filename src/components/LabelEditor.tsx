import { useEffect, useMemo, useRef, useState } from "react";
// `save` est aliasé : le nom est déjà pris par l'enregistrement du template.
import { open, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { api, IntuneDevice } from "../api";
import { ErrorBanner } from "./common";
import LabelRender from "./LabelRender";
import PrintPortal from "./PrintPortal";
import PrintCalibration from "./PrintCalibration";
import {
  Align,
  ElementKind,
  FIELDS,
  LabelElement,
  LabelTemplate,
  SAMPLE_DEVICE,
  newElement,
} from "../labelTemplate";

/**
 * Éditeur de template d'étiquette.
 *
 * L'aperçu n'est pas une simulation : c'est `LabelRender`, exactement le
 * composant qui part à l'imprimante. Ce qui est vu ici est ce qui sort.
 *
 * Les millimètres du canvas ne servent qu'à son ratio. Rien ici ne contraint
 * la taille d'impression : c'est le pilote qui décide.
 */

const KINDS: { kind: ElementKind; label: string }[] = [
  { kind: "qr", label: "+ QR" },
  { kind: "field", label: "+ Champ" },
  { kind: "text", label: "+ Texte" },
  { kind: "image", label: "+ Image" },
];

export default function LabelEditor() {
  const [template, setTemplate] = useState<LabelTemplate | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [devices, setDevices] = useState<IntuneDevice[]>([]);
  const [previewId, setPreviewId] = useState("");
  const [qrSvg, setQrSvg] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [dirty, setDirty] = useState(false);
  const canvasWrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.getLabelTemplate().then(setTemplate).catch((e) => setError(String(e)));
    // Un appareil réel donne un aperçu honnête (vrai QR, vraies longueurs de
    // texte). L'exemple ne sert que si Graph n'a rien renvoyé.
    api
      .getDevices()
      .then((d) => {
        setDevices(d);
        if (d[0]) setPreviewId(d[0].id);
      })
      .catch(() => {});
  }, []);

  const previewDevice = useMemo(
    () => devices.find((d) => d.id === previewId) ?? SAMPLE_DEVICE,
    [devices, previewId]
  );

  useEffect(() => {
    if (!previewId) return setQrSvg("");
    api
      .generateQrSvgs([previewId])
      .then(([svg]) => setQrSvg(svg))
      .catch(() => setQrSvg(""));
  }, [previewId]);

  if (!template) return <p className="muted">Chargement du template…</p>;

  const selected = template.elements.find((e) => e.id === selectedId) ?? null;

  const patch = (next: LabelTemplate) => {
    setTemplate(next);
    setDirty(true);
    setStatus("");
  };
  const updateEl = (el: LabelElement) =>
    patch({ ...template, elements: template.elements.map((e) => (e.id === el.id ? el : e)) });
  const set = (p: Partial<LabelElement>) => selected && updateEl({ ...selected, ...p });

  const addEl = (kind: ElementKind) => {
    const el = newElement(kind);
    patch({ ...template, elements: [...template.elements, el] });
    setSelectedId(el.id);
  };
  const removeEl = () => {
    if (!selected) return;
    patch({ ...template, elements: template.elements.filter((e) => e.id !== selected.id) });
    setSelectedId(null);
  };

  const save = async () => {
    setError("");
    try {
      await api.saveLabelTemplate(template);
      setDirty(false);
      setStatus("Template enregistré.");
    } catch (e) {
      setError(String(e));
    }
  };

  const reset = async () => {
    setError("");
    try {
      const t = await api.resetLabelTemplate();
      setTemplate(t);
      setSelectedId(null);
      setDirty(false);
      setStatus("Template réinitialisé.");
    } catch (e) {
      setError(String(e));
    }
  };

  const TPL_FILTER = [{ name: "Template ScanTune", extensions: ["json"] }];

  const exportTpl = async () => {
    setError("");
    try {
      // On exporte l'état à l'écran, pas le fichier enregistré : ce que tu
      // vois est ce que tu transportes.
      const path = await saveDialog({
        defaultPath: "etiquette-scantune.json",
        filters: TPL_FILTER,
      });
      if (!path) return;
      await api.exportLabelTemplate(template, path);
      setStatus(`Template exporté : ${path}`);
    } catch (e) {
      setError(String(e));
    }
  };

  const importTpl = async () => {
    setError("");
    try {
      const path = await open({ multiple: false, filters: TPL_FILTER });
      if (!path || typeof path !== "string") return;
      const t = await api.importLabelTemplate(path);
      setTemplate(t);
      setSelectedId(null);
      // Volontairement non enregistré : l'import se voit d'abord dans
      // l'aperçu, et n'écrase la mise en page en place que si tu confirmes.
      setDirty(true);
      setStatus("Template importé — vérifie l'aperçu, puis Enregistrer.");
    } catch (e) {
      setError(String(e));
    }
  };

  const pickImage = async () => {
    if (!selected) return;
    try {
      const path = await open({
        multiple: false,
        filters: [{ name: "Image", extensions: ["png", "jpg", "jpeg"] }],
      });
      if (!path || typeof path !== "string") return;
      set({ imageDataUrl: await api.loadTemplateImage(path) });
    } catch (e) {
      setError(`Image illisible : ${e}`);
    }
  };

  // Flèches = ajustement fin, une fois l'élément posé à la souris.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!selected) return;
    const step = e.shiftKey ? 0.2 : 1;
    const d: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const move = d[e.key];
    if (!move) return;
    e.preventDefault();
    const round = (v: number) => Math.round(v * 10) / 10;
    set({
      x: round(Math.min(100, Math.max(0, selected.x + move[0]))),
      y: round(Math.min(100, Math.max(0, selected.y + move[1]))),
    });
  };

  const num = (label: string, key: "x" | "y" | "w" | "h") => (
    <div className="field" style={{ flex: 1, minWidth: 70 }}>
      <label>{label}</label>
      <input
        type="number"
        value={selected ? Math.round(selected[key] * 10) / 10 : 0}
        step={0.5}
        onChange={(e) => set({ [key]: Number(e.target.value) } as Partial<LabelElement>)}
      />
    </div>
  );

  const isText = selected?.kind === "field" || selected?.kind === "text";

  return (
    <>
      {error && <ErrorBanner message={error} />}

      <div className="grid" style={{ gridTemplateColumns: "minmax(0, 1fr) 280px", gap: 18 }}>
        {/* Canvas */}
        <div className="card">
          <div className="row" style={{ gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
            {KINDS.map((k) => (
              <button key={k.kind} className="ghost" onClick={() => addEl(k.kind)}>
                {k.label}
              </button>
            ))}
            <div className="spacer" />
            <select
              value={previewId}
              onChange={(e) => setPreviewId(e.target.value)}
              title="Appareil utilisé pour l'aperçu"
            >
              <option value="">— Exemple —</option>
              {devices.slice(0, 200).map((d) => (
                <option key={d.id} value={d.id}>{d.deviceName}</option>
              ))}
            </select>
          </div>

          <div ref={canvasWrap} tabIndex={0} onKeyDown={onKeyDown} style={{ outline: "none" }}>
            <LabelRender
              template={template}
              device={previewDevice}
              qrSvg={qrSvg}
              className="label-canvas"
              editable
              selectedId={selectedId}
              onSelect={setSelectedId}
              onChange={updateEl}
            />
          </div>

          <p className="muted" style={{ marginTop: 10, fontSize: 12 }}>
            Aperçu {template.previewWidthMm}×{template.previewHeightMm} mm — <strong>indicatif</strong>.
            La taille réelle vient des réglages de ton imprimante. Glisse pour déplacer, poignée pour
            redimensionner, flèches pour ajuster (Maj = pas fin, Alt = sans aimantation).
          </p>

          <div className="row" style={{ gap: 12, marginTop: 14, flexWrap: "wrap" }}>
            <button onClick={save} disabled={!dirty}>Enregistrer</button>
            <button className="ghost" onClick={reset}>Réinitialiser</button>
            <span style={{ width: 1, height: 24, background: "var(--border)" }} />
            <button className="ghost" onClick={exportTpl} title="Fichier autonome, image comprise">
              ⤓ Exporter…
            </button>
            <button className="ghost" onClick={importTpl}>⤒ Importer…</button>
            <div className="spacer" />
            {dirty && <span className="muted">Modifications non enregistrées</span>}
            {status && <span style={{ color: "var(--green)" }}>✓ {status}</span>}
          </div>
          <p className="muted" style={{ marginTop: 10, fontSize: 12 }}>
            L'export contient tout, image incluse : un seul fichier .json à copier sur un autre
            poste, rien à transporter à côté.
          </p>
        </div>

        {/* Inspecteur */}
        <div className="card">
          <h3 className="section-title">
            {selected ? `Élément : ${selected.kind}` : "Aucune sélection"}
          </h3>

          {!selected && (
            <p className="muted">
              Clique un élément de l'étiquette pour le modifier, ou ajoute-en un avec les boutons
              ci-contre.
            </p>
          )}

          {selected?.kind === "field" && (
            <div className="field">
              <label>Champ</label>
              <select
                value={selected.field}
                onChange={(e) => set({ field: e.target.value })}
                style={{ width: "100%" }}
              >
                {FIELDS.map((f) => (
                  <option key={f.key} value={f.key}>{f.label}</option>
                ))}
              </select>
            </div>
          )}

          {selected?.kind === "text" && (
            <div className="field">
              <label>Texte</label>
              <input type="text" value={selected.text} onChange={(e) => set({ text: e.target.value })} />
            </div>
          )}

          {selected?.kind === "image" && (
            <>
              <div className="field">
                <label>Image</label>
                <button className="ghost" onClick={pickImage} style={{ width: "100%" }}>
                  {selected.imageDataUrl ? "Remplacer l'image…" : "Choisir une image…"}
                </button>
              </div>
              <div className="field">
                <label>
                  {selected.threshold ? "Seuil de bascule" : "Luminosité"} ({selected.brightness.toFixed(2)})
                </label>
                <input
                  type="range"
                  min={0.2}
                  max={2}
                  step={0.05}
                  value={selected.brightness}
                  onChange={(e) => set({ brightness: Number(e.target.value) })}
                />
              </div>
              {!selected.threshold && (
                <div className="field">
                  <label>Contraste ({selected.contrast.toFixed(2)})</label>
                  <input
                    type="range"
                    min={0.2}
                    max={4}
                    step={0.05}
                    value={selected.contrast}
                    onChange={(e) => set({ contrast: Number(e.target.value) })}
                  />
                </div>
              )}
              <label className="row" style={{ gap: 8, marginBottom: 14 }}>
                <input
                  type="checkbox"
                  checked={selected.threshold}
                  onChange={(e) => set({ threshold: e.target.checked })}
                />
                Noir &amp; blanc pur (1-bit)
              </label>
              <p className="muted" style={{ fontSize: 12, marginTop: -6 }}>
                Recommandé en transfert thermique : le ruban résine ne sait imprimer que du noir ou
                rien. Le curseur règle alors où bascule le noir.
              </p>
            </>
          )}

          {isText && (
            <>
              <div className="field">
                <label>Taille ({selected!.fontPct} % de la hauteur)</label>
                <input
                  type="range"
                  min={4}
                  max={60}
                  step={1}
                  value={selected!.fontPct}
                  onChange={(e) => set({ fontPct: Number(e.target.value) })}
                />
              </div>
              <div className="field">
                <label>Alignement</label>
                <select
                  value={selected!.align}
                  onChange={(e) => set({ align: e.target.value as Align })}
                  style={{ width: "100%" }}
                >
                  <option value="left">Gauche</option>
                  <option value="center">Centré</option>
                  <option value="right">Droite</option>
                </select>
              </div>
              <label className="row" style={{ gap: 8, marginBottom: 14 }}>
                <input
                  type="checkbox"
                  checked={selected!.bold}
                  onChange={(e) => set({ bold: e.target.checked })}
                />
                Gras
              </label>
            </>
          )}

          {selected && (
            <>
              <div className="row" style={{ gap: 8 }}>
                {num("X %", "x")}
                {num("Y %", "y")}
              </div>
              <div className="row" style={{ gap: 8 }}>
                {selected.kind !== "qr" && num("Largeur %", "w")}
                {num("Hauteur %", "h")}
              </div>
              {selected.kind === "qr" && (
                <p className="muted" style={{ fontSize: 12, marginTop: -6 }}>
                  La largeur du QR suit sa hauteur : un QR non carré serait illisible.
                </p>
              )}
              <button className="ghost" onClick={removeEl} style={{ marginTop: 8 }}>
                Supprimer l'élément
              </button>
            </>
          )}
        </div>
      </div>

      <div className="card" style={{ marginTop: 18 }}>
        <h3 className="section-title">Calibration</h3>
        <p className="muted">
          Imprime une mire pour vérifier les réglages de ton imprimante : le cadre doit toucher les
          quatre bords, le carré doit être carré, et le texte « 20cqh » doit mesurer un cinquième de
          la hauteur de l'étiquette.
        </p>
        <button
          className="ghost"
          onClick={() => api.printLabels().catch((e) => setError(String(e)))}
        >
          ⎙ Imprimer la mire
        </button>
      </div>

      <PrintPortal>
        <PrintCalibration />
      </PrintPortal>
    </>
  );
}
