import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const run_mock = vi.hoisted(() => vi.fn())

vi.mock('#scripts/lib/buffered-process', () => ({
	buffered_process: {
		run_buffered_process: run_mock,
		is_process_failed: (result: { exit_code: number | undefined }): boolean =>
			result.exit_code !== 0,
	},
}))
vi.mock('#scripts/gate/type-check-step', () => ({
	type_check_step: { resolve_type_check_args: vi.fn(async () => ['josh', 'check']) },
}))

const is_kit_mock = vi.hoisted(() => vi.fn(() => false))

vi.mock('#scripts/gate/project-checks', () => ({
	project_checks: { is_kit_repository: is_kit_mock },
}))

const record_mock = vi.hoisted(() => vi.fn())
const READ_TREE = vi.hoisted(() => ({ files: { digest_of: 'digest-a' }, base: 'base-a' }))
const read_tree_mock = vi.hoisted(() => vi.fn(async () => READ_TREE))

vi.mock('#scripts/gate/check-reuse', () => ({
	check_reuse: { DEFAULT_RECORDS: (): string => '', record_green_checks: record_mock },
}))
vi.mock('#scripts/gate/gate-tree', () => ({
	gate_tree: { read_gate_tree: read_tree_mock },
}))

const { run_ship_pre_detach } = await import('./run-ship-pre-detach')

// joshuafolkken/kit#3222: the type check and the guard tests a detached ship runs before the hand-off.

const OK = 0
const FAILED = 1
const TYPE_CHECK = 'josh check'
const EXPORTS = 'josh exports:unused'
const STATIC = [TYPE_CHECK, EXPORTS, 'josh cspell:dot']
const GUARD_TARGET = 'scripts/document'
const GUARD_TEST_COMMAND = 'josh test:unit --passWithNoTests'
const GUARD_TESTS = `${GUARD_TEST_COMMAND} ${GUARD_TARGET}`
const TYPE_ERROR = 'scripts/a.test.ts(3,7): error TS4111: Property comes from an index signature'
const ACCEPT_HINT = 'pnpm josh metrics --accept --reason "<why>"'
const GUARD_FAILURE = 'FAIL scripts/document/document-byte-budget.test.ts > stays under budget'

interface Answer {
	exit_code: number | undefined
	output: string
}

const tree = { directory: '' }

function heading(command: string, exit_code = FAILED): string {
	return `✗ ${command} — exit code ${String(exit_code)}`
}

function commands(): ReadonlyArray<string> {
	return run_mock.mock.calls.map((call) => (call[0] as ReadonlyArray<string>).join(' '))
}

function answer(by_command: ReadonlyMap<string, Answer>): void {
	run_mock.mockImplementation(async (list: ReadonlyArray<string>) => {
		return by_command.get(list.join(' ')) ?? { exit_code: OK, output: '' }
	})
}

function create(target: string): void {
	const full = path.join(tree.directory, target)

	if (!target.endsWith('.ts')) {
		mkdirSync(full, { recursive: true })

		return
	}

	mkdirSync(path.dirname(full), { recursive: true })
	writeFileSync(full, '')
}

beforeEach(() => {
	tree.directory = mkdtempSync(path.join(tmpdir(), 'pre-detach-'))
	run_mock.mockReset()
	record_mock.mockClear()
	is_kit_mock.mockReturnValue(false)
	answer(new Map())
})

afterEach(() => {
	rmSync(tree.directory, { recursive: true, force: true })
})

describe('run_ship_pre_detach.checks — what runs', () => {
	it('runs the static checks alone where no guard test target exists', async () => {
		expect(await run_ship_pre_detach.checks(tree.directory)).toStrictEqual({
			code: OK,
			out: run_ship_pre_detach.PASSED,
		})
		expect(commands()).toStrictEqual(STATIC)
	})

	it('runs the guard tests over every present target beside the static checks', async () => {
		for (const target of run_ship_pre_detach.GUARD_TEST_TARGETS) create(target)

		await run_ship_pre_detach.checks(tree.directory)

		expect(commands()).toStrictEqual([
			...STATIC,
			`${GUARD_TEST_COMMAND} ${run_ship_pre_detach.GUARD_TEST_TARGETS.join(' ')}`,
		])
	})

	it('names only the targets that exist', async () => {
		create(GUARD_TARGET)

		await run_ship_pre_detach.checks(tree.directory)

		expect(commands()).toStrictEqual([...STATIC, GUARD_TESTS])
	})

	it('runs each check in the given directory', async () => {
		await run_ship_pre_detach.checks(tree.directory)

		expect(run_mock).toHaveBeenCalledWith(['josh', 'check'], { cwd: tree.directory })
	})
})

describe('run_ship_pre_detach.checks — what fails', () => {
	it('fails with the type error output', async () => {
		answer(new Map([[TYPE_CHECK, { exit_code: FAILED, output: `${TYPE_ERROR}\n` }]]))

		expect(await run_ship_pre_detach.checks(tree.directory)).toStrictEqual({
			code: FAILED,
			out: `${heading(TYPE_CHECK)}\n${TYPE_ERROR}`,
		})
	})

	it('fails with the guard test output', async () => {
		create(GUARD_TARGET)
		answer(new Map([[GUARD_TESTS, { exit_code: FAILED, output: GUARD_FAILURE }]]))

		expect(await run_ship_pre_detach.checks(tree.directory)).toStrictEqual({
			code: FAILED,
			out: `${heading(GUARD_TESTS)}\n${GUARD_FAILURE}`,
		})
	})

	it('reports every failure at once', async () => {
		create(GUARD_TARGET)
		answer(
			new Map([
				[TYPE_CHECK, { exit_code: FAILED, output: TYPE_ERROR }],
				[GUARD_TESTS, { exit_code: FAILED, output: GUARD_FAILURE }],
			]),
		)

		expect(await run_ship_pre_detach.checks(tree.directory)).toStrictEqual({
			code: FAILED,
			out: [
				`${heading(TYPE_CHECK)}\n${TYPE_ERROR}`,
				`${heading(GUARD_TESTS)}\n${GUARD_FAILURE}`,
			].join('\n\n'),
		})
	})
})

// joshuafolkken/kit#4594: a failure that printed nothing still names its check and how it ended.
describe('run_ship_pre_detach.checks — the failed check is named', () => {
	const NO_OUTPUT_EXIT = 2

	it('names the check and its exit code when it failed with no output', async () => {
		answer(new Map([[EXPORTS, { exit_code: NO_OUTPUT_EXIT, output: '' }]]))

		expect(await run_ship_pre_detach.checks(tree.directory)).toStrictEqual({
			code: FAILED,
			out: heading(EXPORTS, NO_OUTPUT_EXIT),
		})
	})

	it('names the check as ended without an exit code when it timed out', async () => {
		answer(new Map([[TYPE_CHECK, { exit_code: undefined, output: '' }]]))

		expect(await run_ship_pre_detach.checks(tree.directory)).toStrictEqual({
			code: FAILED,
			out: `✗ ${TYPE_CHECK} — no exit code (timed out or ended by a signal)`,
		})
	})
})

// joshuafolkken/kit#3924: the checks behind nine of ten ship gate stops answer before the hand-off.
describe('run_ship_pre_detach.checks — what the ship gate stopped on', () => {
	const unread = `josh exports: 1 namespace member(s) nothing reads\n  scripts/lane/lane-stage-stats.ts:149  lane_stage_stats.STAGES`

	it('runs the unused-export and spelling checks the related pair never selects', () => {
		expect(run_ship_pre_detach.STATIC_CHECKS.map(({ list }) => list.join(' '))).toStrictEqual(
			STATIC.slice(1),
		)
	})

	it('fails before the detach with the unread export the ship gate stopped on', async () => {
		answer(new Map([[EXPORTS, { exit_code: FAILED, output: unread }]]))

		expect(await run_ship_pre_detach.checks(tree.directory)).toStrictEqual({
			code: FAILED,
			out: `${heading(EXPORTS)}\n${unread}`,
		})
	})

	it('runs the repository-wide guard tests no changed file imports', () => {
		expect(run_ship_pre_detach.GUARD_TEST_TARGETS).toStrictEqual(
			expect.arrayContaining([
				'scripts/issue/session-cite-scan.test.ts',
				'tools/test/untested-sources.test.ts',
				'tools/test/pure-files.test.ts',
			]),
		)
	})
})

// joshuafolkken/kit#3568: the metrics totals, in kit only, so a grown total stops the session that grew it.
describe('run_ship_pre_detach.checks — the metrics totals', () => {
	const metrics = run_ship_pre_detach.METRICS_TOTALS_COMMAND.join(' ')
	const grown = `josh metrics: 1 total(s) grew past the baseline\n${ACCEPT_HINT}`

	it('runs no metrics outside kit', async () => {
		await run_ship_pre_detach.checks(tree.directory)

		expect(commands()).toStrictEqual(STATIC)
	})

	it('passes in kit when no total grew', async () => {
		is_kit_mock.mockReturnValue(true)

		expect(await run_ship_pre_detach.checks(tree.directory)).toStrictEqual({
			code: OK,
			out: run_ship_pre_detach.PASSED,
		})
		expect(commands()).toStrictEqual([metrics, ...STATIC])
	})

	// joshuafolkken/kit#4716: the totals may re-record the approval file, so they finish before the tree
	// the gate records are written for is read.
	it('runs the totals alone, before the tree is read and the other checks start', async () => {
		is_kit_mock.mockReturnValue(true)
		read_tree_mock.mockClear()

		await run_ship_pre_detach.checks(tree.directory)

		const [metrics_order = 0, ...others] = run_mock.mock.invocationCallOrder
		const [tree_order = 0] = read_tree_mock.mock.invocationCallOrder

		expect(commands()[0]).toBe(metrics)
		expect(metrics_order).toBeLessThan(tree_order)
		expect(others.every((order) => order > tree_order)).toBe(true)
	})

	it('fails in kit with the accept hint when a total grew', async () => {
		is_kit_mock.mockReturnValue(true)
		answer(new Map([[metrics, { exit_code: FAILED, output: grown }]]))

		expect(await run_ship_pre_detach.checks(tree.directory)).toStrictEqual({
			code: FAILED,
			out: `${heading(metrics)}\n${grown}`,
		})
	})
})

interface Handed {
	label: string
	command: string
	exit_code: number
}

function handed(): ReadonlyArray<Handed> {
	const call = record_mock.mock.calls.at(-1) as unknown as [ReadonlyArray<Handed>] | undefined

	return call?.[0] ?? []
}

// joshuafolkken/kit#4505: the gate's own checks hand their results to the gate's per-check record.
describe('run_ship_pre_detach.checks — what the gate reuses', () => {
	it('hands the type check and the unused-export check over under their gate labels', async () => {
		await run_ship_pre_detach.checks(tree.directory)

		expect(handed().map(({ label, command }) => [label, command])).toStrictEqual([
			['check', TYPE_CHECK],
			['exports', EXPORTS],
		])
		expect(record_mock).toHaveBeenCalledWith(expect.anything(), READ_TREE, expect.anything())
	})

	it('hands over no spelling, guard test or metrics result', async () => {
		create(GUARD_TARGET)
		is_kit_mock.mockReturnValue(true)

		await run_ship_pre_detach.checks(tree.directory)

		expect(handed().map(({ label }) => label)).toStrictEqual(['check', 'exports'])
	})

	it('hands a failed check over as failed, for the gate to leave unrecorded', async () => {
		answer(new Map([[EXPORTS, { exit_code: FAILED, output: TYPE_ERROR }]]))

		await run_ship_pre_detach.checks(tree.directory)

		expect(handed().map(({ exit_code }) => exit_code)).toStrictEqual([OK, FAILED])
	})
})
