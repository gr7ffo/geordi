import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { agentProgram, programCommand } from './program.ts';

const windows = process.platform === 'win32';
/** Where an installation of OpenCode puts its program, on this platform. */
const name = windows ? 'opencode.exe' : 'opencode';

/** A directory holding programs of the given names, as an installation leaves them. */
function installed(...names: string[]) {
	const dir = mkdtempSync(join(tmpdir(), 'geordi-program-'));
	for (const file of names) {
		writeFileSync(join(dir, file), '');
		chmodSync(join(dir, file), 0o755);
	}
	return dir;
}

/** What `agentProgram` finds in `dir`: Windows spells an extension in its own case. */
const found = (dir: string) => agentProgram('opencode', { PATH: dir })?.toLowerCase();
const pathIn = (dir: string, file: string) => join(dir, file).toLowerCase();

describe('the agent program', () => {
	it('is the file its own variable names', () => {
		expect(agentProgram('opencode', { OPENCODE_PATH: process.execPath })).toBe(process.execPath);
	});

	it('is looked for on PATH', () => {
		const dir = installed(name);
		expect(found(dir)).toBe(pathIn(dir, name));
	});

	it('is found when the environment spells PATH in Windows’ own case', () => {
		// A copy of the daemon's environment says `Path`: a plain object no longer answers to `PATH`.
		const dir = installed(name);
		expect(agentProgram('opencode', { Path: dir })?.toLowerCase()).toBe(pathIn(dir, name));
	});

	it('is nothing when no entry of PATH holds it', () => {
		expect(agentProgram('opencode', { PATH: installed() })).toBeUndefined();
	});

	it.skipIf(!windows)('is a file Windows can run, not npm’s shim for other systems', () => {
		const withExe = installed('opencode', 'opencode.cmd', 'opencode.exe');
		expect(found(withExe)).toBe(pathIn(withExe, 'opencode.exe'));
		const withCmd = installed('opencode', 'opencode.cmd');
		expect(found(withCmd)).toBe(pathIn(withCmd, 'opencode.cmd'));
	});

	it.skipIf(!windows)('runs a .cmd through cmd.exe, which Node refuses to start itself', () => {
		const command = programCommand('C:\\tools\\opencode.cmd', ['models', '--verbose']);
		expect(command.file.toLowerCase()).toMatch(/cmd\.exe$/);
		expect(command.args).toEqual(['/d', '/s', '/c', '"C:\\tools\\opencode.cmd" models --verbose']);
		expect(command.options).toEqual({ windowsVerbatimArguments: true });
	});

	it('starts a program as it is when the platform can run it itself', () => {
		const command = programCommand(process.execPath, ['acp']);
		expect(command.file).toBe(process.execPath);
		expect(command.args).toEqual(['acp']);
		expect(command.options).toEqual({});
	});
});
