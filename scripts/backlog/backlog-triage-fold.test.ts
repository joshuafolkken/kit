import type { IssueComment } from '#scripts/issue/issue-read'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { order, folding } = vi.hoisted(() => ({
	order: new Array<string>(),
	folding: { is_folded: true },
}))

vi.mock('#scripts/run/carry/run-carry', () => ({
	run_carry: {
		repository_directory: vi.fn(async () => '/repo/.git'),
		carry_path: vi.fn(() => '/repo/.git/carry'),
		read_carry: vi.fn(() => ({ kind: 'carried' })),
	},
}))
vi.mock('#scripts/issue/issue-state-cli', () => ({
	issue_state_cli: { read_issue: vi.fn() },
}))
vi.mock('#scripts/gh/git-gh-issue-read', () => ({
	git_gh_issue_read: { issue_list_comments: vi.fn(async () => '[]') },
}))
vi.mock('#scripts/issue/issue-read', () => ({
	issue_read: { parse_comments: vi.fn(), trusted_bodies: vi.fn() },
}))
vi.mock('#scripts/epic/epic-blocked-by', () => ({
	epic_blocked_by: { listing_epics: vi.fn(async () => [7822]) },
}))
vi.mock('#scripts/epic/epic-decide', () => ({
	epic_decide: {
		decide: vi.fn(async () => {
			order.push('decide')

			return 0
		}),
	},
}))
vi.mock('#scripts/run/park/run-park', () => ({
	run_park: {
		clear: vi.fn(() => {
			order.push('clear')
		}),
	},
}))
vi.mock('#scripts/josh/josh-run', () => ({
	josh_command: {
		josh_run: vi.fn(async () => {
			order.push('run:add')

			return await { code: 0 }
		}),
	},
}))
vi.mock('#scripts/run/park/run-stalled-park', () => ({
	run_stalled_park: {
		apply: vi.fn(async () => {
			order.push('stalled')

			return true
		}),
	},
}))
vi.mock('#scripts/lane/lane-fold', () => ({
	lane_fold: {
		fold: vi.fn(async () => {
			order.push('fold')

			return await (folding.is_folded
				? { kind: 'folded' }
				: { kind: 'failed', step: 'withdraw', message: 'boom' })
		}),
	},
}))

const { issue_read } = await import('#scripts/issue/issue-read')
const { lane_fold } = await import('#scripts/lane/lane-fold')
const { backlog_triage_cli } = await import('./backlog-triage-cli')

const ISSUE = '7945'
const INTO = '7951'
const REASON = 'the wiring lands with #7951'
const PARK_AT = '2026-11-18T10:20:00Z'
const TREE_LINE = '\n\n---\n- Tree: abc1234 · changes 0\n'

function park_with(permission: string): string {
	return [
		'## Ship it with #7951?',
		'',
		'### 選択肢',
		'1. Ship it in the #7951 pull request',
		'   - 層: A',
		`   - 必要な権限: ${permission}`,
		'',
		'### 推奨',
		'1 the wiring lands with #7951',
	].join('\n')
}

function comment(created_at: string, body: string): IssueComment {
	return { author: 'joshuafolkken', created_at, body, is_trusted: true }
}

function adopt_with(comments: Array<IssueComment>): Promise<number> {
	vi.mocked(issue_read.parse_comments).mockResolvedValue(comments)
	vi.mocked(issue_read.trusted_bodies).mockReturnValue(comments.map((entry) => entry.body))

	return backlog_triage_cli.run(['--apply', ISSUE, '--adopt', '1', '--reason', REASON], '/repo')
}

function adopt(permission: string): Promise<number> {
	return adopt_with([comment(PARK_AT, park_with(permission))])
}

// The #7945 sequence: park → adopt → re-park on the same tree, which a requeue would only repeat.
function loop_comments(permission: string): Array<IssueComment> {
	const body = `${park_with(permission)}${TREE_LINE}`
	const adopted = `#${ISSUE}: adopted park option 1 (backlog:triage --adopt) — the parent takes it`

	return [
		comment(PARK_AT, body),
		comment('2026-11-18T10:27:21Z', adopted),
		comment('2026-11-18T10:33:30Z', body),
	]
}

beforeEach(() => {
	order.length = 0
	folding.is_folded = true
	vi.mocked(lane_fold.fold).mockClear()
	vi.spyOn(console, 'info').mockReturnValue()
	vi.spyOn(console, 'error').mockReturnValue()
})

// joshuafolkken/kit#7985: adopting a fold option folds the lane into the Issue it names, never a requeue.
describe('backlog:triage --adopt — a folding option', () => {
	it('runs lane:fold into the --into Issue and does not requeue (ac-467195fa)', async () => {
		await expect(adopt(`親（lane:fold ${ISSUE} --into #${INTO}）`)).resolves.toBe(0)

		expect(order).toStrictEqual(['decide', 'clear', 'fold'])
		expect(lane_fold.fold).toHaveBeenCalledWith({ issue: ISSUE, into: INTO, reason: REASON })
		expect(console.info).toHaveBeenCalledWith(expect.stringContaining('folded into'))
	})

	it('refuses a fold option naming no --into, writing nothing (ac-467195fa)', async () => {
		await expect(adopt(`親（lane:fold ${ISSUE}）`)).resolves.toBe(1)

		expect(order).toStrictEqual([])
		expect(console.error).toHaveBeenCalledWith(expect.stringContaining('no "--into #<M>"'))
	})

	it('folds a re-park on an unchanged tree instead of holding it (ac-e723514b)', async () => {
		await expect(
			adopt_with(loop_comments(`親（lane:fold ${ISSUE} --into #${INTO}）`)),
		).resolves.toBe(0)

		expect(order).toStrictEqual(['decide', 'clear', 'fold'])
	})

	it('reports a failed fold with the command that finishes it', async () => {
		folding.is_folded = false

		await expect(adopt(`親（lane:fold ${ISSUE} --into #${INTO}）`)).resolves.toBe(1)
		expect(console.error).toHaveBeenCalledWith(
			expect.stringContaining(
				`failed at withdraw: boom; run: pnpm josh lane:fold ${ISSUE} --into ${INTO}`,
			),
		)
	})
})
