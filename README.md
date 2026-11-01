# Chrono Chess

Mini-échecs **5×5** avec deux modes de jeu, choisis sur l'accueil (contre l'IA comme en ligne) :

- **A · Classique** : échecs standard, **coup par coup**, **5 s par coup** (à la fin du chrono, un coup légal au hasard est joué). Les blancs commencent, la couleur est tirée au sort. Mat, pat et deux rois seuls sont jugés immédiatement.
- **B · Bluff** : chacun programme **un seul coup** en secret (5 s) ; les deux coups se résolvent **en même temps**. Un coup devenu impossible au moment de s'exécuter (pièce détruite, cible partie…) est **annulé** : la pièce ne bouge pas.

## Jouer
- Son entièrement synthétisé (aucun fichier audio) : bruits de pièces en bois et musique d'ambiance générative, coupés d'un appui sur l'icône de son.
- Interface en **français, anglais et chinois (simplifié)** (langue du navigateur par défaut, drapeau en bas à droite de l'accueil ; textes dans [`src/ui/i18n.ts`](src/ui/i18n.ts)).
- **Contre l'IA** (4 niveaux : facile, moyen, difficile, Grand Maître) ou **en ligne** à deux (code de 5 caractères, WebRTC via [PeerJS](https://peerjs.com/)). Internet requis pour le multi, page servie en HTTPS.
- Glisser-déposer une pièce (ou clic sur la pièce puis sur sa destination).

## Règles
- Départ : Tour, Fou, Roi, Cavalier, Tour + 5 pions par camp. Le pion avance d'une case et capture en diagonale ; promotion tirée au sort (cavalier, fou ou tour).
- **A · Classique** : règles d'échecs usuelles — trajectoires bloquées, la pièce qui bouge capture, aucun coup ne laisse son roi en échec.
- **B · Bluff** : trajectoires bloquées par les pièces immobiles ; deux pièces qui **bougent** en même temps se croisent sans rien se faire. Si deux pièces ennemies **arrivent** sur la même case, la **plus forte reste** — Roi > Tour > Cavalier > Fou > Pion — et deux pièces de même force s'annulent. Le roi ne peut jamais aller sur une case attaquée, et un roi en échec doit d'abord en sortir.
- Il ne reste que les deux rois : match nul.

Détail dans [`src/core/classic.ts`](src/core/classic.ts) (mode A) et le commentaire en tête de [`src/core/resolution.ts`](src/core/resolution.ts) (mode B).

## Développement
```bash
npm install
npm run dev     # serveur local
npm test        # moteur de règles
npm run build   # site statique dans dist/
```

Chaque build publie `version.json` ; au chargement la page le compare (sans cache) à son propre build et se recharge une fois si une version plus récente est en ligne. Le numéro de version est affiché sur l'accueil. `public/_headers` demande `no-cache` sur Netlify/Cloudflare (GitHub Pages l'ignore).

Le moteur (`src/core`) est du TypeScript pur, sans DOM ni réseau ; l'hôte d'une partie en ligne (les blancs) est autoritaire.

## Hébergement GitHub Pages
Dans le dépôt GitHub : **Settings → Pages → Source : GitHub Actions**. Chaque push sur `main` lance [`deploy.yml`](.github/workflows/deploy.yml) (tests, build, déploiement).
