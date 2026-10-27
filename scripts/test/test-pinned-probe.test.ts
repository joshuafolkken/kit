import { rm } from 'node:fs/promises'
import { git_fixture_workspace, type FixtureWorkspace } from '#scripts/git/git-fixture-workspace'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { test_pinned } from './test-pinned'
import { test_pinned_fixture } from './test-pinned-fixture'
import { test_pinned_ledger } from './test-pinned-ledger'
import { test_pinned_logic } from './test-pinned-logic'
import { test_pinned_pool } from './test-pinned-pool'
import { test_red } from './test-red'

// joshuafolkken/kit#4936: each probe's verdict is stored as soon as it is reached, so a run stopped
// mid-way keeps it, and a stored `green` is rechecked against only the tests added or edited since.

const RUN_TIMEOUT = 240_000
const { DRIVER_FILE, build_change_branch, write } = test_pinned_fixture
const TSCONFIG_CONTENT =
	'{ "compilerOptions": { "allowJs": true, "moduleResolution": "bundler", "module": "esnext" } }\n'
const UNPINNED_HUNK = `${DRIVER_FILE}:6`
const NEW_TEST = 'new.test.ts'
const OTHER_SOURCE = 'other.js'
// A test that pins the unpinned hunk: reverting it reads `result.token` on the driver path.
const PINNING_TEST = `import { expect, it } from 'vitest'
import { token_of } from './driver.js'

it('reads the code on the driver path', () => {
	expect(token_of({ token: 't', code: 0 }, ['--driver'])).toBe('0')
})
`
// A test that reaches the driver and pins nothing new.
const REACHING_TEST = `import { expect, it } from 'vitest'
import { label } from './driver.js'

it('labels a busy code', () => {
	expect(label(1)).toBe('busy')
})
`

const fixture: { current?: FixtureWorkspace } = {}

beforeEach(() => {
	const workspace = git_fixture_workspace.open_workspace('test-pinned-probe-')

	fixture.current = workspace
	process.chdir(workspace.workspace)
})

afterEach(async () => {
	vi.restoreAllMocks()
	if (fixture.current !== undefined) await git_fixture_workspace.close_workspace(fixture.current)
})

async function build_with_graph(): Promise<void> {
	await build_change_branch()
	await write('tsconfig.json', TSCONFIG_CONTENT)
}

async function run_locations(): Promise<Array<string>> {
	const report = await test_pinned.run(test_pinned_logic.DEFAULT_MAX_HUNKS)

	return report.unpinned.map((hunk) => test_pinned_logic.location(hunk))
}

// The unpinned places the cache alone answers, `undefined` when a hunk has no verdict there.
async function held_locations(): Promise<Array<string> | undefined> {
	const report = await test_pinned.held_report(test_pinned_logic.DEFAULT_MAX_HUNKS)

	return report?.unpinned.map((hunk) => test_pinned_logic.location(hunk))
}

// The selection each probe ran with: `related <file>` over every reaching test, or `run <tests>`.
function selections_of(runs: MockInstance<typeof test_red.probe_in>): Array<Array<string>> {
	return runs.mock.calls.map(([, selection]) => selection.slice(0, 2))
}

describe('test_pinned.run stopped after its first verdict', () => {
	it(
		'keeps that verdict, so the next run probes only the hunk it had not reached',
		async () => {
			await build_with_graph()
			vi.spyOn(test_pinned_pool, 'lane_plan').mockReturnValue({ lanes: 1, workers: 1 })
			const probe_in = test_red.probe_in.bind(test_red)

			vi.spyOn(test_red, 'probe_in')
				.mockImplementationOnce(probe_in)
				.mockRejectedValueOnce(new Error('stopped'))
			await expect(run_locations()).rejects.toThrow('stopped')
			vi.restoreAllMocks()
			const runs = vi.spyOn(test_red, 'probe_in')

			expect(await run_locations()).toEqual([UNPINNED_HUNK])
			expect(runs).toHaveBeenCalledTimes(1)
		},
		RUN_TIMEOUT,
	)
})

// joshuafolkken/kit#5078: a run's probes are timed into one ledger row, and a later read of the same
// tree answers from the cache alone.
describe('test_pinned.run timed into the ledger', () => {
	it(
		'records one row with a time per probe, after which held_report answers without a probe',
		async () => {
			await build_with_graph()
			const row = vi.spyOn(test_pinned_ledger, 'record')
			const runs = vi.spyOn(test_red, 'probe_in')

			expect(await held_locations()).toBeUndefined()
			await run_locations()
			const [held, times] = row.mock.calls[0] ?? []

			expect([held, times?.length]).toEqual([0, runs.mock.calls.length])
			runs.mockClear()
			expect(await held_locations()).toEqual([UNPINNED_HUNK])
			expect(runs).not.toHaveBeenCalled()
		},
		RUN_TIMEOUT,
	)
})

describe('test_pinned.run that held every verdict', () => {
	it(
		'writes each held verdict back with its basis, so a later test reaching no hunk starts no vitest',
		async () => {
			await build_with_graph()
			await run_locations()
			await run_locations()
			await write(NEW_TEST, "import { it } from 'vitest'\n\nit('runs', () => {})\n")
			const runs = vi.spyOn(test_red, 'probe_in')

			expect(await run_locations()).toEqual([UNPINNED_HUNK])
			expect(runs).not.toHaveBeenCalled()
		},
		RUN_TIMEOUT,
	)
})

describe('test_pinned.run after a test reaching an unpinned hunk is added', () => {
	it(
		'rechecks the unpinned hunk against the added test only, and pins it on red',
		async () => {
			await build_with_graph()
			await run_locations()
			await write(NEW_TEST, PINNING_TEST)
			const runs = vi.spyOn(test_red, 'probe_in')

			expect(await run_locations()).toEqual([])
			expect(selections_of(runs)).toEqual([['run', NEW_TEST]])
		},
		RUN_TIMEOUT,
	)

	it(
		'keeps the hunk unpinned on a green recheck, and holds that verdict on the next run',
		async () => {
			await build_with_graph()
			await run_locations()
			await write(NEW_TEST, REACHING_TEST)
			const runs = vi.spyOn(test_red, 'probe_in')

			expect(await run_locations()).toEqual([UNPINNED_HUNK])
			expect(selections_of(runs)).toEqual([['run', NEW_TEST]])
			runs.mockClear()
			expect(await run_locations()).toEqual([UNPINNED_HUNK])
			expect(runs).not.toHaveBeenCalled()
		},
		RUN_TIMEOUT,
	)
})

describe('test_pinned.run where a recheck cannot answer', () => {
	it(
		'runs every reaching test once a source changed beside the added test',
		async () => {
			await build_with_graph()
			await run_locations()
			await write(NEW_TEST, REACHING_TEST)
			await write(OTHER_SOURCE, 'export const OTHER = 1\n')
			const runs = vi.spyOn(test_red, 'probe_in')

			expect(await run_locations()).toEqual([UNPINNED_HUNK])
			// A file nothing imports drops the pinned hunk's basis as well (joshuafolkken/kit#4873).
			expect(selections_of(runs)).toEqual([
				['related', DRIVER_FILE],
				['related', DRIVER_FILE],
			])
		},
		RUN_TIMEOUT,
	)

	it(
		'runs every reaching test once a test the verdict rested on is deleted',
		async () => {
			await build_with_graph()
			await write(NEW_TEST, REACHING_TEST)
			await run_locations()
			await rm(NEW_TEST)
			const runs = vi.spyOn(test_red, 'probe_in')

			expect(await run_locations()).toEqual([UNPINNED_HUNK])
			expect(selections_of(runs)).toEqual([['related', DRIVER_FILE]])
		},
		RUN_TIMEOUT,
	)
})
