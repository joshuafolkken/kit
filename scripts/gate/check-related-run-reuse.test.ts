import { review_record_pinned } from '#scripts/review/review-record-pinned'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { check_related, type CheckResult } from './check-related'
import { check_related_pinned } from './check-related-pinned'
import { check_related_reuse } from './check-related-reuse'
import type { GateTree } from './gate-tree'

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
})
