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

let peer: any = null;
export const dropPeer = () => { try { peer?.destroy(); } catch { /* déjà fermé */ } peer = null; };

function wrap(c: any): Conn {
  const w: Conn = { send: (m) => c.send(m), close: () => { try { c.close(); } catch { /* */ } }, onmsg: null, onclose: null };
  c.on('data', (d: unknown) => w.onmsg?.(d));
  c.on('close', () => w.onclose?.());
  c.on('error', () => w.onclose?.());
  return w;
}

/** Crée une partie : renvoie le code via onCode, puis la connexion de l'invité via onConn. */
export function host(onCode: (code: string) => void, onConn: (c: Conn) => void, onErr: (m: string) => void): void {
  if (typeof Peer === 'undefined') return onErr('no-peerjs');
  let taken = false;
  const tryId = () => {
    const code = randCode();
    peer = new Peer(PREFIX + code, { debug: 0 });
    peer.on('open', () => onCode(code));
    peer.on('connection', (c: any) => {
      if (taken) return c.close(); // un seul adversaire
      taken = true;
      c.on('open', () => onConn(wrap(c)));
    });
    peer.on('error', (e: any) => {
      if (e.type === 'unavailable-id') { dropPeer(); tryId(); } else onErr(e.type || String(e));
    });
  };
  tryId();
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
