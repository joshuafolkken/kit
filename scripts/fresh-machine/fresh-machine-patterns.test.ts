import { describe, expect, it } from 'vitest'
import { fresh_machine_patterns } from './fresh-machine-patterns'
import type { Scenario } from './fresh-machine-spec'

const LUA_START = 'kit-test-lua-start'
const HTML_START = 'kit-test-html-start'
const SVELTE_START = 'kit-test-svelte-start'
const INIT_NAMES = ['kit-test-lua-init', 'kit-test-html-init', 'kit-test-svelte-init']
const START_NAMES = [LUA_START, HTML_START, SVELTE_START]
const GIT_INIT = 'git init --initial-branch main'
const CREATE_REPOSITORY = 'gh repo create "$RUN_NAME" --private --source . --push'
const START = 'pnpm exec josh start --yes --github'

function pattern(name: string): Scenario {
	const found = fresh_machine_patterns.find(name)

	if (found === undefined) throw new Error(`no pattern named ${name}`)

	return found
}

describe('fresh_machine_patterns', () => {
	it('lists three projects by two commands', () => {
		const names = new Set(fresh_machine_patterns.names())

		expect(names).toStrictEqual(new Set([...INIT_NAMES, ...START_NAMES]))
		expect(fresh_machine_patterns.names()).toHaveLength(names.size)
	})

	it('answers undefined for a name that is not a pattern', () => {
		expect(fresh_machine_patterns.find('kit-test-python-init')).toBeUndefined()
	})

	it.each(INIT_NAMES)('%s installs the packed checkout and needs no GitHub', (name) => {
		const scenario = pattern(name)
		const commands = scenario.commands.join('\n')

		expect(scenario).toMatchObject({ package_source: 'tarball', requires_github: false })
		expect(commands).toContain('"$PACKAGE_TARBALL"')
		expect(commands).not.toMatch(/\bgit\b|\bgh\b/u)
	})

	it.each(START_NAMES)('%s installs a named published version on the GitHub machine', (name) => {
		const scenario = pattern(name)
		const { commands } = scenario

		expect(scenario).toMatchObject({ package_source: 'published', requires_github: true })
		expect(commands).toContain(
			'pnpm add -D --allow-build=esbuild --allow-build=unrs-resolver @joshuafolkken/kit@"$PACKAGE_VERSION"',
		)
		expect(commands.indexOf(START)).toBeGreaterThan(
			commands.findIndex((command) => command.includes('minimumReleaseAgeExclude')),
		)
	})
})

describe('fresh_machine_patterns gate', () => {
	it.each(START_NAMES)('%s runs the scoped checks the gate asks for on a branch', (name) => {
		const { commands } = pattern(name)

		expect(commands.slice(commands.indexOf(START))).toStrictEqual([
			START,
			'pnpm josh lint:related && pnpm josh test:related',
			'pnpm josh gate',
		])
	})

	it.each([...INIT_NAMES, ...START_NAMES])('%s records the gate from both PATH states', (name) => {
		const { probes } = pattern(name)

		expect(probes).toHaveLength(2)
		expect(probes[0]).toContain("bash --noprofile --norc -c 'pnpm josh gate'")
		expect(probes[1]).toContain('./node_modules/.bin/josh gate')
	})
})

// The starting states of joshuafolkken/kit#2848: what exists before `josh start` runs.
describe('fresh_machine_patterns starting states', () => {
	it('starts the Lua project without Git', () => {
		expect(pattern(LUA_START).commands).not.toContain(GIT_INIT)
	})

	it('starts the HTML project with a first commit and no GitHub repository', () => {
		const { commands } = pattern(HTML_START)

		expect(commands.indexOf(GIT_INIT)).toBeGreaterThan(-1)
		expect(commands.indexOf(GIT_INIT)).toBeLessThan(commands.indexOf(START))
		expect(commands).not.toContain(CREATE_REPOSITORY)
	})

	it('starts the SvelteKit project with its repository created and pushed', () => {
		const { commands } = pattern(SVELTE_START)

		expect(commands.indexOf(CREATE_REPOSITORY)).toBeGreaterThan(commands.indexOf(GIT_INIT))
		expect(commands.indexOf(CREATE_REPOSITORY)).toBeLessThan(commands.indexOf(START))
	})

	it('never deletes a repository an earlier run created', () => {
		const every_command = fresh_machine_patterns
			.names()
			.flatMap((name) => pattern(name).commands)
			.join('\n')

		expect(every_command).not.toMatch(/repo delete/u)
	})
})
