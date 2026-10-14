import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { fresh_machine_spec } from './fresh-machine-spec'

const COMMAND = 'pnpm exec josh-app init'
const NAME = 'app-kit-test-html-init'
const CONFIG_FILE = 'josh-app.config.json'
const STOP_COMMAND = 'pnpm josh backlogrun --stop'
const LANE_CHILD_APPROVAL_PROBE = "cat /tmp/josh-lane-dispatch-*.log | grep -c 'requires approval'"
const IN_PROJECT_TARBALL_INSTALL =
	'cp "$PACKAGE_TARBALL" . && pnpm add -D --allow-build=esbuild --allow-build=unrs-resolver "./$(basename "$PACKAGE_TARBALL")"'

const NODE_SPEC = 'kit-test-backlogrun.json'
const PYTHON_SPEC = 'kit-test-backlogrun-python.json'

function spec(overrides: Record<string, unknown>): string {
	return JSON.stringify({ name: NAME, commands: [COMMAND], ...overrides })
}

function kept_spec(name: string): ReturnType<typeof fresh_machine_spec.parse> {
	return fresh_machine_spec.parse(
		readFileSync(path.join(import.meta.dirname, 'specs', name), 'utf8'),
	)
}

describe('fresh_machine_spec.parse', () => {
	it('fills in a scenario that names only itself and its commands', () => {
		expect(fresh_machine_spec.parse(spec({}))).toStrictEqual({
			name: NAME,
			requires_github: false,
			requires_claude: false,
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

describe('fresh_machine_spec.parse on the backlogrun specs kit keeps', () => {
	// joshuafolkken/kit#3760: the README's Quick start through its first `backlogrun`, run as written.
	it('reads the backlogrun spec kit keeps, which starts Claude Code with the saved token', () => {
		const scenario = kept_spec(NODE_SPEC)

		expect(scenario.requires_claude).toBe(true)
		expect(scenario.commands).toContain('pnpm exec josh start --yes --github')
		expect(scenario.commands.at(-1)).toBe(STOP_COMMAND)
	})

	// joshuafolkken/kit#3796: a basic (non-Node) project reaches its first lane without approval prompts.
	it('reads the basic backlogrun spec kit keeps, which checks the distributed settings', () => {
		const scenario = kept_spec(PYTHON_SPEC)

		expect(Object.keys(scenario.files)).toStrictEqual(['pyproject.toml', 'main.py'])
		expect(scenario.commands).toContain(
			'grep -q \'"workflow": "github"\' package.json && test -f .claude/settings.json',
		)
		expect(scenario.commands.at(-1)).toBe(STOP_COMMAND)
	})

	// joshuafolkken/kit#3803: both specs wait for the first lane and read its child's log, not only the parent's.
	it.each([NODE_SPEC, PYTHON_SPEC])(
		'makes %s wait for a lane child and count its approval prompts',
		(name) => {
			const scenario = kept_spec(name)

			expect(scenario.commands).not.toContain('sleep 120')
			expect(scenario.commands.at(-3)).toMatch(/grep -q 'dispatching' && break/u)
			// The loop alone exits 0 after its last try; the trailing grep is what fails the run.
			expect(scenario.commands.at(-3)).toMatch(
				/done; pnpm josh run:event --from 0 \| grep 'dispatching'$/u,
			)
			expect(scenario.commands.at(-2)).toMatch(/gh pr list --state all/u)
			expect(scenario.probes).toContain(LANE_CHILD_APPROVAL_PROBE)
		},
	)

	// joshuafolkken/kit#3803: pnpm records a `file:` tarball relative to the lockfile, so one outside
	// the project resolves elsewhere from a lane a directory deeper; one committed inside it does not.
	it.each([NODE_SPEC, PYTHON_SPEC])(
		'makes %s install kit from a tarball inside the project',
		(name) => {
			expect(kept_spec(name).commands).toContain(IN_PROJECT_TARBALL_INSTALL)
		},
	)
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
