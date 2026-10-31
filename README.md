# Chrono Chess

Échecs à programmation simultanée. Chaque **Séquence** : 10 s pour programmer en secret 3 coups (un par sous-tour), puis les coups se résolvent **en même temps**, sous-tour par sous-tour.

Un coup devenu impossible au moment de s'exécuter (pièce capturée, trajectoire bloquée, cible partie…) est **annulé** : la pièce ne bouge pas, rien n'est corrigé.

## Jouer
- **Contre l'IA** ou **en ligne** à deux (code de 5 caractères, WebRTC via [PeerJS](https://peerjs.com/), comme Nidus Breach). Internet requis pour le multi, page servie en HTTPS.
- Glisser-déposer une pièce (ou clic sur la pièce puis sur sa destination) : le plateau montre la position prévue, et une même pièce peut jouer à chaque sous-tour. `Valider` envoie le plan avant la fin du chrono.

## Règles de résolution
Voir le commentaire en tête de [`src/core/resolution.ts`](src/core/resolution.ts). Règle d'échec : si le roi est en échec au début d'un sous-tour, tout coup qui ne le sauve pas est annulé.

## Développement
```bash
npm install
npm run dev     # serveur local
npm test        # moteur de règles
npm run build   # site statique dans dist/
```

Chaque build publie `version.json` ; au chargement la page le compare (sans cache) à son propre build et se recharge une fois si une version plus récente est en ligne. Le numéro de version est affiché sur l'accueil, avec un bouton « Actualiser » qui vide les caches. `public/_headers` demande `no-cache` sur Netlify/Cloudflare (GitHub Pages l'ignore).

Le moteur (`src/core`) est du TypeScript pur, sans DOM ni réseau ; l'hôte d'une partie en ligne (les blancs) est autoritaire.

## Hébergement GitHub Pages
Dans le dépôt GitHub : **Settings → Pages → Source : GitHub Actions**. Chaque push sur `main` lance [`deploy.yml`](.github/workflows/deploy.yml) (tests, build, déploiement).
