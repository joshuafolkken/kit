import { describe, expect, it } from 'vitest'
import { cases_interaction } from './cases-interaction'

// joshuafolkken/kit#4491: the interaction boundaries are read off the source text — the state paths it
// names with the constants bound to them, and the environment variables and resident processes it
// reads — and stay silent on a source that names neither.

describe('cases_interaction.state_paths_in', () => {
	it('names a .josh state path with the constant bound to it', () => {
		const source = "const LEDGER_DIRECTORY = '.josh/observations'\nread(LEDGER_DIRECTORY)\n"

		expect(cases_interaction.state_paths_in(source)).toStrictEqual([
			{ path: '.josh/observations', constants: ['LEDGER_DIRECTORY'] },
		])
	})

	it('cuts a templated path at its placeholder and folds a trailing slash', () => {
		const source = 'const P = `.josh/tmp/handoff-${n}.json`\nconst D = ".josh/tmp/"\n'

		expect(cases_interaction.state_paths_in(source).map((state) => state.path)).toStrictEqual([
			'.josh/tmp/handoff-',
			'.josh/tmp',
		])
	})

	it('names a lock file literal', () => {
		expect(cases_interaction.state_paths_in("open('run.lock')")).toStrictEqual([
			{ path: 'run.lock', constants: [] },
		])
	})

	it('names a temporary-directory record by its josh- file prefix', () => {
		const source =
			"const STATE_PREFIX = 'josh-lane-state-'\nconst P = `josh-run-events-${run}.jsonl`\n"

		expect(cases_interaction.state_paths_in(source)).toStrictEqual([
			{ path: 'josh-lane-state-', constants: ['STATE_PREFIX'] },
			{ path: 'josh-run-events-', constants: ['P'] },
		])
	})
})

describe('cases_interaction.state_paths_in on a source with no state', () => {
	it.each([
		['the bare .josh root', "const ROOT = '.josh/'"],
		['a josh- name that is not a file prefix', "const SERVICE = 'josh-claude-code-oauth-token'"],
		['an unquoted mention in a comment', '// writes .josh/observations on exit'],
		['a pathspec naming .josh', "const EXCLUDE = ':(exclude).josh'"],
		['a bare lock suffix', "const LOCK_SUFFIX = '.lock'"],
		['a source with no state', 'export function add(a: number, b: number) { return a + b }'],
	])('names no state for %s', (_label, source) => {
		expect(cases_interaction.state_paths_in(source)).toStrictEqual([])
	})
})

describe('cases_interaction.environment_in', () => {
	it('names variables read in the bracket and dot forms', () => {
		const source = "const a = process.env['GIT_DIR']\nconst b = process.env.CI\n"

		expect(cases_interaction.environment_in(source).variables).toStrictEqual(['GIT_DIR', 'CI'])
	})

	it('resolves a key held in a constant, including the environment default parameter', () => {
		const source =
			"const ROOT_KEY = 'JOSH_LANE_ROOT'\nfunction f(environment = process.env) { return environment[ROOT_KEY] }\n"

		expect(cases_interaction.environment_in(source).variables).toStrictEqual(['JOSH_LANE_ROOT'])
	})

	it('names the whole environment when it is handed on without a variable', () => {
		expect(
			cases_interaction.environment_in('spawn(cmd, { env: { ...process.env } })').variables,
		).toStrictEqual(['process.env'])
	})

	it('collapses a resident process named in many identifiers to its kind', () => {
		const source = 'spawn_daemon()\nconst DAEMON_STOP = 1\nwrite_beacon()\n'

		expect(cases_interaction.environment_in(source).residents).toStrictEqual(['daemon', 'beacon'])
	})

	it.each([
		['prose about the daemon', '// the daemon may be stale'],
		['an environment index with no process.env in the source', 'environment[KEY]'],
		['a source with no environment', 'export const x = 1'],
	])('names no environment for %s', (_label, source) => {
		expect(cases_interaction.environment_in(source)).toStrictEqual({ variables: [], residents: [] })
	})
})

describe('cases_interaction.wording', () => {
	it('owes the concurrent-writer case in Japanese by default', () => {
		expect(cases_interaction.wording().state_cases).toContain('他の書き手との並行書き込み')
	})

	it('names the same cases in English, one for one', () => {
		const japanese = cases_interaction.wording('ja')
		const english = cases_interaction.wording('en')

		expect(english.variable_cases).toContain('unset')
		expect(english.state_cases).toHaveLength(japanese.state_cases.length)
		expect(english.resident_cases).toHaveLength(japanese.resident_cases.length)
	})
})
