import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { untyped_environment } from '#eslint/untyped-environment.js'
import { execa } from 'execa'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { eslint_daemon_environment } from './eslint-daemon-environment'
import { eslint_heap } from './eslint-heap'

const PROJECT_ROOT = process.cwd()
const project_require = createRequire(path.join(PROJECT_ROOT, 'package.json'))
const ESLINT_DIRECTORY = path.dirname(project_require.resolve('eslint/package.json'))
const ESLINT_D_DIRECTORY = path.dirname(project_require.resolve('eslint_d/package.json'))
const CALLERS = [
	{ CLAUDE_SESSION_ID: 'session', NODE_OPTIONS: '--trace-warnings', FORCE_COLOR: '1' },
	{ npm_config_user_agent: 'pnpm', PATH: '/project/node_modules/.bin', NODE_OPTIONS: '' },
]

function module_url(relative: string): string {
	return pathToFileURL(path.join(ESLINT_D_DIRECTORY, relative)).href
}

// `eslint_d`'s own record name, computed by its own resolver in a process launched the way kit
// launches the forwarder: from the project root, under the daemon environment and nothing else.
async function eslint_d_record(): Promise<string> {
	const script = [
		`const { createResolver } = await import('${module_url('lib/resolver.js')}')`,
		`const { configFile } = await import('${module_url('lib/config.js')}')`,
		'process.stdout.write(configFile(createResolver()))',
	].join('\n')
	const result = await execa(process.execPath, ['--input-type=module', '-e', script], {
		cwd: PROJECT_ROOT,
		env: eslint_daemon_environment.environment(),
		extendEnv: false,
	})

	return result.stdout
}

// What `read` answers while the process runs under one caller's environment.
function under_caller<T>(variables: Record<string, string>, read: () => T): T {
	for (const [name, value] of Object.entries(variables)) vi.stubEnv(name, value)
	const answer = read()

	vi.unstubAllEnvs()

	return answer
}

function record_file(): string {
	return eslint_daemon_environment.record_file(ESLINT_DIRECTORY, PROJECT_ROOT)
}

afterEach(() => {
	vi.unstubAllEnvs()
})

// joshuafolkken/kit#8848: every caller reaches one daemon, whatever environment it runs under.
describe('eslint_daemon_environment.environment', () => {
	it('is the same for callers whose own environments differ', () => {
		const [first, second] = CALLERS.map((variables) =>
			under_caller(variables, eslint_daemon_environment.environment),
		)

		expect(first).toStrictEqual(second)
	})

	it('carries the heap, the untyped switch and the refusal of the bundled eslint, no color', () => {
		vi.stubEnv('FORCE_COLOR', '1')

		const environment = eslint_daemon_environment.environment()

		expect(environment).toMatchObject({
			NODE_OPTIONS: eslint_heap.with_heap(undefined),
			ESLINT_D_MISS: 'fail',
			...untyped_environment.environment(),
		})
		expect(environment).not.toHaveProperty('FORCE_COLOR')
	})
})

describe('eslint_daemon_environment.record_file', () => {
	it('names one record for callers whose own environments differ', () => {
		const [first, second] = CALLERS.map((variables) => under_caller(variables, record_file))

		expect(first).toBe(second)
	})

	// The pin on `eslint_d`'s record format: a release that moves the record, renames it or hashes
	// another input fails here rather than leaving kit reading a record that is never written.
	it("matches the record eslint_d's own resolver names under the daemon environment", async () => {
		expect(await eslint_d_record()).toBe(record_file())
	})
})

describe('eslint_daemon_environment.is_record_name', () => {
	it('reads a daemon record', () => {
		expect(eslint_daemon_environment.is_record_name(`.eslint_d-${'a'.repeat(64)}`)).toBe(true)
	})

	it.each(['.eslint_d', '.eslint_d-toolchain', '.eslint_d-calls', `.eslint_d-${'a'.repeat(63)}`])(
		'leaves %s alone',
		(name) => {
			expect(eslint_daemon_environment.is_record_name(name)).toBe(false)
		},
	)
})
