import { mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// joshuafolkken/kit#6544: an implementation past its stage budget shows the split notice with a diff
// under the size bar — once per Issue on its own marker, with the `issue:spill` way out `run:cut`'s
// `budget-over` prints.

vi.mock('#scripts/git/git-command', () => ({
	git_command: {
		branch: vi.fn(),
		diff_numstat_since: vi.fn(),
		git_directories: vi.fn(),
		untracked_names: vi.fn(),
	},
}))

vi.mock('#scripts/git/change-base', () => ({
	change_base: { resolved_through_merge: vi.fn().mockResolvedValue('base') },
}))
vi.mock('#scripts/lane/lane-implement-rate-read', () => ({
	lane_implement_rate_read: {
		measurements: vi.fn().mockResolvedValue({ implement_rate: undefined, growth: {} }),
	},
}))

vi.mock('./split-relocations', () => ({
	split_relocations: {
		without_relocations: vi.fn(
			async (_root: string, _base: string, numstat: string, added: Array<string>) => ({
				numstat,
				added,
			}),
		),
	},
}))

const { change_base } = await import('#scripts/git/change-base')
const { git_command } = await import('#scripts/git/git-command')
const { issue_declared_size } = await import('#scripts/issue/issue-declared-size')
const { lane_ledger_write } = await import('#scripts/lane/lane-ledger-write')
const { run_cut_budget_over } = await import('#scripts/run/cut/run-cut-budget-over')
const { split_assess } = await import('./split-assess')
const { split_early_notice } = await import('./split-early-notice')

const implement_over = vi.spyOn(run_cut_budget_over, 'implement_over')

const ISSUE_NUMBER = 6544
const OVER_MINUTES = 3
const LINES_PER_FILE = 25
const UNDER_BAR_NUMSTAT = `${String(LINES_PER_FILE)}\t0\tscripts/a.ts`
const OVER_BAR_NUMSTAT = Array.from(
	{ length: split_assess.FILE_GUIDE + 1 },
	(_unused, index) => `${String(LINES_PER_FILE)}\t0\tscripts/thing-${String(index)}.ts`,
).join('\n')

const GIT_DIRECTORY = mkdtempSync(path.join(tmpdir(), 'split-early-notice-budget-'))

beforeEach(() => {
	vi.spyOn(console, 'warn').mockImplementation(() => undefined)
	vi.spyOn(lane_ledger_write, 'record_split_notice').mockResolvedValue()
	vi.spyOn(issue_declared_size, 'read').mockResolvedValue(undefined)
	vi.mocked(git_command.branch).mockResolvedValue(`${String(ISSUE_NUMBER)}-lane`)
	vi.mocked(git_command.git_directories).mockResolvedValue([GIT_DIRECTORY])
	vi.mocked(git_command.untracked_names).mockResolvedValue('')
	vi.mocked(git_command.diff_numstat_since).mockResolvedValue(UNDER_BAR_NUMSTAT)
	vi.mocked(change_base.resolved_through_merge).mockResolvedValue('base')
	implement_over.mockResolvedValue(undefined)
})

afterEach(async () => {
	const prefixes = [
		split_early_notice.MARKER_PREFIX,
		split_early_notice.BUDGET_PREFIX,
		split_early_notice.DECLARED_PREFIX,
	]

	await Promise.all(
		prefixes.map(async (prefix) =>
			rm(path.join(GIT_DIRECTORY, `${prefix}${String(ISSUE_NUMBER)}`), { force: true }),
		),
	)
})

afterAll(async () => {
	await rm(GIT_DIRECTORY, { recursive: true, force: true })
})

describe('split_early_notice.surface past the implement budget', () => {
	it('stays silent within the budget', async () => {
		await split_early_notice.surface()

		expect(implement_over).toHaveBeenCalledWith(ISSUE_NUMBER)
		expect(console.warn).not.toHaveBeenCalled()
	})

	it('shows the notice with the budget-over way out once the budget is over', async () => {
		implement_over.mockResolvedValue(OVER_MINUTES)
		await split_early_notice.surface()

		expect(console.warn).toHaveBeenCalledExactlyOnceWith(
			`\nsplit notice: the implementation is ${String(OVER_MINUTES)} min over its stage budget — with an acceptance criterion this tree meets: ${run_cut_budget_over.spill_steps(String(ISSUE_NUMBER))} With none met yet, go on.`,
		)
	})

	it('records the first showing under the budget reason', async () => {
		implement_over.mockResolvedValue(OVER_MINUTES)
		await split_early_notice.surface()

		expect(lane_ledger_write.record_split_notice).toHaveBeenCalledExactlyOnceWith({
			issue: ISSUE_NUMBER,
			files: 1,
			lines: LINES_PER_FILE,
			reason: 'budget',
		})
	})

	it('shows it once per issue', async () => {
		implement_over.mockResolvedValue(OVER_MINUTES)
		await split_early_notice.surface()
		await split_early_notice.surface()

		expect(console.warn).toHaveBeenCalledOnce()
	})
})

describe('split_early_notice.surface past the implement budget on an unmeasurable diff', () => {
	it('still shows it, recorded as an empty diff, when the change base cannot be resolved', async () => {
		implement_over.mockResolvedValue(OVER_MINUTES)
		vi.mocked(change_base.resolved_through_merge).mockRejectedValue(new Error('no base'))
		await split_early_notice.surface()

		expect(console.warn).toHaveBeenCalledOnce()
		expect(lane_ledger_write.record_split_notice).toHaveBeenCalledExactlyOnceWith({
			issue: ISSUE_NUMBER,
			files: 0,
			lines: 0,
			reason: 'budget',
		})
	})
})

describe('split_early_notice.surface beside the size notice', () => {
	it('leaves the size notice as it was within the budget', async () => {
		vi.mocked(git_command.diff_numstat_since).mockResolvedValue(OVER_BAR_NUMSTAT)
		await split_early_notice.surface()

		expect(console.warn).toHaveBeenCalledExactlyOnceWith(
			expect.stringContaining(split_assess.NOTICE_SECTION),
		)
		expect(lane_ledger_write.record_split_notice).toHaveBeenCalledExactlyOnceWith(
			expect.not.objectContaining({ reason: expect.anything() }),
		)
	})

	it('still shows the size notice after the budget notice', async () => {
		implement_over.mockResolvedValue(OVER_MINUTES)
		await split_early_notice.surface()
		vi.mocked(git_command.diff_numstat_since).mockResolvedValue(OVER_BAR_NUMSTAT)
		await split_early_notice.surface()

		expect(console.warn).toHaveBeenLastCalledWith(
			expect.stringContaining(split_assess.NOTICE_SECTION),
		)
		expect(console.warn).toHaveBeenCalledTimes(2)
	})
})
