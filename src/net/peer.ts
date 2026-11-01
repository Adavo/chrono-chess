/**
 * Transport PeerJS (WebRTC) — même principe que Nidus Breach : le courtier public de PeerJS
 * ne sert qu'à la mise en relation, ensuite les navigateurs se parlent directement.
 * PeerJS est chargé par <script> dans index.html (variable globale `Peer`).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const Peer: any;

export interface Conn {
  send(msg: unknown): void;
  close(): void;
  onmsg: ((msg: any) => void) | null;
  onclose: (() => void) | null;
}

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const randCode = () => Array.from({ length: 5 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join('');
const PREFIX = 'chrono-';
const CREATE_TIMEOUT_MS = 15000;

let peer: any = null;
/** Nettoyage de l'hébergement en cours (écouteurs de visibilité et de réseau, minuteurs). */
let stopHosting: (() => void) | null = null;
export const dropPeer = () => {
  stopHosting?.(); stopHosting = null;
  try { peer?.destroy(); } catch { /* déjà fermé */ }
  peer = null;
};

function wrap(c: any): Conn {
  const w: Conn = { send: (m) => c.send(m), close: () => { try { c.close(); } catch { /* */ } }, onmsg: null, onclose: null };
  c.on('data', (d: unknown) => w.onmsg?.(d));
  c.on('close', () => w.onclose?.());
  c.on('error', () => w.onclose?.());
  return w;
}

/** Erreurs de liaison avec le courtier : passagères, on se reconnecte au lieu d'abandonner. */
const TRANSIENT = new Set(['network', 'server-error', 'socket-error', 'socket-closed', 'disconnected']);

/**
 * Crée une partie : renvoie le code via onCode, puis la connexion de l'invité via onConn.
 * Tant que l'on attend l'invité, la liaison avec le courtier est maintenue : si le navigateur passe en
 * arrière-plan (on partage le code dans une messagerie) et que la liaison tombe, elle est rétablie avec
 * le MÊME code dès le retour sur la page. `onCode` peut être rappelé si le code a dû changer.
 */
export function host(onCode: (code: string) => void, onConn: (c: Conn) => void, onErr: (m: string) => void): void {
  if (typeof Peer === 'undefined') return onErr('no-peerjs');
  dropPeer();
  let taken = false;
  let opened = false;
  let tries = 0;
  const timers = new Set<number>();
  const later = (fn: () => void, ms: number) => { const id = window.setTimeout(() => { timers.delete(id); fn(); }, ms); timers.add(id); };

  /** Se reconnecte au courtier en gardant le même identifiant (sans effet si déjà connecté). */
  const reconnect = () => {
    if (peer && !peer.destroyed && peer.disconnected) { try { peer.reconnect(); } catch { /* réessai au prochain événement */ } }
  };
  const onVisible = () => { if (document.visibilityState === 'visible') reconnect(); };
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('online', reconnect);
  stopHosting = () => {
    document.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener('online', reconnect);
    timers.forEach((id) => clearTimeout(id));
  };

  const create = (wanted: string | null) => {
    const code = wanted ?? randCode();
    const p = new Peer(PREFIX + code, { debug: 0 });
    peer = p;
    p.on('open', () => { opened = true; tries = 0; onCode(code); });
    p.on('connection', (c: any) => {
      if (taken) return c.close(); // un seul adversaire
      taken = true;
      c.on('open', () => onConn(wrap(c)));
    });
    // Liaison perdue (page en arrière-plan, réseau coupé…) : on la rétablit, le code reste valable.
    p.on('disconnected', () => { if (peer === p) later(reconnect, 1000); });
    p.on('error', (e: any) => {
      if (peer !== p || taken) return; // partie lancée : la liaison avec le courtier n'est plus nécessaire
      if (e.type === 'unavailable-id') {
        // Le courtier croit encore l'ancienne session vivante : on réessaie le même code, puis on en change.
        try { p.destroy(); } catch { /* */ }
        if (wanted && ++tries <= 6) later(() => create(wanted), 1500); else create(null);
      } else if (opened && TRANSIENT.has(e.type)) later(reconnect, 1000);
      else onErr(e.type || String(e));
    });
  };

  later(() => { if (!opened) onErr('timeout'); }, CREATE_TIMEOUT_MS);
  create(null);
}

/** Rejoint la partie d'un code donné. */
export function join(code: string, onOpen: (c: Conn) => void, onErr: (m: string) => void): void {
  if (typeof Peer === 'undefined') return onErr('no-peerjs');
  peer = new Peer({ debug: 0 });
  let done = false;
  const fail = (m: string) => { if (!done) { done = true; onErr(m); } };
  peer.on('error', (e: any) => fail(e.type === 'peer-unavailable' ? 'code-not-found' : e.type || String(e)));
  peer.on('open', () => {
    const c = peer.connect(PREFIX + code.toUpperCase(), { reliable: true, serialization: 'json' });
    c.on('open', () => { if (!done) { done = true; onOpen(wrap(c)); } });
    setTimeout(() => fail('timeout'), 12000);
  });
}
