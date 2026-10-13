import { describe, expect, it } from 'vitest'
import { fresh_machine_spec } from './fresh-machine-spec'

const COMMAND = 'pnpm exec josh-app init'
const NAME = 'app-kit-test-html-init'
const CONFIG_FILE = 'josh-app.config.json'

function spec(overrides: Record<string, unknown>): string {
	return JSON.stringify({ name: NAME, commands: [COMMAND], ...overrides })
}

describe('fresh_machine_spec.parse', () => {
	it('fills in a scenario that names only itself and its commands', () => {
		expect(fresh_machine_spec.parse(spec({}))).toStrictEqual({
			name: NAME,
			requires_github: false,
			package_source: 'tarball',
			files: {},
			commands: [COMMAND],
			probes: [],
		})
	})

	it('keeps the files a toolkit places before its install command', () => {
		const files = { [CONFIG_FILE]: '{ "verify": { "dast": false } }\n' }

		expect(fresh_machine_spec.parse(spec({ files })).files).toStrictEqual(files)
	})
})

describe('fresh_machine_spec.parse refusals', () => {
	it.each(['/etc/passwd', '../outside.txt', 'nested/../../outside.txt'])(
		'refuses the file path %s, which leaves the project',
		(file) => {
			expect(() => fresh_machine_spec.parse(spec({ files: { [file]: '' } }))).toThrow(
				/Invalid scenario spec — files\./u,
			)
		},
	)

	it('refuses a name that could not be a directory and repository name', () => {
		expect(() => fresh_machine_spec.parse(spec({ name: 'App Kit' }))).toThrow(
			/Invalid scenario spec — name:/u,
		)
	})

	it('refuses a scenario with no command', () => {
		expect(() => fresh_machine_spec.parse(spec({ commands: [] }))).toThrow(/commands:/u)
	})

	it('refuses a key it does not know, so a typo is not silently dropped', () => {
		expect(() => fresh_machine_spec.parse(spec({ probe: ['pnpm josh gate'] }))).toThrow(
			/Invalid scenario spec/u,
		)
	})
})
