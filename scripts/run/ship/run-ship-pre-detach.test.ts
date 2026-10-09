import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const run_mock = vi.hoisted(() => vi.fn())

vi.mock('#scripts/lib/buffered-process', () => ({
	buffered_process: {
		run_buffered_process: run_mock,
		is_process_failed: (result: { exit_code: number }): boolean => result.exit_code !== 0,
	},
}))
vi.mock('#scripts/gate/type-check-step', () => ({
	type_check_step: { resolve_type_check_args: vi.fn(async () => ['josh', 'check']) },
}))

const is_kit_mock = vi.hoisted(() => vi.fn(() => false))

vi.mock('#scripts/gate/project-checks', () => ({
	project_checks: { is_kit_repository: is_kit_mock },
}))

const { run_ship_pre_detach } = await import('./run-ship-pre-detach')

// joshuafolkken/kit#3222: the type check and the document tests a detached ship runs before the hand-off.

const OK = 0
const FAILED = 1
const TYPE_CHECK = 'josh check'
const DOCUMENT_TARGET = 'scripts/document'
const DOCUMENT_TEST_COMMAND = 'josh test:unit --passWithNoTests'
const DOCUMENT_TESTS = `${DOCUMENT_TEST_COMMAND} ${DOCUMENT_TARGET}`
const TYPE_ERROR = 'scripts/a.test.ts(3,7): error TS4111: Property comes from an index signature'
const ACCEPT_HINT = 'pnpm josh metrics --accept --reason "<why>"'
const DOCUMENT_FAILURE = 'FAIL scripts/document/document-byte-budget.test.ts > stays under budget'

interface Answer {
	exit_code: number
	output: string
}

const tree = { directory: '' }

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
	is_kit_mock.mockReturnValue(false)
	answer(new Map())
})

afterEach(() => {
	rmSync(tree.directory, { recursive: true, force: true })
})

describe('run_ship_pre_detach.checks — what runs', () => {
	it('runs the type check alone where no document test target exists', async () => {
		expect(await run_ship_pre_detach.checks(tree.directory)).toStrictEqual({
			code: OK,
			out: run_ship_pre_detach.PASSED,
		})
		expect(commands()).toStrictEqual([TYPE_CHECK])
	})

	it('runs the document tests over every present target beside the type check', async () => {
		for (const target of run_ship_pre_detach.DOCUMENT_TEST_TARGETS) create(target)

		await run_ship_pre_detach.checks(tree.directory)

		expect(commands()).toStrictEqual([
			TYPE_CHECK,
			`${DOCUMENT_TEST_COMMAND} ${run_ship_pre_detach.DOCUMENT_TEST_TARGETS.join(' ')}`,
		])
	})

	it('names only the targets that exist', async () => {
		create(DOCUMENT_TARGET)

		await run_ship_pre_detach.checks(tree.directory)

		expect(commands()).toStrictEqual([TYPE_CHECK, DOCUMENT_TESTS])
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
			out: TYPE_ERROR,
		})
	})

	it('fails with the document test output', async () => {
		create(DOCUMENT_TARGET)
		answer(new Map([[DOCUMENT_TESTS, { exit_code: FAILED, output: DOCUMENT_FAILURE }]]))

		expect(await run_ship_pre_detach.checks(tree.directory)).toStrictEqual({
			code: FAILED,
			out: DOCUMENT_FAILURE,
		})
	})

	it('reports every failure at once', async () => {
		create(DOCUMENT_TARGET)
		answer(
			new Map([
				[TYPE_CHECK, { exit_code: FAILED, output: TYPE_ERROR }],
				[DOCUMENT_TESTS, { exit_code: FAILED, output: DOCUMENT_FAILURE }],
			]),
		)

		expect(await run_ship_pre_detach.checks(tree.directory)).toStrictEqual({
			code: FAILED,
			out: `${TYPE_ERROR}\n\n${DOCUMENT_FAILURE}`,
		})
	})
})

// joshuafolkken/kit#3568: the metrics totals, in kit only, so a grown total stops the session that grew it.
describe('run_ship_pre_detach.checks — the metrics totals', () => {
	const metrics = run_ship_pre_detach.METRICS_TOTALS_COMMAND.join(' ')
	const grown = `josh metrics: 1 total(s) grew past the baseline\n${ACCEPT_HINT}`

	it('runs no metrics outside kit', async () => {
		await run_ship_pre_detach.checks(tree.directory)

		expect(commands()).toStrictEqual([TYPE_CHECK])
	})

	it('passes in kit when no total grew', async () => {
		is_kit_mock.mockReturnValue(true)

		expect(await run_ship_pre_detach.checks(tree.directory)).toStrictEqual({
			code: OK,
			out: run_ship_pre_detach.PASSED,
		})
		expect(commands()).toStrictEqual([TYPE_CHECK, metrics])
	})

	it('fails in kit with the accept hint when a total grew', async () => {
		is_kit_mock.mockReturnValue(true)
		answer(new Map([[metrics, { exit_code: FAILED, output: grown }]]))

		expect(await run_ship_pre_detach.checks(tree.directory)).toStrictEqual({
			code: FAILED,
			out: grown,
		})
	})
})
