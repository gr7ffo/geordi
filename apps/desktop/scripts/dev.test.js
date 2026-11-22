import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { devEnvironment } from './dev.js';
import { desktopRuntime } from '../src/runtime.js';

const env = {
	GEORDI_ASSIGNED_PORTS: '[20000,20001,24000,24001,24002,24003]',
	GEORDI_PORT_WEB: '20000',
	GEORDI_PORT_DESKTOP: '24000',
	GEORDI_PORT_DESKTOP_INSTALL: '20001',
	GEORDI_PORT_OLD_JOB: '24001',
	GEORDI_DATA_DIR: '/installed',
	GEORDI_DAEMON_TOKEN: 'installed-secret',
	ELECTRON_RUN_AS_NODE: '1'
};

test('uses assigned spare ports across blocks, excluding retired job assignments', () => {
	const result = devEnvironment(env, '/workspace');
	assert.equal(result.PORT, '24000');
	assert.equal(result.GEORDI_DAEMON_PORT, '24002');
	assert.equal(result.GEORDI_LIVE_PORT, '24003');
	assert.equal(result.ELECTRON_RUN_AS_NODE, undefined);
	const runtime = desktopRuntime(result);
	// where the dev app's files go, in the platform's own spelling
	const desktop = join('/workspace', '.data/desktop');
	assert.equal(runtime.profile, join(desktop, 'profile'));
	assert.equal(runtime.env.GEORDI_DAEMON_TOKEN, '');
	for (const [key, value] of Object.entries(runtime.env)) {
		if (key !== 'GEORDI_DAEMON_TOKEN') assert.ok(value.startsWith(desktop));
	}
});

test('missing, invalid or insufficient assigned ports fail before building', () => {
	for (const ports of [undefined, '{}', '[20000,20000]', '[1]', '[20000,24000]']) {
		assert.throws(() => devEnvironment({ ...env, GEORDI_ASSIGNED_PORTS: ports }, '/workspace'));
	}
});

test('installed desktop keeps its existing ports and profile behavior', () => {
	assert.deepEqual(desktopRuntime({ PORT: '20000' }), {
		web: 7717,
		daemon: 7718,
		live: 7719,
		env: {}
	});
});

test('dev desktop refuses incomplete or colliding configuration', () => {
	assert.throws(() => desktopRuntime({ GEORDI_DESKTOP_DEV_DIR: 'relative' }), /absolute/);
	assert.throws(() => desktopRuntime({ GEORDI_DESKTOP_DEV_DIR: '/test' }), /PORT/);
	assert.throws(
		() =>
			desktopRuntime({
				GEORDI_DESKTOP_DEV_DIR: '/test',
				PORT: '20000',
				GEORDI_DAEMON_PORT: '20000',
				GEORDI_LIVE_PORT: '20001'
			}),
		/distinct/
	);
});
