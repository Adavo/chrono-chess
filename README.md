# Chrono Chess

Échecs à programmation simultanée. Chaque **Séquence** : 10 s pour programmer en secret 3 coups (un par sous-tour), puis les coups se résolvent **en même temps**, sous-tour par sous-tour.

Un coup devenu impossible au moment de s'exécuter (pièce capturée, trajectoire bloquée, cible partie…) est **annulé** : la pièce ne bouge pas, rien n'est corrigé.

## Jouer
- **Contre l'IA** ou **en ligne** à deux (code de 5 caractères, WebRTC via [PeerJS](https://peerjs.com/), comme Nidus Breach). Internet requis pour le multi, page servie en HTTPS.
- Cliquer une de ses pièces, puis la destination, pour le sous-tour sélectionné. `Valider` envoie le plan avant la fin du chrono.

## Règles de résolution
Voir le commentaire en tête de [`src/core/resolution.ts`](src/core/resolution.ts). En bref : validation simultanée sur l'état du début de sous-tour ; arrivée sur un ennemi immobile = capture ; arrivée simultanée de deux ennemis = la plus forte valeur gagne (égalité : les deux disparaissent) ; les échanges de cases sont permis ; la partie s'arrête à la capture d'un roi.

## Développement
```bash
npm install
npm run dev     # serveur local
npm test        # moteur de règles
npm run build   # site statique dans dist/
```

Le moteur (`src/core`) est du TypeScript pur, sans DOM ni réseau ; l'hôte d'une partie en ligne (les blancs) est autoritaire.

## Hébergement GitHub Pages
Dans le dépôt GitHub : **Settings → Pages → Source : GitHub Actions**. Chaque push sur `main` lance [`deploy.yml`](.github/workflows/deploy.yml) (tests, build, déploiement).
