**Français** · [English](README.en.md)

# Mode sombre intelligent

Assombrit les pages claires et **ne touche pas** à ce qui est déjà sombre.

## Installation
1. `chrome://extensions` : active le **Mode développeur**.
2. **Charger l'extension non empaquetée** et choisis ce dossier.
3. Recharge les onglets déjà ouverts (une extension nouvellement installée ne s'injecte pas dans les pages déjà chargées).

## Comportement
| Situation | Ce que fait l'extension |
|---|---|
| Page déjà sombre | **Rien.** Aucun filtre, la page est strictement identique (testé pixel pour pixel). |
| Page claire | Inversion de la page : fond sombre, texte clair, teintes conservées. |
| Bloc déjà sombre dans une page claire (code, bandeau…) | Laissé tel quel. |
| Images, vidéos, canvas, iframes, fonds en image | Laissés tels quels. |
| Le site passe en sombre tout seul (bouton de thème, chargement tardif) | L'extension se retire. |
| Site déjà vu comme clair | Assombri dès la première image, sans éclair blanc. |

La détection mesure les couleurs de fond sur toute la zone visible (25 points), regarde le fond du corps
de la page et, si l'écran est couvert d'images, la couleur du texte. Les couleurs de la page ne sont jamais
modifiées : la mesure reste valable pendant que le filtre est actif.

## Utilisation
- **Icône** : interrupteur général, état de la page, bouton « Désactiver sur ce site ». Une pastille **ON**
  s'affiche sur l'icône quand la page est assombrie.
- **Alt+Maj+D** : active / désactive le mode sombre sur le site courant (modifiable dans `chrome://extensions/shortcuts`).
- Les changements s'appliquent en direct, sans recharger la page.

## Limites connues
- Le rendu repose sur un filtre d'inversion avec rotation de teinte. Les zones laissées intactes
  (images, blocs sombres) gardent leurs couleurs avec **le même léger adoucissement que le reste de la page** (≈ −10 %),
  et les couleurs **très saturées** sont un peu décalées (jusqu'à ≈ 20/255 sur un vert ou un bleu pur).
- La barre de défilement reste claire.
- Icônes ou logos en PNG sombre sur fond transparent : laissés comme ils sont, donc peu lisibles sur fond sombre
  (les SVG, eux, sont inversés).
- Au tout premier chargement d'un site, la page peut rester claire un instant : le site n'est mémorisé qu'après
  la première analyse.
- Un site dont le fond sombre est porté par un élément intermédiaire peut être classé « clair » ; il est alors
  assombri en laissant intacts ses blocs sombres, ce qui change peu l'apparence.
- Les pages `chrome://`, le Web Store et les fichiers locaux ne sont pas gérés.

## Tests
    node test/browser.test.mjs    # vrai Helium sans fenêtre, vraies captures d'écran, couleurs mesurées

Pour regarder le rendu sur de vrais sites :

    SHOT_DIR=/dossier SHOT_URLS=https://example.com/,https://lobste.rs/ node test/browser.test.mjs

## Licence

[MIT](LICENSE).
