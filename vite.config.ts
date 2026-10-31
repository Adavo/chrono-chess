import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8')) as { version: string };

function gitSha(): string {
  try {
    return process.env.GITHUB_SHA?.slice(0, 7) ?? execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return 'local';
  }
}

const sha = gitSha();
const date = new Date().toISOString().slice(0, 10);
/** Identifiant unique de CE build : sert à détecter qu'une version plus récente est en ligne. */
const buildId = `${pkg.version}-${sha}-${Date.now()}`;

export default defineConfig({
  // base relative : le site marche sous https://<user>.github.io/<repo>/ quel que soit le nom du dépôt.
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __APP_SHA__: JSON.stringify(sha),
    __APP_DATE__: JSON.stringify(date),
    __BUILD_ID__: JSON.stringify(buildId),
  },
  plugins: [
    {
      // Publie version.json à côté du site : la page le relit (sans cache) pour savoir si elle est à jour.
      name: 'version-json',
      generateBundle() {
        this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ version: pkg.version, sha, date, build: buildId }) });
      },
    },
  ],
});
