import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { build } from 'esbuild';

const repo = join(import.meta.dirname, '../../..');

/**
 * Runs pnpm in the repository. Windows cannot start pnpm's own script file (`npm_execpath`,
 * a `.cjs`), and its `pnpm` on PATH is a `.cmd`: both only start through `cmd.exe`, which
 * finds whatever installation of pnpm is there.
 */
export const pnpm = (/** @type {string[]} */ args) =>
	process.platform === 'win32'
		? execFileSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'pnpm', ...args], {
				cwd: repo,
				stdio: 'inherit'
			})
		: execFileSync('pnpm', args, { cwd: repo, stdio: 'inherit' });

/** For the CommonJS among what is bundled. */
const banner = {
	js: "import { createRequire as makeBundleRequire } from 'node:module'; const require = makeBundleRequire(import.meta.url);"
};

/**
 * Puts Geordi's services into `stage`, for `services.js` (copied there too) to start:
 *
 * - `forge/`: the forge's production build, which needs nothing but Node.
 * - `daemon/`: the daemon, the host of an agent's session (ADR-010), and the agents' ACP
 *   wrappers, one file each. Bundled, the wrappers bring none of the agents' own programs
 *   (some 300 MB each), which Geordi does not use: it runs the ones people have installed.
 *
 * The daemon loads its native terminal and file-watcher packages alongside the bundle.
 */
export async function stageServices(stage) {
	mkdirSync(stage, { recursive: true });
	for (const file of ['LICENSE', 'NOTICE']) {
		cpSync(join(repo, file), join(stage, file));
	}
	cpSync(join(import.meta.dirname, 'services.js'), join(stage, 'services.js'));

	pnpm(['--filter', '@geordi/web', 'build']);
	cpSync(join(repo, 'apps/web/build'), join(stage, 'forge'), { recursive: true });

	// Its TypeScript can't run from inside a package as it does from the repository (Node
	// won't strip types below node_modules, where the protocol would end up).
	const common = {
		bundle: true,
		platform: 'node',
		format: 'esm',
		target: 'node24',
		banner,
		logLevel: 'warning'
	};
	await build({
		...common,
		entryPoints: [
			join(repo, 'apps/daemon/src/main.ts'),
			join(repo, 'apps/daemon/src/host.ts'),
			join(repo, 'apps/daemon/src/file-index-worker.ts')
		],
		outdir: join(stage, 'daemon'),
		external: ['@lydell/node-pty', '@parcel/watcher']
	});
	const resolve = createRequire(join(repo, 'apps/daemon/package.json')).resolve;
	for (const wrapper of ['claude-agent-acp', 'codex-acp']) {
		const wrapperDir = dirname(resolve(`@agentclientprotocol/${wrapper}/package.json`));
		await build({
			...common,
			entryPoints: [join(wrapperDir, 'dist/index.js')],
			outfile: join(stage, 'daemon', `${wrapper}.js`)
		});
	}
}
