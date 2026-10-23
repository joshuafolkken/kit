import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// joshuafolkken/kit#4660: a run can write `.env`, so a switch that turns a guard off counts only from
// the environment the session was launched with. The file's bytes are injected through `node:fs`.

const read_file_mock = vi.hoisted(() => vi.fn<(file: string, encoding: string) => string>())

vi.mock('node:fs', async (import_original) => ({
	...(await import_original<Record<string, unknown>>()),
	readFileSync: read_file_mock,
}))

const { josh_environment_file } = await import('./josh-environment-file')
const { hook_decision } = await import('./hook-decision')
const { OPTIONAL_ENV_FILE_FLAGS } = await import('./josh-command-types')

const RULE_GUARD = 'JOSH_RULE_GUARD'
const OTHER_KEY = 'JOSH_LAUNCH_ONLY_TEST_VALUE'
const SWITCH_KEYS = [RULE_GUARD, 'JOSH_BATCH_GUARD', 'JOSH_PRE_COMMIT_FORCE', 'JOSH_SCOPED_GREEN']
const KEYS = [...SWITCH_KEYS, OTHER_KEY]
const FILE = KEYS.map((key) => `${key}=off`).join('\n')
const OTHER_FLAG = '--trace-warnings'

function stub_launch_environment(): void {
	for (const key of KEYS) vi.stubEnv(key, undefined)
	read_file_mock.mockReturnValue(FILE)
}

function restore(): void {
	vi.unstubAllEnvs()
	read_file_mock.mockReset()
}

describe('josh_environment_file — launch-only switches', () => {
	beforeEach(stub_launch_environment)
	afterEach(restore)

	it.each(SWITCH_KEYS)('never takes %s from .env', (key) => {
		josh_environment_file.load_environment_file()

		expect(process.env[key]).toBeUndefined()
	})

	it('still takes every other key from .env', () => {
		josh_environment_file.load_environment_file()

		expect(process.env[OTHER_KEY]).toBe('off')
	})

	it('swallows an unreadable file', () => {
		read_file_mock.mockImplementation(() => {
			throw new Error('ENOENT')
		})

		expect(() => {
			josh_environment_file.load_environment_file()
		}).not.toThrow()
	})
})

describe('josh_environment_file — the rule guard switch', () => {
	beforeEach(stub_launch_environment)
	afterEach(restore)

	it('keeps the rule guard on when .env sets JOSH_RULE_GUARD=off', () => {
		josh_environment_file.load_environment_file()

		expect(hook_decision.is_switch_enabled(RULE_GUARD)).toBe(true)
	})

	it('still honours JOSH_RULE_GUARD=off from the launch environment', () => {
		vi.stubEnv(RULE_GUARD, 'off')
		read_file_mock.mockReturnValue(`${RULE_GUARD}=on`)
		josh_environment_file.load_environment_file()

		expect(hook_decision.is_switch_enabled(RULE_GUARD)).toBe(false)
	})
})

describe('josh_environment_file.apply_node_flags', () => {
	beforeEach(stub_launch_environment)
	afterEach(restore)

	// node's own `--env-file` loader cannot leave a key out, so the flag never reaches it.
	it('loads the .env flag itself and drops it from the node flags', () => {
		expect(josh_environment_file.apply_node_flags(OPTIONAL_ENV_FILE_FLAGS)).toStrictEqual([])
		expect(process.env[OTHER_KEY]).toBe('off')
		expect(process.env[RULE_GUARD]).toBeUndefined()
	})

	it('passes other flags through without reading .env', () => {
		expect(josh_environment_file.apply_node_flags([OTHER_FLAG])).toStrictEqual([OTHER_FLAG])
		expect(read_file_mock).not.toHaveBeenCalled()
	})
})
