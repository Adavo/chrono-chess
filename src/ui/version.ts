/**
 * Version affichée + mécanisme de mise à jour (même idée que Nidus Breach) :
 *  - au chargement, on relit `version.json` SANS cache et on le compare au build embarqué ;
 *  - s'ils diffèrent, on vide les caches et on recharge UNE fois avec une adresse neuve (?v=...) ;
 *  - `hardReload()` fait la même chose à la demande (bouton « Actualiser »).
 * GitHub Pages ignore le fichier `_headers` : c'est cette vérification qui garantit la mise à jour.
 */
export const VERSION_LABEL = `v${__APP_VERSION__} · ${__APP_SHA__} · ${__APP_DATE__}${import.meta.env.DEV ? ' · dev' : ''}`;

/** Numéro de version et date, affichés en bas à gauche de l'accueil. */
export const VERSION_SHORT = `v${__APP_VERSION__} · ${__APP_DATE__}`;

const RELOAD_KEY = 'chrono-reloaded-for';

/** Vide le Cache Storage (s'il existe) puis recharge avec une adresse que le navigateur n'a jamais vue. */
export async function hardReload(tag: string = String(Date.now())): Promise<void> {
  try {
    if ('caches' in window) await Promise.all((await caches.keys()).map((k) => caches.delete(k)));
    const regs = await navigator.serviceWorker?.getRegistrations?.();
    await Promise.all((regs ?? []).map((r) => r.unregister()));
  } catch { /* pas de cache à vider */ }
  const url = new URL(location.href);
  url.searchParams.set('v', tag);
  location.replace(url.toString());
}

/** Si une version plus récente est en ligne, recharge (au plus une fois par version, pour éviter toute boucle). */
export async function checkForUpdate(): Promise<void> {
  if (import.meta.env.DEV) return;
  try {
    const res = await fetch(new URL(`version.json?nocache=${Date.now()}`, location.href), { cache: 'no-store' });
    if (!res.ok) return;
    const remote = (await res.json()) as { build?: string };
    if (!remote.build || remote.build === __BUILD_ID__) return;
    if (sessionStorage.getItem(RELOAD_KEY) === remote.build) return; // déjà tenté pour cette version
    sessionStorage.setItem(RELOAD_KEY, remote.build);
    await hardReload(remote.build);
  } catch { /* hors ligne ou stockage indisponible : on garde la version chargée */ }
}
