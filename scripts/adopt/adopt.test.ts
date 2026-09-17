import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { ALIASES, COMMAND_MAP } from '#scripts/josh/josh-command-map'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { adopt } from './adopt'
import { adopt_logic } from './adopt-logic'

const KIT = '@joshuafolkken/kit'
const APP_KIT = '@joshuafolkken/app-kit'
const CONSUMER = 'joshuafolkken-com'
const MANIFEST = 'package.json'
const REFUSAL = 'Refusing to adopt'
const MISSPELLED_FLAG = '--dryrun'
const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const NODE_MODULES = 'node_modules'
const BIN = '.bin'
const JOSH = 'josh'
const RANGE = '^1.0.0'

const state = { workspace: '' }

function write_json(file_path: string, content: Record<string, unknown>): void {
	mkdirSync(path.dirname(file_path), { recursive: true })
	writeFileSync(file_path, JSON.stringify(content))
}

function make_repository(name?: string): string {
	const repository_path = mkdtempSync(path.join(state.workspace, 'repo-'))

	if (name !== undefined) write_json(path.join(repository_path, MANIFEST), { name })

	return repository_path
}

// A consumer declaring two toolkits with only one of them runnable. This is the partial install that
// used to leave the run syncing kit alone, writing app-kit's overlay paths back to kit's originals
// (joshuafolkken/kit#1540).
function make_partial_install(): string {
	const repository_path = mkdtempSync(path.join(state.workspace, 'repo-'))
	const modules = path.join(repository_path, NODE_MODULES)

	write_json(path.join(repository_path, MANIFEST), {
		name: CONSUMER,
		devDependencies: { [KIT]: RANGE, [APP_KIT]: RANGE },
	})
	write_json(path.join(modules, KIT, MANIFEST), { name: KIT, bin: { [JOSH]: 'dist/josh.js' } })
	mkdirSync(path.join(modules, BIN), { recursive: true })
	writeFileSync(path.join(modules, BIN, JOSH), '#!/bin/sh\n')

	return repository_path
}

beforeEach(() => {
	state.workspace = mkdtempSync(path.join(tmpdir(), 'adopt-'))
	vi.spyOn(console, 'info').mockImplementation(() => undefined)
	vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
	vi.restoreAllMocks()
	rmSync(state.workspace, { recursive: true, force: true })
})

// The same boundary `josh sync` draws (joshuafolkken/kit#868): the sync step would overwrite the
// distribution source with its own derived templates, so the refusal comes before anything writes.
describe('adopt_logic.refuse_inside_kit_repository', () => {
	it('refuses the run inside the distribution package own repository', () => {
		expect(adopt_logic.refuse_inside_kit_repository(make_repository(KIT))).toContain(REFUSAL)
	})

	// app-kit is itself a consumer of kit — `josh propagate` carries kit releases into it — so
	// adopting there is the intended use, and a refusal keyed on the npm scope would lock it out.
	it('allows the run inside another toolkit own repository, which consumes kit', () => {
		expect(adopt_logic.refuse_inside_kit_repository(make_repository(APP_KIT))).toBeUndefined()
	})

	it('allows the run in a consumer repository', () => {
		expect(adopt_logic.refuse_inside_kit_repository(make_repository(CONSUMER))).toBeUndefined()
	})

	it('allows the run where there is no manifest to read a name from', () => {
		expect(adopt_logic.refuse_inside_kit_repository(state.workspace)).toBeUndefined()
	})
})

// The gate and the pull request run through `pnpm josh`, and pnpm writes that shim only for a direct
// dependency — so a repository declaring app-kit alone would fail those steps after the upgrade and
// the sync had already written.
describe('adopt_logic.refuse_without_kit', () => {
	it('refuses a run that would carry no kit', () => {
		expect(
			adopt_logic.refuse_without_kit([
				{ package_name: APP_KIT, version: 'latest', bin_name: 'josh-app' },
			]),
		).toContain(REFUSAL)
	})

	it('allows a run that carries kit alongside another toolkit', () => {
		expect(
			adopt_logic.refuse_without_kit([
				{ package_name: KIT, version: 'latest', bin_name: 'josh' },
				{ package_name: APP_KIT, version: 'latest', bin_name: 'josh-app' },
			]),
		).toBeUndefined()
	})
})

// Continuing past a dropped toolkit does not merely do less — it syncs kit without the overlay tier
// and writes the overlay's paths back to kit's originals, which is a wrong diff wearing kit's face
// (joshuafolkken/kit#1540). Both ways of falling out end there, so both refuse.
describe('adopt_logic.refuse_incomplete_plan', () => {
	it('refuses and names a toolkit declared under dependencies', () => {
		const refusal = adopt_logic.refuse_incomplete_plan([APP_KIT], [])

		expect(refusal).toContain(REFUSAL)
		expect(refusal).toContain(APP_KIT)
	})

	// The path that used to say nothing at all: a declared toolkit with no runnable CLI here.
	it('refuses and names a toolkit whose CLI could not be resolved', () => {
		const refusal = adopt_logic.refuse_incomplete_plan([], [APP_KIT])

		expect(refusal).toContain(REFUSAL)
		expect(refusal).toContain(APP_KIT)
	})

	// The two causes are answered separately, so the refusal says which fix applies to which toolkit.
	it('names both causes when a run fell out of the plan in both ways', () => {
		const refusal = adopt_logic.refuse_incomplete_plan([APP_KIT], [KIT])

		expect(refusal).toContain('devDependencies')
		expect(refusal).toContain('pnpm install')
	})

	it('allows the run when every declared toolkit is in the plan', () => {
		expect(adopt_logic.refuse_incomplete_plan([], [])).toBeUndefined()
	})
})

describe('adopt_logic.resolve_self_target', () => {
	it('answers nothing for a directory that is not a work tree with a GitHub origin', () => {
		expect(adopt_logic.resolve_self_target(make_repository(CONSUMER))).toBeUndefined()
	})
})

describe('adopt_logic.build_plan', () => {
	it('names the command that opened the issue, so the body says where it came from', () => {
		expect(adopt_logic.build_plan([]).origin).toBe(adopt_logic.ADOPT_ORIGIN)
	})
})

describe('adopt.run — refusing before anything writes', () => {
	it('exits non-zero inside the distribution package own repository', () => {
		expect(adopt.run([], make_repository(KIT))).toBe(FAILURE_EXIT_CODE)
	})

	it('refuses an argument it does not know rather than ignoring it', () => {
		expect(adopt.run([MISSPELLED_FLAG], make_repository(CONSUMER))).toBe(FAILURE_EXIT_CODE)
	})
})

// Nothing installed is a skip, not a failure: the command is run speculatively ("upgrade whatever is
// here"), and a non-zero exit would make that reflex a broken build.
describe('adopt.run_here — nothing to adopt', () => {
	it('opens no issue and reports the skip when no toolkit is installed', () => {
		const spy = vi.spyOn(console, 'info')

		expect(adopt.run_here(make_repository(CONSUMER), false)).toBe(SUCCESS_EXIT_CODE)
		expect(spy).toHaveBeenCalledWith(adopt.NOTHING_TO_ADOPT)
	})
})

// The regression guard: with app-kit declared but not runnable, the run must not go on to sync kit
// by itself (joshuafolkken/kit#1540). It stops before `resolve_self_target`, so nothing writes.
describe('adopt.run_here — a declared toolkit that fell out of the plan', () => {
	it('refuses a partial install rather than syncing the base toolkit alone', () => {
		const spy = vi.spyOn(console, 'error')

		expect(adopt.run_here(make_partial_install(), false)).toBe(FAILURE_EXIT_CODE)
		expect(spy.mock.calls.flat().join('\n')).toContain(APP_KIT)
	})

	// A dry run has to list what the real run does, and here the real run does nothing at all. The
	// named toolkit is what separates this from the pre-existing refusals, which stop for other
	// reasons and never say which toolkit fell out.
	it('refuses the dry run on the same tree, so the two cannot disagree', () => {
		const spy = vi.spyOn(console, 'error')

		expect(adopt.run_here(make_partial_install(), true)).toBe(FAILURE_EXIT_CODE)
		expect(spy.mock.calls.flat().join('\n')).toContain(APP_KIT)
	})
})

describe('adopt.parse_options', () => {
	it('accepts the dry-run flag', () => {
		const options = adopt.parse_options(['--dry-run'])

		expect(options.is_dry_run).toBe(true)
		expect(options.usage).toBeUndefined()
	})

	it('accepts no flags at all', () => {
		expect(adopt.parse_options([]).is_dry_run).toBe(false)
	})

	it('names every accepted flag in the usage line', () => {
		const { usage } = adopt.parse_options([MISSPELLED_FLAG])

		expect(usage).toContain('Usage:')
		for (const flag of adopt.KNOWN_FLAGS) expect(usage).toContain(flag)
	})
})

describe('josh adopt registration', () => {
	it('is registered as a Project command', () => {
		const { adopt: entry } = COMMAND_MAP

		expect(entry?.script).toBe('scripts/adopt/adopt.ts')
	})

	it('is reachable through the ad alias', () => {
		const { ad } = ALIASES

		expect(ad).toBe('adopt')
	})
})
