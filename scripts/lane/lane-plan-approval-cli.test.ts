import path from 'node:path'
import { auto_ok_cli } from '#scripts/auto-ok/auto-ok-cli'
import { git_gh_issue_read } from '#scripts/gh/git-gh-issue-read'
import { git_common_directory } from '#scripts/git/git-common-directory'
import { cutoff_of } from '#scripts/git/listing-cutoff'
import { issue_read } from '#scripts/issue/issue-read'
import { file_reader } from '#scripts/lib/read-file'
import { line_budget } from '#scripts/lines/line-budget'
import { run_hold_cli } from '#scripts/run/hold/run-hold-cli'
import { temporary_directory } from '#tools/test/temporary-directory'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { lane_ledger_write } from './lane-ledger-write'
import { lane_plan } from './lane-plan'
import { lane_plan_check } from './lane-plan-check'
import { lane_plan_cli } from './lane-plan-cli'
import { lane_plan_signals } from './lane-plan-signals'
import { lane_yield } from './lane-yield'

const make_directory = temporary_directory('suite')
const ROOT = make_directory('lane-plan-approval-')
const DIRECTORY = path.join(ROOT, 'lane')
const ISSUE = 6594
const OTHER = 6595
const SUCCESS = 0
const LIMIT = 100
const PATHS = [
	'scripts/lane/lane-size-stats.ts',
	'scripts/split/split-assess.ts',
	'scripts/issue/size-estimate.ts',
]
const APPROVAL = {
	issue: ISSUE,
	paths: PATHS,
	declared_lines: 170,
	max_lines: 204,
	source: 'https://github.com/joshuafolkken/kit/issues/6594#issuecomment-6687208090',
	rationale: 'Approved projected lines only.',
	author: 'joshuafolkken',
	body: '#6594 の再分割しない例外承認。品質ゲートは省略しない。',
}
const APPROVAL_FLAG = '--size-approval'
const FILE_APPROVAL = {
	issue: ISSUE,
	paths: PATHS,
	declared_files: 1,
	max_files: PATHS.length,
	source: APPROVAL.source,
	rationale: 'Approved listed files only; retain line and hunk limits.',
}
const FLAGS = [APPROVAL_FLAG, '.josh/tmp/6594-size.json']
const QUIET = {
	hunk_files: [],
	committed_files: [],
	lines_ratio: 1.2,
	implement_rate: undefined,
	split_filed: false,
}
const fetch = vi.spyOn(auto_ok_cli, 'fetch_opted_in')
const signals = vi.spyOn(lane_plan_signals, 'signals_of')
const release = vi.spyOn(run_hold_cli, 'run')
const yielded = vi.spyOn(lane_yield, 'record_yield')

function listing(
	issue: number,
	files = 3,
): Awaited<ReturnType<typeof auto_ok_cli.fetch_opted_in>> & { kind: 'read' } {
	const own = {
		number: issue,
		title: 'size approval',
		createdAt: '2026-11-06T00:00:00Z',
		labels: [{ name: 'in-progress' }],
		body: `## 背景\n\n- 規模見積もり: 約 ${String(files)} ファイル / 170 行（テスト除く）`,
	}

	return { kind: 'read' as const, issues: [own], cutoff: cutoff_of(1, LIMIT, false) }
}

beforeEach(() => {
	vi.spyOn(git_common_directory, 'repository').mockReturnValue(
		make_directory(path.join(ROOT, 'repo-')),
	)
	vi.spyOn(line_budget, 'budgets_for').mockResolvedValue([])
	vi.spyOn(console, 'error').mockImplementation(vi.fn())
	vi.spyOn(console, 'info').mockImplementation(vi.fn())
	fetch.mockResolvedValue(listing(ISSUE))
	signals.mockResolvedValue(QUIET)
	release.mockResolvedValue(SUCCESS)
	yielded.mockResolvedValue(undefined)
})

beforeEach(() => {
	vi.spyOn(file_reader, 'read_if_readable').mockReturnValue(JSON.stringify(APPROVAL))
	vi.spyOn(git_gh_issue_read, 'issue_list_comments').mockResolvedValue('[]')
	vi.spyOn(issue_read, 'parse_comments').mockResolvedValue([
		{
			html_url: APPROVAL.source,
			author: APPROVAL.author,
			body: APPROVAL.body,
			created_at: '2026-11-06T14:29:30Z',
			is_trusted: true,
		},
	])
	vi.spyOn(lane_ledger_write, 'record_split_notice').mockResolvedValue(undefined)
})

describe('lane:plan bounded human size approval (#6596)', () => {
	it('clears #6594 at the approved 170 × 1.2 = 204 and records its evidence', async () => {
		expect(await lane_plan_cli.run([String(ISSUE), ...PATHS, ...FLAGS], DIRECTORY)).toBe(SUCCESS)
		expect(lane_plan.read(ISSUE, DIRECTORY)).toMatchObject({
			cleared: true,
			size_approval: APPROVAL,
			paths: PATHS,
		})
	})

	it('keeps an unapproved identical plan refused', async () => {
		expect(await lane_plan_cli.run([String(ISSUE), ...PATHS], DIRECTORY)).toBe(
			lane_plan_check.SPLIT_EXIT_CODE,
		)
		expect(lane_plan.read(ISSUE, DIRECTORY)).toBeUndefined()
	})

	it('keeps a probe read-only while applying the same approval', async () => {
		expect(await lane_plan_cli.run([String(ISSUE), ...PATHS, ...FLAGS, '--probe'], DIRECTORY)).toBe(
			SUCCESS,
		)
		expect(lane_plan.read(ISSUE, DIRECTORY)).toBeUndefined()
	})
})

describe('lane:plan approval scope', () => {
	it('refuses another Issue even if supplied with the same approval', async () => {
		fetch.mockResolvedValue(listing(OTHER))

		expect(await lane_plan_cli.run([String(OTHER), ...PATHS, ...FLAGS], DIRECTORY)).toBe(1)
	})

	it('refuses paths outside the approved scope', async () => {
		expect(
			await lane_plan_cli.run([String(ISSUE), ...PATHS, 'extra.ts', ...FLAGS], DIRECTORY),
		).toBe(lane_plan_check.SPLIT_EXIT_CODE)
	})

	// joshuafolkken/kit#6602: past the approved clear the lane has started, so the overrun only warns.
	it('checks increased projected lines again after an approved clear, as a warning', async () => {
		await lane_plan_cli.run([String(ISSUE), ...PATHS, ...FLAGS], DIRECTORY)
		signals.mockResolvedValue({ ...QUIET, lines_ratio: 1.3 })

		expect(await lane_plan_cli.run([String(ISSUE), ...PATHS], DIRECTORY)).toBe(SUCCESS)
		expect(console.error).toHaveBeenCalledWith(expect.stringContaining('size warning (lines)'))
	})

	it('refuses a changed declaration even with the same projected lines', async () => {
		const read = listing(ISSUE)

		fetch.mockResolvedValue({
			...read,
			issues: read.issues.map((row) => ({
				...row,
				body: '## 背景\n\n- 規模見積もり: 約 3 ファイル / 180 行（テスト除く）',
			})),
		})
		signals.mockResolvedValue({ ...QUIET, lines_ratio: 1.13 })

		expect(await lane_plan_cli.run([String(ISSUE), ...PATHS, ...FLAGS], DIRECTORY)).toBe(
			lane_plan_check.SPLIT_EXIT_CODE,
		)
	})
})

describe('lane:plan approval retains other gates', () => {
	it('keeps the file-count bar', async () => {
		fetch.mockResolvedValue(listing(ISSUE, 1))

		expect(await lane_plan_cli.run([String(ISSUE), ...PATHS, ...FLAGS], DIRECTORY)).toBe(
			lane_plan_check.SPLIT_EXIT_CODE,
		)
	})

	it('keeps the unplanned-hunk bar', async () => {
		signals.mockResolvedValue({ ...QUIET, hunk_files: Array.from({ length: 7 }, () => 'extra.ts') })

		expect(await lane_plan_cli.run([String(ISSUE), ...PATHS, ...FLAGS], DIRECTORY)).toBe(
			lane_plan_check.SPLIT_EXIT_CODE,
		)
	})

	it('still yields to an earlier holder of an approved path', async () => {
		lane_plan.record({ issue: OTHER, paths: PATHS, planned_at: '2000-01-01T00:00:00Z' }, DIRECTORY)
		const read = listing(ISSUE)

		fetch.mockResolvedValue({ ...read, issues: [...read.issues, ...listing(OTHER).issues] })

		expect(await lane_plan_cli.run([String(ISSUE), ...PATHS, ...FLAGS], DIRECTORY)).toBe(
			lane_plan_cli.YIELD_EXIT_CODE,
		)
		expect(yielded).toHaveBeenCalled()
		expect(lane_plan.read(ISSUE, DIRECTORY)).toMatchObject({
			yielded: true,
			size_approval: APPROVAL,
		})
	})
})

describe('lane:plan approval on a later registration', () => {
	it('replaces a recorded approval with newly supplied evidence', async () => {
		await lane_plan_cli.run([String(ISSUE), ...PATHS, ...FLAGS], DIRECTORY)
		const updated = { ...APPROVAL, max_lines: 221 }

		vi.spyOn(file_reader, 'read_if_readable').mockReturnValue(JSON.stringify(updated))
		signals.mockResolvedValue({ ...QUIET, lines_ratio: 1.3 })

		expect(await lane_plan_cli.run([String(ISSUE), ...PATHS, ...FLAGS], DIRECTORY)).toBe(SUCCESS)
		expect(lane_plan.read(ISSUE, DIRECTORY)?.size_approval).toEqual(updated)
	})

	it('shows the approval argument in help when its value is missing', async () => {
		vi.spyOn(file_reader, 'read_if_readable').mockReturnValue(undefined)

		expect(await lane_plan_cli.run([String(ISSUE), ...PATHS, APPROVAL_FLAG], DIRECTORY)).toBe(1)
		expect(console.error).toHaveBeenCalledWith(
			expect.stringContaining('--size-approval <json-file>'),
		)
	})

	it('reuses its recorded evidence for the same scope without asking again', async () => {
		await lane_plan_cli.run([String(ISSUE), ...PATHS, ...FLAGS], DIRECTORY)

		expect(await lane_plan_cli.run([String(ISSUE), ...PATHS], DIRECTORY)).toBe(SUCCESS)
		expect(lane_plan.read(ISSUE, DIRECTORY)?.size_approval).toEqual(APPROVAL)
	})

	it('records an added file past a cleared approval as a warning, not inside the approval', async () => {
		await lane_plan_cli.run([String(ISSUE), ...PATHS, ...FLAGS], DIRECTORY)

		expect(await lane_plan_cli.run([String(ISSUE), ...PATHS, 'extra.ts'], DIRECTORY)).toBe(SUCCESS)
		expect(console.error).toHaveBeenCalledWith(expect.stringContaining('size warning'))
		expect(lane_plan.read(ISSUE, DIRECTORY)?.size_approval).toEqual(APPROVAL)
	})

	it('refuses an unreadable explicit approval without recording a plan', async () => {
		vi.spyOn(file_reader, 'read_if_readable').mockReturnValue(undefined)

		expect(await lane_plan_cli.run([String(ISSUE), ...PATHS, ...FLAGS], DIRECTORY)).toBe(1)
		expect(lane_plan.read(ISSUE, DIRECTORY)).toBeUndefined()
	})
})

function file_scope_setup(): void {
	fetch.mockResolvedValue(listing(ISSUE, 1))
	signals.mockResolvedValue({ ...QUIET, lines_ratio: 1 })
	vi.spyOn(file_reader, 'read_if_readable').mockReturnValue(JSON.stringify(FILE_APPROVAL))
}

describe('lane:plan bounded file approval', () => {
	beforeEach(file_scope_setup)

	it('records file evidence and reuses it for the same approved plan', async () => {
		expect(await lane_plan_cli.run([String(ISSUE), ...PATHS, ...FLAGS], DIRECTORY)).toBe(SUCCESS)
		expect(lane_plan.read(ISSUE, DIRECTORY)?.size_approval).toMatchObject(FILE_APPROVAL)
		expect(await lane_plan_cli.run([String(ISSUE), ...PATHS], DIRECTORY)).toBe(SUCCESS)
	})

	it('refuses the same file overflow without an explicit approval', async () => {
		expect(await lane_plan_cli.run([String(ISSUE), ...PATHS], DIRECTORY)).toBe(
			lane_plan_check.SPLIT_EXIT_CODE,
		)
	})

	it.each([
		{ ...FILE_APPROVAL, max_files: 2 },
		{ ...FILE_APPROVAL, declared_files: 2 },
		{ ...FILE_APPROVAL, paths: PATHS.slice(1) },
	])('refuses file scope mismatch %j', async (scope) => {
		vi.spyOn(file_reader, 'read_if_readable').mockReturnValue(JSON.stringify(scope))

		expect(await lane_plan_cli.run([String(ISSUE), ...PATHS, ...FLAGS], DIRECTORY)).toBe(
			lane_plan_check.SPLIT_EXIT_CODE,
		)
	})

	it.each([
		{ ...QUIET, lines_ratio: 1.3 },
		{ ...QUIET, lines_ratio: 1, hunk_files: ['extra.ts', 'extra.ts', 'extra.ts'] },
	])('retains the independent line and hunk limits %j', async (input) => {
		signals.mockResolvedValue(input)

		expect(await lane_plan_cli.run([String(ISSUE), ...PATHS, ...FLAGS], DIRECTORY)).toBe(
			lane_plan_check.SPLIT_EXIT_CODE,
		)
	})
})
