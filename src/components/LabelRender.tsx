import { useRef } from "react";
import { IntuneDevice } from "../api";
import { Align, LabelElement, LabelTemplate, fitFactor, formatField } from "../labelTemplate";

/**
 * Rendu d'une étiquette — le MÊME composant à l'écran et à l'impression.
 *
 * C'est le point clé du WYSIWYG : un calque d'édition séparé qui recalculerait
 * les positions dériverait tôt ou tard de ce qui sort de l'imprimante. Ici
 * l'éditeur n'est qu'un mode de ce composant, activé par `editable`.
 *
 * Le conteneur porte `container-type: size` (voir `.label-box` dans styles.css),
 * ce qui ancre les unités `cqh` : `fontSize: "20cqh"` vaut littéralement 20 % de
 * la hauteur d'étiquette, quelle que soit la taille décidée par le pilote.
 * Un `fontSize` en `%` ne marcherait pas — en CSS il se résout contre la police
 * du parent, pas contre la hauteur du conteneur.
 */

interface Props {
  template: LabelTemplate;
  device: IntuneDevice;
  /** Data URI du QR (SVG). Absent → cadre d'attente. */
  qrSvg?: string;
  /** Classe du conteneur : `print-page` à l'impression, `label-canvas` dans l'éditeur. */
  className?: string;
  editable?: boolean;
  selectedId?: string | null;
  onSelect?: (id: string | null) => void;
  onChange?: (el: LabelElement) => void;
}

const clamp = (v: number, min = 0, max = 100) => Math.min(max, Math.max(min, v));

const justify = (a: Align) =>
  a === "center" ? "center" : a === "right" ? "flex-end" : "flex-start";

/**
 * Filtres d'image, appliqués à l'identique à l'écran et à l'impression.
 *
 * En mode 1-bit, `brightness` devient le point de bascule : `contrast(1000%)`
 * pivote autour du gris moyen, donc éclaircir ou assombrir avant décide quels
 * pixels tombent en noir. C'est ce que veut un ruban résine, dont le marquage
 * est binaire de toute façon.
 */
const imageFilter = (el: LabelElement) =>
  el.threshold
    ? `grayscale(1) brightness(${el.brightness}) contrast(1000%)`
    : `contrast(${el.contrast}) brightness(${el.brightness})`;

type DragState = {
  mode: "move" | "resize";
  orig: LabelElement;
  startX: number;
  startY: number;
  boxW: number;
  boxH: number;
};

export default function LabelRender({
  template,
  device,
  qrSvg,
  className = "",
  editable = false,
  selectedId = null,
  onSelect,
  onChange,
}: Props) {
  const boxRef = useRef<HTMLDivElement>(null);
  const drag = useRef<DragState | null>(null);

  const beginDrag = (e: React.PointerEvent, el: LabelElement, mode: "move" | "resize") => {
    if (!editable || !onChange) return;
    e.preventDefault();
    e.stopPropagation();
    const box = boxRef.current?.getBoundingClientRect();
    if (!box) return;
    onSelect?.(el.id);
    drag.current = {
      mode,
      orig: { ...el },
      startX: e.clientX,
      startY: e.clientY,
      boxW: box.width,
      boxH: box.height,
    };
    // La capture fait suivre move/up sur cet élément : pas d'écouteur global,
    // donc pas de fuite si le composant se démonte en plein glissement.
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || !onChange) return;
    const dx = ((e.clientX - d.startX) / d.boxW) * 100;
    const dy = ((e.clientY - d.startY) / d.boxH) * 100;
    // Aimantation au demi-pourcent ; Alt pour du placement libre.
    const snap = (v: number) => (e.altKey ? v : Math.round(v * 2) / 2);

    if (d.mode === "move") {
      onChange({ ...d.orig, x: clamp(snap(d.orig.x + dx)), y: clamp(snap(d.orig.y + dy)) });
    } else if (d.orig.kind === "qr") {
      // Le QR n'a qu'une hauteur : sa largeur suit en aspect-ratio.
      onChange({ ...d.orig, h: clamp(snap(d.orig.h + dy), 5) });
    } else {
      onChange({
        ...d.orig,
        w: clamp(snap(d.orig.w + dx), 3),
        h: clamp(snap(d.orig.h + dy), 3),
      });
    }
  };

  const endDrag = () => {
    drag.current = null;
  };

  const content = (el: LabelElement) => {
    switch (el.kind) {
      case "qr":
        return qrSvg ? (
          <img src={qrSvg} alt="QR" style={{ width: "100%", height: "100%", display: "block" }} />
        ) : (
          <div className="qr-placeholder">QR</div>
        );
      case "image":
        return el.imageDataUrl ? (
          <img
            src={el.imageDataUrl}
            alt=""
            style={{
              width: "100%",
              height: "100%",
              objectFit: "contain",
              filter: imageFilter(el),
            }}
          />
        ) : (
          <div className="qr-placeholder">Image</div>
        );
      default: {
        const value = el.kind === "field" ? formatField(device, el.field) : el.text;
        const aspect = template.previewHeightMm
          ? template.previewWidthMm / template.previewHeightMm
          : 2;
        return (
          <div
            style={{
              width: "100%",
              // La taille réglée dans l'éditeur est un maximum : un nom trop
              // long est réduit pour tenir, jamais laissé déborder sur le QR.
              fontSize: `${el.fontPct * fitFactor(el, value, aspect)}cqh`,
              fontWeight: el.bold ? 700 : 400,
              textAlign: el.align,
              lineHeight: 1.15,
              // Une seule ligne : sur 25 mm, un retour à la ligne ne tient pas.
              whiteSpace: "nowrap",
            }}
          >
            {value}
          </div>
        );
      }
    }
  };

  return (
    <div
      ref={boxRef}
      className={`label-box ${className}`}
      // Donne sa hauteur au canvas de l'éditeur, dont seule la largeur est
      // fixée. Sans effet à l'impression : `.print-page` y impose largeur ET
      // hauteur, et `aspect-ratio` est ignoré dès que les deux sont définies —
      // c'est bien le pilote qui garde le dernier mot sur la taille.
      style={{ aspectRatio: `${template.previewWidthMm} / ${template.previewHeightMm}` }}
      onPointerDown={editable ? () => onSelect?.(null) : undefined}
    >
      {template.elements.map((el) => {
        const selected = editable && el.id === selectedId;
        return (
          <div
            key={el.id}
            className={`label-el${selected ? " selected" : ""}${editable ? " editable" : ""}`}
            style={{
              position: "absolute",
              left: `${el.x}%`,
              top: `${el.y}%`,
              // Le QR ne tient sa largeur que de son ratio : des % sur les deux
              // axes le déformeraient et le rendraient illisible.
              ...(el.kind === "qr"
                ? { height: `${el.h}%`, aspectRatio: "1" }
                : { width: `${el.w}%`, height: `${el.h}%` }),
              display: "flex",
              alignItems: "center",
              justifyContent: justify(el.align),
            }}
            onPointerDown={(e) => beginDrag(e, el, "move")}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          >
            {content(el)}
            {selected && (
              <span
                className="resize-handle"
                onPointerDown={(e) => beginDrag(e, el, "resize")}
                onPointerMove={onPointerMove}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
