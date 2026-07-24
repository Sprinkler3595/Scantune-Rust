/**
 * Mire de calibration — à imprimer avant de dessiner un template.
 *
 * Ce n'est pas une étiquette : c'est un instrument de mesure. Elle répond à
 * trois questions qu'aucune lecture de code ne peut trancher, parce qu'elles
 * dépendent du pilote d'imprimante :
 *
 *  1. `@page { size: auto }` défère-t-il vraiment au pilote ? Imprimer vers
 *     « Enregistrer en PDF » avec un papier 51×25 mm, puis MESURER le PDF :
 *       python3 -c "import pypdf;print(pypdf.PdfReader('out.pdf').pages[0].mediabox)"
 *     Attendu ≈ 144.6 × 70.9 pt. Si on lit 595×842, la page est restée en A4
 *     et le CSS d'impression n'a pas pris.
 *  2. L'imprimante recadre-t-elle ? Les quatre repères sont à fleur des bords :
 *     s'il en manque un, la zone imprimable est plus petite que l'étiquette.
 *  3. Les unités `cqh` fonctionnent-elles en paged media ? C'est le seul point
 *     du design non vérifiable statiquement. Le texte ci-dessous fait 20cqh :
 *     sur une étiquette de 25 mm il doit mesurer 5 mm. Sinon, il faut basculer
 *     le rendu sur le repli `--lh` (cf. LabelRender).
 *
 * Le carré central est en `aspect-ratio: 1` — exactement la technique qui
 * garde le QR carré quel que soit le format. S'il sort en rectangle, le QR
 * sortirait déformé, donc illisible.
 */

const TICK = "#000";

/** Repère d'angle, à fleur du bord. Disparaît si l'imprimante recadre. */
function CornerTick({ at }: { at: "tl" | "tr" | "bl" | "br" }) {
  const v = at[0] === "t" ? { top: 0 } : { bottom: 0 };
  const h = at[1] === "l" ? { left: 0 } : { right: 0 };
  return (
    <>
      <div style={{ position: "absolute", ...v, ...h, width: "12%", height: "4%", background: TICK }} />
      <div style={{ position: "absolute", ...v, ...h, width: "4%", height: "12%", background: TICK }} />
    </>
  );
}

export default function PrintCalibration() {
  return (
    <div className="print-page">
      {/* Cadre pleine page : toute marge visible = marge imposée par le pilote. */}
      <div style={{ position: "absolute", inset: 0, border: "1px solid #000" }} />

      <CornerTick at="tl" />
      <CornerTick at="tr" />
      <CornerTick at="bl" />
      <CornerTick at="br" />

      {/* Doit sortir parfaitement carré — même technique que le QR. */}
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: "50%",
          transform: "translate(-50%, -50%)",
          height: "62%",
          aspectRatio: "1",
          border: "1px solid #000",
        }}
      />

      {/* Doit mesurer 20 % de la hauteur d'étiquette (5 mm sur 25 mm). */}
      <div
        style={{
          position: "absolute",
          left: "7%",
          top: "50%",
          transform: "translateY(-50%)",
          fontSize: "20cqh",
          lineHeight: 1,
          fontWeight: 700,
        }}
      >
        20cqh
      </div>

      <div
        style={{
          position: "absolute",
          right: "7%",
          top: "50%",
          transform: "translateY(-50%)",
          fontSize: "10cqh",
          lineHeight: 1.2,
          textAlign: "right",
        }}
      >
        ScanTune
        <br />
        calibration
      </div>
    </div>
  );
}
