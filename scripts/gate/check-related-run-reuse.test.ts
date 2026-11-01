import { tmpdir } from 'node:os'
import path from 'node:path'
import { review_record_pinned } from '#scripts/review/review-record-pinned'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { check_related, type CheckResult } from './check-related'
import { check_related_pinned } from './check-related-pinned'
import { check_related_reuse } from './check-related-reuse'
import type { GateTree } from './gate-tree'
import { metrics_totals } from './metrics-totals'
import { tree_verdict } from './tree-verdict'

// The live branch's lane:plan record never reaches these runs.
vi.mock('./check-related-unplanned', () => ({
	check_related_unplanned: { notice: async () => undefined },
}))

// joshuafolkken/kit#5156: a re-run after fixing one check ran the three that had passed over again.

const ROOT = '/repo'
const SOURCE = 'scripts/a.ts'
const TREE: GateTree = { files: { [SOURCE]: 'digest-a' }, base: 'base-a' }
const { CHECKS, REUSED } = check_related
const [LINT = '', TEST = '', TYPE_CHECK = '', CSPELL = ''] = CHECKS
const FAILED_EXIT_CODE = 1

function reuse(commands: ReadonlyArray<string>): void {
	vi.spyOn(check_related_reuse, 'reusable').mockResolvedValue(new Set(commands))
}

async function run(exit_code = 0): Promise<{ code: number; ran: Array<string>; text: string }> {
	const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
	const ran: Array<string> = []
	const code = await check_related.run_all(ROOT, async (command): Promise<CheckResult> => {
		ran.push(command)

		return { command, exit_code, output: '' }
	})

	return { code, ran, text: write.mock.calls.map(([chunk]) => String(chunk)).join('') }
}

function stub_run(): void {
	vi.spyOn(review_record_pinned, 'restart_in_lane').mockResolvedValue(false)
	vi.spyOn(check_related_pinned, 'notice').mockResolvedValue(undefined)
	vi.spyOn(check_related_reuse, 'read_tree').mockResolvedValue(TREE)
	vi.spyOn(check_related_reuse, 'record').mockResolvedValue()
	vi.spyOn(tree_verdict, 'read').mockReturnValue(undefined)
	vi.spyOn(tree_verdict, 'record').mockResolvedValue()
}

function keep(exit_code: number): void {
	const tail = `\nkept tail ${String(exit_code)}\n`

	vi.spyOn(tree_verdict, 'read').mockReturnValue({
		tree: 'a'.repeat(64),
		exit_code,
		tail,
		at: 'now',
	})
}

describe('check_related.run_all reuses a check whose green record still holds', () => {
	beforeEach(stub_run)
	afterEach(() => {
		vi.restoreAllMocks()
	})

	it('runs nothing and passes with every check reused when all four records hold', async () => {
		reuse(CHECKS)

		const { code, ran, text } = await run()

		expect(code).toBe(0)
		expect(ran).toStrictEqual([])
		for (const command of CHECKS) expect(text).toContain(`=== ${command}: ${REUSED} ===`)
	})

	it('runs only the check whose inputs moved', async () => {
		reuse([LINT, TYPE_CHECK, CSPELL])

		const { ran, text } = await run()

		expect(ran).toStrictEqual([TEST])
		expect(text).toContain(`=== ${TEST}: passed ===`)
		expect(text.trimEnd()).toMatch(
			/check:related passed \(reused: lint:related, check, cspell:dot\)$/u,
		)
	})

	it('runs a check that failed last time, since it left no record', async () => {
		reuse([LINT, TEST, CSPELL])

		const { ran } = await run()

		expect(ran).toStrictEqual([TYPE_CHECK])
	})
})

describe('check_related.run_all reads and records the reuse on one tree', () => {
	beforeEach(stub_run)
	afterEach(() => {
		vi.restoreAllMocks()
	})

	it('asks the reuse with the tree read before the checks, and records what ran against it', async () => {
		reuse([LINT])

		await run()

		expect(check_related_reuse.reusable).toHaveBeenCalledExactlyOnceWith(CHECKS, TREE)
		expect(check_related_reuse.record).toHaveBeenCalledExactlyOnceWith(
			[TEST, TYPE_CHECK, CSPELL].map((command) => ({ command, exit_code: 0, output: '' })),
			TREE,
		)
	})

	it('fails on a check that ran red beside the reused ones', async () => {
		reuse([LINT, TEST, CSPELL])

		const { code } = await run(FAILED_EXIT_CODE)

		expect(code).toBe(FAILED_EXIT_CODE)
	})

	it('keeps the verdict it printed against the tree it read', async () => {
		reuse([])

		const { code } = await run()

		expect(tree_verdict.record).toHaveBeenCalledExactlyOnceWith(
			expect.objectContaining({ before: TREE, exit_code: code }),
			check_related_reuse.read_tree,
			expect.any(String),
		)
	})
})

// joshuafolkken/kit#5657: a re-run on a tree this command already answered for ran all four again.
describe('check_related.run_all on a tree it already answered for', () => {
	beforeEach(stub_run)
	afterEach(() => {
		vi.restoreAllMocks()
	})

	it('runs no check and prints the kept green verdict', async () => {
		keep(0)

		const { code, ran, text } = await run()

		expect(code).toBe(0)
		expect(ran).toStrictEqual([])
		expect(text).toMatch(/^reused: tree a{12} green at now\n\nkept tail 0\n$/u)
		expect(review_record_pinned.restart_in_lane).not.toHaveBeenCalled()
	})

	it('answers a kept red verdict red', async () => {
		keep(FAILED_EXIT_CODE)

		const { code, ran } = await run()

		expect(code).toBe(FAILED_EXIT_CODE)
		expect(ran).toStrictEqual([])
	})

	it('asks the test:pinned notice again rather than replaying it', async () => {
		keep(0)
		vi.mocked(check_related_pinned.notice).mockResolvedValue('pinned answer')

		const { text } = await run()

		expect(check_related_pinned.notice).toHaveBeenCalledExactlyOnceWith(ROOT, false)
		expect(text).toMatch(/^reused: tree a{12} green at now\n\npinned answer\n\nkept tail 0\n$/u)
	})
})

describe('check_related.report_results keeps what a replay on the same tree prints', () => {
	afterEach(() => {
		vi.restoreAllMocks()
	})

	it('keeps the metrics and unplanned notices with the tail, the pinned one printed above them', () => {
		const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
		const output = `${metrics_totals.NOTICE_HEADING} grew`
		const results = [{ command: LINT, exit_code: 0, output }]
		const pinned_notice = 'pinned notice'
		const unplanned_notice = 'unplanned notice'
		const kept = check_related.report_results(results, {
			pinned_notice,
			unplanned_notice,
			log_target: path.join(tmpdir(), 'check-related-run-reuse.log'),
		})
		const text = write.mock.calls.map(([chunk]) => String(chunk)).join('')

		expect(
			[output, unplanned_notice, pinned_notice].map((part) => kept.includes(part)),
		).toStrictEqual([true, true, false])
		expect(text.endsWith(`\n${pinned_notice}\n${kept}`)).toBe(true)
	})
})
