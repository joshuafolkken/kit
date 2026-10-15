import { describe, expect, it } from 'vitest'
import { fresh_machine_patterns } from './fresh-machine-patterns'
import type { Scenario } from './fresh-machine-spec'

const LUA_START = 'kit-test-lua-start'
const HTML_START = 'kit-test-html-start'
const SVELTE_START = 'kit-test-svelte-start'
const SVELTE_INIT = 'kit-test-svelte-init'
const INIT_NAMES = ['kit-test-lua-init', 'kit-test-html-init', SVELTE_INIT]
const START_NAMES = [LUA_START, HTML_START, SVELTE_START]
const GIT_INIT = 'git init --initial-branch main'
const CREATE_REPOSITORY = 'gh repo create "$RUN_NAME" --private --source . --push'
const START = 'pnpm exec josh start --yes --github'
const LUA_START_COMMAND = `${START} --profile basic`
const MACHINE_IDENTITY = 'git config --global user.name'
const TARBALL = '"$PACKAGE_TARBALL"'
const SVELTEKIT_CHECKS = 'pnpm build && pnpm check'
const PROFILE = 'pnpm josh profile'

// The index of the `josh start` command, whichever flags the pattern passes after the shared ones.
function start_index(commands: ReadonlyArray<string>): number {
	return commands.findIndex((command) => command.startsWith(START))
}

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
		expect(commands).toContain(TARBALL)
		expect(commands).not.toMatch(/\bgit\b|\bgh\b/u)
	})

	it.each(START_NAMES)('%s installs a named published version on the GitHub machine', (name) => {
		const scenario = pattern(name)
		const { commands } = scenario

		expect(scenario).toMatchObject({ package_source: 'published', requires_github: true })
		expect(commands).toContain(
			'pnpm add -D --allow-build=esbuild --allow-build=unrs-resolver @joshuafolkken/kit@"$PACKAGE_VERSION"',
		)
		expect(start_index(commands)).toBeGreaterThan(
			commands.findIndex((command) => command.includes('minimumReleaseAgeExclude')),
		)
	})
})

describe('fresh_machine_patterns gate', () => {
	it.each(START_NAMES)('%s runs the scoped checks the gate asks for on a branch', (name) => {
		const { commands } = pattern(name)

		expect(commands.slice(start_index(commands) + 1)).toStrictEqual([
			'pnpm josh lint:related && pnpm josh test:related',
			'pnpm josh gate',
		])
	})

	it.each([...INIT_NAMES, ...START_NAMES])('%s records the gate from both PATH states', (name) => {
		const path_probes = pattern(name).probes.slice(-2)

		expect(path_probes[0]).toContain("bash --noprofile --norc -c 'pnpm josh gate'")
		expect(path_probes[1]).toContain('./node_modules/.bin/josh gate')
	})

	it.each(START_NAMES)('%s records the profile, repository, labels and first commit', (name) => {
		expect(pattern(name).probes.slice(0, -2)).toStrictEqual([
			PROFILE,
			'gh repo view --json visibility,defaultBranchRef',
			'gh label list --limit 100',
			'git show --name-only --format= "$(git rev-list --max-parents=0 main)"',
		])
	})

	it.each(INIT_NAMES)('%s records the profile, the files and a second init', (name) => {
		const { probes } = pattern(name)

		expect(probes[0]).toBe(PROFILE)
		expect(probes[1]).toContain('-name node_modules -prune -o -print')
		expect(probes[2]).toMatch(
			/sha256sum > (?<file>\S+) && pnpm exec josh init && .+\| diff \k<file> -$/u,
		)
	})
})

describe('fresh_machine_patterns SvelteKit init', () => {
	it('records the sv version and builds and checks the app before kit is installed', () => {
		const { commands } = pattern(SVELTE_INIT)
		const install = commands.findIndex((command) => command.includes(TARBALL))

		expect(commands.slice(1, install)).toStrictEqual(['pnpm dlx sv --version', SVELTEKIT_CHECKS])
	})

	it('builds and checks the app again after josh init', () => {
		expect(pattern(SVELTE_INIT).probes).toContain(SVELTEKIT_CHECKS)
	})

	it.each(INIT_NAMES.filter((name) => name !== SVELTE_INIT))(
		'%s records only the init and PATH probes',
		(name) => {
			expect(pattern(name).probes).toHaveLength(5)
		},
	)
})

// The starting states of joshuafolkken/kit#2848: what exists before `josh start` runs.
describe('fresh_machine_patterns starting states', () => {
	it('names the basic profile for the Lua project', () => {
		expect(pattern(LUA_START).commands).toContain(LUA_START_COMMAND)
	})

	it.each([HTML_START, SVELTE_START])('%s leaves the profile to detection', (name) => {
		expect(pattern(name).commands).toContain(START)
	})

	it('starts the Lua project without Git', () => {
		expect(pattern(LUA_START).commands).not.toContain(GIT_INIT)
	})

	// `josh start` makes the first commit there, so the machine needs the identity the guide sets (#3754).
	it('sets the machine-wide git identity before josh start in the Lua project', () => {
		const { commands } = pattern(LUA_START)
		const identity = commands.findIndex((command) => command.includes(MACHINE_IDENTITY))

		expect(identity).toBeGreaterThan(-1)
		expect(identity).toBeLessThan(start_index(commands))
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
