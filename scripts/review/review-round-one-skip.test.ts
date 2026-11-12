import { git_command } from '#scripts/git/git-command'
import { issue_declared_size } from '#scripts/issue/issue-declared-size'
import { lane_ledger_write } from '#scripts/lane/lane-ledger-write'
import { observation_ledger_home } from '#scripts/observations/observation-ledger-home'
import { split_measure } from '#scripts/split/split-measure'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { review_comment_round } from './review-comment-round'
import { review_finding_ledger } from './review-finding-ledger'
import { review_gate_mode } from './review-gate-mode'
import { review_round_one_skip } from './review-round-one-skip'

const ISSUE = 6243
const FILES = 5
const LINES = 150
const DATE = '2026-11-05'

beforeEach(() => {
	vi.spyOn(review_gate_mode, 'read').mockReturnValue('local')
	vi.spyOn(git_command, 'branch').mockResolvedValue(`${String(ISSUE)}-lane`)
	vi.spyOn(issue_declared_size, 'read').mockResolvedValue({ files: FILES, lines: LINES })
	vi.spyOn(split_measure, 'read_branch').mockResolvedValue({
		files: FILES,
		lines: LINES,
		verdict: 'single',
	})
	vi.spyOn(observation_ledger_home, 'read').mockResolvedValue('')
	vi.spyOn(review_comment_round, 'issue_lines').mockResolvedValue([])
})

afterEach(() => {
	vi.restoreAllMocks()
})

describe('review_round_one_skip.eligible_issue', () => {
	it('accepts the exact declared boundary and a smaller change with no history', async () => {
		await expect(review_round_one_skip.eligible_issue()).resolves.toBe(ISSUE)
		expect(observation_ledger_home.read).toHaveBeenCalledWith(undefined, true)
		vi.mocked(split_measure.read_branch).mockResolvedValue({
			files: 1,
			lines: 1,
			verdict: 'single',
		})
		await expect(review_round_one_skip.eligible_issue()).resolves.toBe(ISSUE)
	})

	it.each([
		{ files: FILES + 1, lines: LINES, verdict: 'single' },
		{ files: FILES, lines: LINES + 1, verdict: 'single' },
	] as const)('keeps round one when either axis exceeds its declaration: %o', async (actual) => {
		vi.mocked(split_measure.read_branch).mockResolvedValue(actual)
		await expect(review_round_one_skip.eligible_issue()).resolves.toBeUndefined()
	})

	it.each([undefined, { files: 0, lines: LINES }, { files: FILES, lines: 0 }])(
		'keeps round one without a positive declaration: %o',
		async (declared) => {
			vi.mocked(issue_declared_size.read).mockResolvedValue(declared)
			await expect(review_round_one_skip.eligible_issue()).resolves.toBeUndefined()
		},
	)
})

describe('review_round_one_skip comment history', () => {
	it('keeps round one for blocking comment history not yet carried into the ledger', async () => {
		const finding = {
			category: 'bug-risks',
			severity: 'medium',
			file: 'a.ts',
			disposition: 'fixed',
		} as const

		vi.mocked(review_comment_round.issue_lines).mockResolvedValue([
			review_finding_ledger.finding_line(finding, DATE, ISSUE),
		])
		await expect(review_round_one_skip.eligible_issue()).resolves.toBeUndefined()
		expect(review_comment_round.issue_lines).toHaveBeenCalledWith(ISSUE)
	})
})

describe('review_round_one_skip history and gate', () => {
	it('keeps round one when the final review runs in CI, without reading issue or history', async () => {
		vi.mocked(review_gate_mode.read).mockReturnValue('ci')
		await expect(review_round_one_skip.eligible_issue()).resolves.toBeUndefined()
		expect(issue_declared_size.read).not.toHaveBeenCalled()
	})

	it.each(['high', 'medium'] as const)(
		'keeps all blocking history including fixed %s findings',
		async (severity) => {
			const finding = {
				category: 'bug-risks',
				severity,
				file: 'a.ts',
				disposition: 'fixed',
			} as const
			const old = review_finding_ledger.finding_line(finding, DATE, ISSUE)
			const clean = review_finding_ledger.zero_round_line(DATE, ISSUE)

			vi.mocked(observation_ledger_home.read).mockResolvedValue(`${old}\n${clean}`)
			await expect(review_round_one_skip.eligible_issue()).resolves.toBeUndefined()
		},
	)

	it('includes interaction history and ignores low findings and other issues', async () => {
		const finding = { category: 'bug-risks', severity: 'medium', file: 'a.ts' } as const
		const other = review_finding_ledger.finding_line(finding, DATE, ISSUE + 1)
		const low = review_finding_ledger.finding_line({ ...finding, severity: 'low' }, DATE, ISSUE)

		vi.mocked(observation_ledger_home.read).mockResolvedValue(`${other}\n${low}`)
		await expect(review_round_one_skip.eligible_issue()).resolves.toBe(ISSUE)
		vi.mocked(observation_ledger_home.read).mockResolvedValue(
			review_finding_ledger.finding_line(finding, DATE, ISSUE, 'interaction'),
		)
		await expect(review_round_one_skip.eligible_issue()).resolves.toBeUndefined()
	})
})

describe('review_round_one_skip unreadable inputs', () => {
	it.each(['issue', 'measurement', 'history', 'comments'] as const)(
		'keeps round one on unreadable %s',
		async (source) => {
			const reads = {
				issue: issue_declared_size.read,
				measurement: split_measure.read_branch,
				history: observation_ledger_home.read,
				comments: review_comment_round.issue_lines,
			}

			vi.mocked(reads[source]).mockRejectedValue(new Error('unreadable'))
			await expect(review_round_one_skip.eligible_issue()).resolves.toBeUndefined()
		},
	)

	it('keeps round one without an issue or a readable ledger', async () => {
		vi.mocked(observation_ledger_home.read).mockResolvedValue(undefined)
		await expect(review_round_one_skip.eligible_issue()).resolves.toBeUndefined()
		vi.mocked(git_command.branch).mockResolvedValue('main')
		await expect(review_round_one_skip.eligible_issue()).resolves.toBeUndefined()
	})
})

it('records skipped as a round-one outcome and names its reason', async () => {
	const record = vi.spyOn(lane_ledger_write, 'record_round_one').mockResolvedValue()
	const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true)

	await review_round_one_skip.record(ISSUE)
	expect(record).toHaveBeenCalledWith({ issue: ISSUE, verdict: 'skipped' })
	expect(stderr).toHaveBeenCalledWith(`${review_round_one_skip.NOTE}\n`)
})
