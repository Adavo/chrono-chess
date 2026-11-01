/** Internationalisation légère : français et anglais. La langue vient du navigateur, puis du choix mémorisé. */
export type Lang = 'fr' | 'en';
/** Langues proposées, dans l'ordre du sélecteur : en ajouter une = un dictionnaire de plus + un drapeau. */
export const LANGS: Lang[] = ['fr', 'en'];

const FR = {
  level_title: 'Choisissez le niveau',
  level_easy: 'Facile', level_medium: 'Moyen', level_hard: 'Difficile', level_master: 'Grand Maître',
  level_easy_desc: 'Joue presque au hasard',
  level_medium_desc: "Capture, protège ses pièces, cherche l'échec",
  level_hard_desc: 'Simule plusieurs parties avant de jouer',
  level_master_desc: 'Simule des centaines de parties : redoutable',
  back: 'Retour',
  tagline: 'Programmez <b>{n} coups</b> en secret. Ils se jouent <b>tous en même temps</b>.',
  rule: 'Si deux pièces arrivent sur la même case, la plus forte reste.',
  play_ai: "Jouer contre l'IA",
  host_btn: 'Créer une partie en ligne',
  join_btn: 'Rejoindre',
  code_ph: 'CODE',
  online_title: 'Partie en ligne',
  give_code: 'Donnez ce code à votre adversaire',
  click_copy: '(cliquer pour copier)',
  creating: 'Création…',
  waiting_opp: "En attente de l'adversaire…",
  copied: 'Code copié !',
  cancel: 'Annuler',
  connecting: 'Connexion…',
  enter_code: 'Entrez un code à 5 caractères.',
  lost_opp: "Connexion perdue avec l'adversaire.",
  lost_host: "Connexion perdue avec l'hôte.",
  err_nopeer: 'PeerJS indisponible (connexion internet requise)',
  err_notfound: 'code introuvable',
  err_timeout: 'délai dépassé',
  sound: 'Son',
  hint_game: 'Glissez une pièce (ou cliquez-la, puis sa destination). Cliquez un coup en bas pour le refaire avec les suivants.',
  undo_last: 'Annuler le dernier coup',
  submit: 'Valider',
  see_result: 'Voir le résultat',
  to_menu: 'Retour au menu',
  view_board: "Voir l'échiquier",
  status_escape: "Échec ! Parez-le d'abord",
  status_check_now: 'Attention : roi en échec à ce stade',
  status_mate: "Mat prévu (si l'adversaire ne bouge pas)",
  status_check_opp: 'Échec prévu au roi adverse',
  status_plan: 'Planifiez vos {n} coups',
  draw: 'Match nul',
  win: 'Victoire !',
  lose: 'Défaite',
  resolving: 'Résolution',
  plan_sent: 'Plan envoyé… en attente',
  slot_gone: 'détruite',
  slot_empty: 'Aucun coup',
  end_stalemate: 'Pat : match nul.',
  end_insufficient: 'Il ne reste que les deux rois : match nul.',
  end_double: 'Double échec et mat : match nul.',
  end_draw: 'Match nul.',
  end_mate_white: 'Échec et mat : victoire des blancs !',
  end_mate_black: 'Échec et mat : victoire des noirs !',
  piece_K: 'Roi', piece_Q: 'Dame', piece_R: 'Tour', piece_B: 'Fou', piece_N: 'Cavalier', piece_P: 'Pion',
  'reason_piece-not-found': 'la pièce a été détruite',
  'reason_not-owner': 'pièce adverse',
  'reason_already-acted': 'déjà jouée',
  'reason_no-move': 'pas de déplacement',
  'reason_out-of-bounds': 'hors plateau',
  'reason_illegal-geometry': 'impossible depuis sa position réelle',
  'reason_path-blocked': 'trajectoire bloquée',
  'reason_friendly-occupied': 'case alliée',
  'reason_blocked-forward': 'pion bloqué',
  'reason_no-capture-target': 'rien à capturer',
  'reason_target-moved': 'la cible est partie',
  'reason_ally-conflict': 'un allié visait la même case',
  'reason_king-in-check': "le roi doit d'abord sortir d'échec",
  'reason_king-capture': 'on ne capture pas un roi : on le met mat',
} as const;

export type Key = keyof typeof FR;

const EN: Record<Key, string> = {
  level_title: 'Choose the difficulty',
  level_easy: 'Easy', level_medium: 'Medium', level_hard: 'Hard', level_master: 'Grandmaster',
  level_easy_desc: 'Plays almost at random',
  level_medium_desc: 'Captures, protects its pieces, hunts for check',
  level_hard_desc: 'Simulates several games before moving',
  level_master_desc: 'Simulates hundreds of games: formidable',
  back: 'Back',
  tagline: 'Plan <b>{n} moves</b> in secret. They all play out <b>at the same time</b>.',
  rule: 'If two pieces land on the same square, the stronger one stays.',
  play_ai: 'Play vs the AI',
  host_btn: 'Create an online game',
  join_btn: 'Join',
  code_ph: 'CODE',
  online_title: 'Online game',
  give_code: 'Give this code to your opponent',
  click_copy: '(click to copy)',
  creating: 'Creating…',
  waiting_opp: 'Waiting for your opponent…',
  copied: 'Code copied!',
  cancel: 'Cancel',
  connecting: 'Connecting…',
  enter_code: 'Enter a 5-character code.',
  lost_opp: 'Connection to your opponent lost.',
  lost_host: 'Connection to the host lost.',
  err_nopeer: 'PeerJS unavailable (internet connection required)',
  err_notfound: 'code not found',
  err_timeout: 'timed out',
  sound: 'Sound',
  hint_game: 'Drag a piece (or click it, then its destination). Click a move below to redo it and the ones after it.',
  undo_last: 'Undo last move',
  submit: 'Confirm',
  see_result: 'See result',
  to_menu: 'Back to menu',
  view_board: 'View the board',
  status_escape: 'Check! Escape it first',
  status_check_now: 'Careful: your king is in check at this point',
  status_mate: "Mate planned (if your opponent doesn't move)",
  status_check_opp: 'Check planned on the enemy king',
  status_plan: 'Plan your {n} moves',
  draw: 'Draw',
  win: 'Victory!',
  lose: 'Defeat',
  resolving: 'Resolving',
  plan_sent: 'Plan sent… waiting',
  slot_gone: 'destroyed',
  slot_empty: 'No move',
  end_stalemate: 'Stalemate: draw.',
  end_insufficient: 'Only the two kings remain: draw.',
  end_double: 'Double checkmate: draw.',
  end_draw: 'Draw.',
  end_mate_white: 'Checkmate: White wins!',
  end_mate_black: 'Checkmate: Black wins!',
  piece_K: 'King', piece_Q: 'Queen', piece_R: 'Rook', piece_B: 'Bishop', piece_N: 'Knight', piece_P: 'Pawn',
  'reason_piece-not-found': 'the piece was destroyed',
  'reason_not-owner': "opponent's piece",
  'reason_already-acted': 'already played',
  'reason_no-move': 'no movement',
  'reason_out-of-bounds': 'off the board',
  'reason_illegal-geometry': 'impossible from its actual position',
  'reason_path-blocked': 'path blocked',
  'reason_friendly-occupied': 'own piece there',
  'reason_blocked-forward': 'pawn blocked',
  'reason_no-capture-target': 'nothing to capture',
  'reason_target-moved': 'the target moved away',
  'reason_ally-conflict': 'an ally aimed at the same square',
  'reason_king-in-check': 'the king must escape check first',
  'reason_king-capture': "a king can't be captured: checkmate it",
};

const DICTS: Record<Lang, Record<Key, string>> = { fr: FR, en: EN };
const STORE_KEY = 'chrono-lang';

function detect(): Lang {
  try {
    const saved = localStorage.getItem(STORE_KEY);
    if (saved === 'fr' || saved === 'en') return saved;
  } catch { /* stockage indisponible */ }
  return navigator.language?.toLowerCase().startsWith('fr') ? 'fr' : 'en';
}

let lang: Lang = detect();
document.documentElement.lang = lang;

export const getLang = (): Lang => lang;

/** Langue suivante dans `LANGS` (le drapeau fait défiler les langues). */
export const nextLang = (): Lang => LANGS[(LANGS.indexOf(lang) + 1) % LANGS.length]!;

/** Drapeaux dessinés en SVG (les emojis drapeaux ne s'affichent pas sous Windows). */
const FLAGS: Record<Lang, string> = {
  fr: '<rect width="10" height="20" fill="#2a4aa8"/><rect x="10" width="10" height="20" fill="#f6f6f6"/><rect x="20" width="10" height="20" fill="#d63a3a"/>',
  en: '<rect width="30" height="20" fill="#2a3a8c"/><path d="M0 0L30 20M30 0L0 20" stroke="#f6f6f6" stroke-width="4"/><path d="M0 0L30 20M30 0L0 20" stroke="#d63a3a" stroke-width="1.5"/><path d="M15 0V20M0 10H30" stroke="#f6f6f6" stroke-width="6"/><path d="M15 0V20M0 10H30" stroke="#d63a3a" stroke-width="3.4"/>',
};
export const flagSvg = (l: Lang): string => `<svg viewBox="0 0 30 20" preserveAspectRatio="none" aria-hidden="true">${FLAGS[l]}</svg>`;

export function setLang(l: Lang) {
  lang = l;
  document.documentElement.lang = l;
  try { localStorage.setItem(STORE_KEY, l); } catch { /* */ }
}

/** Texte traduit ; `{nom}` est remplacé par la valeur correspondante de `vars`. */
export function t(key: Key, vars: Record<string, string | number> = {}): string {
  return DICTS[lang][key].replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ''));
}
