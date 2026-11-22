import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pnpm } from './stage.js';
import { services } from './services.js';

test('runs pnpm on this platform', () => {
	// On Windows pnpm is a `.cmd`, which starts only through cmd.exe: this fails there if broken.
	assert.doesNotThrow(() => pnpm(['--version']));
});

test('wires forge and daemon to each other, on loopback', () => {
	const { forge, daemon } = services({ web: 1, daemon: 2, live: 3, origin: 'http://localhost:1' });
	assert.equal(forge.entry, 'forge/index.js');
	assert.deepEqual(
		{ ...forge.env, BODY_SIZE_LIMIT: undefined },
		{
			HOST: '127.0.0.1',
			BODY_SIZE_LIMIT: undefined,
			PORT: '1',
			ORIGIN: 'http://localhost:1',
			GEORDI_DAEMON_PORT: '2',
			GEORDI_LIVE_PORT: '3'
		}
	);
	assert.deepEqual(daemon, {
		entry: 'daemon/main.js',
		env: { GEORDI_FORGE_URL: 'ws://127.0.0.1:2', GEORDI_FORGE_HTTP_URL: 'http://127.0.0.1:1' }
	});
});

test('the origin is the forge on loopback unless given', () => {
	assert.equal(services({ web: 1, daemon: 2, live: 3 }).forge.env.ORIGIN, 'http://127.0.0.1:1');
});
