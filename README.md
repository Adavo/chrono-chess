# Chrono Chess

Mini-échecs **5×5** à programmation simultanée. Chaque **manche** : 10 s pour programmer en secret **5 coups** (un par sous-tour), puis les coups se résolvent **en même temps**, sous-tour par sous-tour.

Un coup devenu impossible au moment de s'exécuter (pièce détruite, cible partie, roi en échec…) est **annulé** : la pièce ne bouge pas, rien n'est corrigé.

## Modes de jeu
Choisis sur l'accueil (contre l'IA comme en ligne) :
- **5 coups** : chacun programme en secret 5 coups (10 s), résolus en même temps.
- **A · Classique** : échecs standard 5×5, **coup par coup**, **10 s par coup** (à la fin du chrono, un coup au hasard est joué). Les blancs commencent, la couleur est tirée au sort. Mat, pat et deux rois seuls sont jugés immédiatement.
- **B · 1 coup** : chacun programme **un seul coup** en secret (10 s) ; il est résolu en même temps que celui de l'adversaire, avec les mêmes règles que le mode 5 coups.

## Jouer
- Son entièrement synthétisé (aucun fichier audio) : bruits de pièces en bois et musique d'ambiance générative, coupés d'un appui sur l'icône de son.
- Interface en **français, anglais et chinois (simplifié)** (langue du navigateur par défaut, sélecteur FR / EN sur l'accueil ; textes dans [`src/ui/i18n.ts`](src/ui/i18n.ts)).
- **Contre l'IA** (4 niveaux : facile, moyen, difficile, Grand Maître — les deux derniers simulent des parties avec le vrai moteur avant de jouer) ou **en ligne** à deux (code de 5 caractères, WebRTC via [PeerJS](https://peerjs.com/)). Internet requis pour le multi, page servie en HTTPS.
- Glisser-déposer une pièce (ou clic sur la pièce puis sur sa destination) : le plateau montre la position prévue et des flèches numérotées. Le plan part tout seul dès que les 5 coups sont placés.

## Règles
- Départ : Tour, Fou, Roi, Cavalier, Tour + 5 pions par camp.
- Les pièces **se traversent** (aucune trajectoire bloquée). Le pion avance d'une case et capture en diagonale.
- Deux pièces ennemies sur la même case (arrivée simultanée, ou arrivée sur une pièce immobile) : la **plus forte reste** — Roi > Tour > Cavalier > Fou > Pion. À force égale, le mouvant bat l'immobile ; deux mouvants de même force s'annulent.
- **Échec** : pendant les 5 coups, on bouge librement (on peut exposer son roi avec une autre pièce), mais le **roi ne peut jamais aller sur une case attaquée** (coup rejeté). Si votre roi est en échec **au début de la manche**, vous devez d'abord en sortir : tant qu'il l'est, tout autre coup est annulé. Une fois sorti, vous êtes de nouveau libre.
- **Échec et mat / pat : jugés seulement après le 5e coup**, sur la position finale. Il ne reste que les deux rois : match nul. Un roi maté au 3e coup joue quand même ses 4e et 5e coups avant le verdict.

Détail dans le commentaire en tête de [`src/core/resolution.ts`](src/core/resolution.ts).

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
