import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
import { promisify } from 'node:util';
import { MODEL_SETTING, SETTING, type Model } from '@geordi/protocol';
import { agentProgram, programCommand } from './program.ts';
import type { AgentAdapter } from './adapter.ts';

const run = promisify(execFile);

function readModel(id: string, details: string): Model {
	const model: Model = { id, name: id, efforts: [] };
	if (!details) return model;
	try {
		const data = JSON.parse(details);
		if (typeof data?.name === 'string' && data.name.trim()) model.name = data.name.trim();
		const variants = data?.variants;
		if (variants && typeof variants === 'object' && !Array.isArray(variants))
			model.efforts = Object.keys(variants).filter(
				(key) => SETTING.test(key) && key !== 'default' && variants[key]?.disabled !== true
			);
	} catch {
		// Keep the ID as the label when the CLI omits or changes its metadata.
	}
	return model;
}

/** In verbose output each model ID is followed by its pretty-printed JSON object. */
export function modelsIn(output: string): Model[] {
	const models = new Map<string, Model>();
	for (const block of output.split(/^(?=[A-Za-z0-9])/m)) {
		const newline = block.indexOf('\n');
		const id = (newline < 0 ? block : block.slice(0, newline)).trim();
		if (!id.includes('/') || !MODEL_SETTING.test(id) || models.has(id)) continue;
		const details = newline < 0 ? '' : block.slice(newline + 1).trim();
		models.set(id, readModel(id, details));
	}
	return [...models.values()];
}

export const opencode: AgentAdapter = {
	async offers() {
		const program = agentProgram('opencode');
		if (!program) return { models: [], efforts: [] };
		// Older CLIs and large catalogs can still provide the compact model list.
		for (const flags of [['models', '--verbose'], ['models']]) {
			try {
				const command = programCommand(program, flags);
				const { stdout } = await run(command.file, command.args, {
					cwd: homedir(),
					timeout: 5000,
					maxBuffer: 16 * 1024 * 1024,
					killSignal: 'SIGKILL',
					windowsHide: true,
					...command.options
				});
				return { models: modelsIn(stdout), efforts: [] };
			} catch {
				// Fall back to model IDs, then to the configured model.
			}
		}
		return { models: [], efforts: [] };
	}
};
