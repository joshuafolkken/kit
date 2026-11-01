import { review_record_pinned } from '#scripts/review/review-record-pinned'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { check_related, type CheckResult } from './check-related'
import { check_related_reuse } from './check-related-reuse'
import { tree_verdict } from './tree-verdict'

vi.mock('./check-related-reuse', () => ({
	check_related_reuse: {
		read_tree: vi.fn(async () => ({ files: {}, base: undefined })),
		record: vi.fn(async () => undefined),
		reusable: vi.fn(async () => new Set()),
	},
}))

const TOUCHED_TEST = 'test:related --touched'

async function passing_check(command: string): Promise<CheckResult> {
	return { command, exit_code: 0, output: '' }
}

async function red_test(command: string): Promise<CheckResult> {
	return { command, exit_code: command === TOUCHED_TEST ? 1 : 0, output: '' }
}

beforeEach(() => {
	vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
	vi.spyOn(review_record_pinned, 'restart_in_lane').mockResolvedValue(false)
	vi.spyOn(tree_verdict, 'record').mockResolvedValue(undefined)
})

afterEach(() => {
	vi.restoreAllMocks()
})

// joshuafolkken/kit#5784: a mid-run check:related had only the full reach.
describe('check_related.run_touched', () => {
	it('runs the unit stage as test:related --touched beside the other three checks', async () => {
		const execute = vi.fn(passing_check)

		await expect(check_related.run_touched(execute)).resolves.toBe(0)
		expect(new Set(execute.mock.calls.map(([command]) => command))).toStrictEqual(
			new Set(['lint:related', TOUCHED_TEST, 'check', 'cspell:dot']),
		)
	})

	it('keeps no green record, no kept verdict and starts no test:pinned', async () => {
		await check_related.run_touched(passing_check)

		expect(check_related_reuse.reusable).not.toHaveBeenCalled()
		expect(check_related_reuse.record).not.toHaveBeenCalled()
		expect(tree_verdict.record).not.toHaveBeenCalled()
		expect(review_record_pinned.restart_in_lane).not.toHaveBeenCalled()
	})

	it('fails when the touched test run fails', async () => {
		await expect(check_related.run_touched(red_test)).resolves.toBe(1)
	})
})

describe('check_related.execute_check with a flag', () => {
	it('passes the flag to josh as its own argument', async () => {
		const run = vi.fn(async () => ({ all: '', exitCode: 0 }))

		await check_related.execute_check(TOUCHED_TEST, run)

		expect(run).toHaveBeenCalledWith('pnpm', ['josh', 'test:related', '--touched'], {
			all: true,
			reject: false,
		})
		expect(check_related.TOUCHED_CHECKS).toContain(TOUCHED_TEST)
	})
})
