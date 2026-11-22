import { accessSync, constants, statSync } from 'node:fs';
import { delimiter, resolve, sep } from 'node:path';
import type { Agent } from '@geordi/protocol';

export const programVariable = {
	claude: 'CLAUDE_CODE_EXECUTABLE',
	codex: 'CODEX_PATH',
	opencode: 'OPENCODE_PATH'
} as const;

type Env = Record<string, string | undefined>;

/**
 * A variable of an environment, however it is spelled: Windows says `Path`, and a copy of
 * `process.env` (a plain object) no longer answers to `PATH`.
 */
function variable(env: Env, name: string) {
	if (env[name] !== undefined) return env[name];
	const spelled = Object.keys(env).find((key) => key.toUpperCase() === name);
	return spelled ? env[spelled] : undefined;
}

/** What a name on `PATH` may end in: Windows never runs a file that has no extension. */
function extensions(env: Env) {
	if (process.platform !== 'win32') return [''];
	return (variable(env, 'PATHEXT') || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean);
}

/** Resolve the same executable for the daemon's offer and the host's next session. */
export function agentProgram(agent: Agent, env: Env = process.env) {
	const name = variable(env, programVariable[agent]) || agent;
	// A program named on purpose is that file; a name is looked for the way the platform does.
	const candidates =
		name.includes('/') || name.includes(sep)
			? [resolve(name)]
			: (variable(env, 'PATH') ?? '')
					.split(delimiter)
					.filter(Boolean)
					.flatMap((dir) => extensions(env).map((extension) => resolve(dir, name + extension)));
	for (const file of candidates) {
		try {
			accessSync(file, constants.X_OK);
			if (statSync(file).isFile()) return file;
		} catch {
			// Try the next entry on PATH.
		}
	}
}

/**
 * How to start a program that `agentProgram` found. Windows runs `.cmd` and `.bat` files only
 * through `cmd.exe`, and Node would quote the command line it needs.
 */
export function programCommand(
	program: string,
	args: string[]
): { file: string; args: string[]; options: { windowsVerbatimArguments?: boolean } } {
	if (process.platform !== 'win32' || !/\.(cmd|bat)$/i.test(program))
		return { file: program, args, options: {} };
	return {
		file: process.env.ComSpec || 'cmd.exe',
		args: ['/d', '/s', '/c', `"${program}" ${args.join(' ')}`],
		options: { windowsVerbatimArguments: true }
	};
}
