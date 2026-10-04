import { beforeEach, describe, expect, it, vi } from 'vitest'

const josh_run_mock = vi.hoisted(() => vi.fn())
const is_child_of_mock = vi.hoisted(() => vi.fn())

vi.mock('#scripts/josh/josh-run', () => ({ josh_command: { josh_run: josh_run_mock } }))
vi.mock('#scripts/lane/lane-child-marker', () => ({
	lane_child_marker: { is_child_of: is_child_of_mock },
}))

const { run_tail_cli } = await import('./run-tail-cli')

const OK = 0
const FAILED = 1
const ISSUE = '2372'

const CITE_COMMAND = 'issue:cite'
const SYNC = ['main:sync']
const FLUSH = ['observations:flush']
const CITE = [CITE_COMMAND, ISSUE]
const CITE_NONE = [CITE_COMMAND]
const SCOPE = ['release:scope']

const info_lines: Array<string> = []

function argv_calls(): ReadonlyArray<ReadonlyArray<string>> {
	return josh_run_mock.mock.calls.map((call) => call[0] as ReadonlyArray<string>)
}

beforeEach(() => {
	josh_run_mock.mockReset().mockResolvedValue({ code: OK, out: '' })
	is_child_of_mock.mockReset().mockReturnValue(false)
	info_lines.length = 0
	vi.spyOn(console, 'info').mockImplementation((line: string) => {
		info_lines.push(line)
	})
	vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

describe('run_tail_cli.run — folds the three post-merge steps into one call', () => {
	it('runs sync, flush, cite and scope in order, forwarding the issue numbers to cite alone', async () => {
		const code = await run_tail_cli.run([ISSUE])

		expect(code).toBe(OK)
		expect(argv_calls()).toStrictEqual([SYNC, FLUSH, CITE, SCOPE])
	})

	it('closes a run given no issue numbers, with an empty cite target', async () => {
		await run_tail_cli.run([])

		expect(argv_calls()).toStrictEqual([SYNC, FLUSH, CITE_NONE, SCOPE])
	})

	it('joins each step under its header in one composite report', async () => {
		josh_run_mock
			.mockResolvedValueOnce({ code: OK, out: 'synced' })
			.mockResolvedValueOnce({ code: OK, out: 'flushed' })
			.mockResolvedValueOnce({ code: OK, out: `cited ${ISSUE}` })
			.mockResolvedValueOnce({ code: OK, out: 'skip' })

		await run_tail_cli.run([ISSUE])

		expect(info_lines[0]).toBe(
			`=== sync ===\nsynced\n\n=== observations ===\nflushed\n\n=== citations ===\ncited ${ISSUE}\n\n=== release ===\nskip`,
		)
	})
})

// joshuafolkken/kit#2492: the per-issue ledger PR and its CI wait move to the backlogrun's end.
describe('run_tail_cli.run — a dispatched lane child leaves the ledger to the parent', () => {
	it('runs cite and scope alone, never the flush', async () => {
		is_child_of_mock.mockReturnValue(true)

		const code = await run_tail_cli.run([ISSUE])

		expect(code).toBe(OK)
		expect(argv_calls()).toStrictEqual([CITE, SCOPE])
	})

	it('reports only the citations and release sections', async () => {
		is_child_of_mock.mockReturnValue(true)
		josh_run_mock
			.mockResolvedValueOnce({ code: OK, out: `cited ${ISSUE}` })
			.mockResolvedValueOnce({ code: OK, out: 'skip' })

		await run_tail_cli.run([ISSUE])

		expect(info_lines[0]).toBe(`=== citations ===\ncited ${ISSUE}\n\n=== release ===\nskip`)
	})
})

// joshuafolkken/kit#2979: `josh ship` reaches the report still on the feature branch it merged, and the
// flush refuses anywhere but the default branch, so a merged run was reported as failed.
describe('run_tail_cli.run — returns to the default branch before the flush', () => {
	it('runs main:sync before observations:flush, so the flush never starts on the merged branch', async () => {
		await run_tail_cli.run([ISSUE])

		const commands = argv_calls().map((call) => call[0])

		expect(commands.indexOf(SYNC[0])).toBeLessThan(commands.indexOf(FLUSH[0]))
	})

	it('leaves a lane child on its own branch, since main:sync refuses inside a lane', async () => {
		is_child_of_mock.mockReturnValue(true)

		await run_tail_cli.run([ISSUE])

		expect(argv_calls()).not.toContainEqual(SYNC)
	})

	it('exits non-zero when the checkout could not return to the default branch', async () => {
		josh_run_mock.mockResolvedValueOnce({ code: FAILED, out: '' })

		expect(await run_tail_cli.run([ISSUE])).toBe(FAILED)
	})
})

describe('run_tail_cli.run — a failed step fails the whole close', () => {
	it('exits non-zero when the ledger commit failed, even though the later steps succeeded', async () => {
		josh_run_mock
			.mockResolvedValueOnce({ code: OK, out: '' })
			.mockResolvedValueOnce({ code: FAILED, out: '' })
			.mockResolvedValueOnce({ code: OK, out: '' })
			.mockResolvedValueOnce({ code: OK, out: '' })

		expect(await run_tail_cli.run([ISSUE])).toBe(FAILED)
	})

	// joshuafolkken/kit#2462: a detached run's log keeps only the report, so the reason has to be in it.
	it("puts a failed step's stderr in its section body, and a passing step's stays out", async () => {
		const reason = 'main is behind origin/main'

		josh_run_mock
			.mockResolvedValueOnce({ code: OK, out: 'synced' })
			.mockResolvedValueOnce({ code: FAILED, out: '[ELIFECYCLE] failed', err: reason })
			.mockResolvedValueOnce({ code: OK, out: 'cited', err: 'a note' })
			.mockResolvedValueOnce({ code: OK, out: 'skip' })

		await run_tail_cli.run([ISSUE])

		expect(info_lines[0]).toBe(
			`=== sync ===\nsynced\n\n=== observations ===\n[ELIFECYCLE] failed\n${reason}\n\n=== citations ===\ncited\n\n=== release ===\nskip`,
		)
	})

	it('refuses a non-number argument rather than forwarding it to the wrong step', async () => {
		expect(await run_tail_cli.run(['--force'])).toBe(FAILED)
		expect(josh_run_mock).not.toHaveBeenCalled()
	})
})
