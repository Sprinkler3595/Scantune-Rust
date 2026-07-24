import { createPortal } from "react-dom";

/**
 * Monte son contenu dans `document.body`, hors de `.app`.
 *
 * Indispensable : le CSS d'impression masque `.app` en `display: none`, et un
 * descendant d'un élément masqué ne peut pas être réaffiché. Le portail sort
 * donc le contenu imprimable de l'arbre de l'application, tout en le laissant
 * s'écrire au même endroit que le bouton qui le déclenche.
 *
 * À laisser monté après l'appel à l'impression : sur macOS `print()` rend la
 * main immédiatement et `afterprint` ne se déclenche pas — démonter ici
 * imprimerait une page blanche. Le contenu est de toute façon invisible à
 * l'écran (`.print-root { display: none }`).
 */
export default function PrintPortal({ children }: { children: React.ReactNode }) {
  return createPortal(<div className="print-root">{children}</div>, document.body);
}
