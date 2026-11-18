import type { IssueComment } from '#scripts/issue/issue-read'
import { session_language } from '#scripts/josh/session-language'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { order, stalled } = vi.hoisted(() => ({
	order: new Array<string>(),
	stalled: { is_parked: true },
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
	epic_decide: { decide: vi.fn(async () => 0) },
}))
vi.mock('#scripts/run/park/run-park', () => ({
	run_park: { clear: vi.fn() },
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

			return await stalled.is_parked
		}),
	},
}))

const { issue_read } = await import('#scripts/issue/issue-read')
const { run_stalled_park } = await import('#scripts/run/park/run-stalled-park')
const { backlog_triage_cli } = await import('./backlog-triage-cli')
const { backlog_triage_park_loop } = await import('./backlog-triage-park-loop')

const ISSUE = '7780'
const TREE = 'abc1234 · 0'
const MOVED_TREE = 'def5678 · 0'
const FIRST_PARK_AT = '2026-11-17T13:50:58Z'
const ADOPT_AT = '2026-11-17T13:53:02Z'
const LATEST_PARK_AT = '2026-11-17T13:55:07Z'
const ADOPT = `#${ISSUE}: adopted park option 1 (backlog:triage --adopt) — the parent takes it`
const DONE_ADOPT = `${ADOPT} · parent action done: rotated the token`
const PARK = [
	'## Which lane?',
	'',
	'### 選択肢',
	'1. Keep the lane',
	'   - 層: A',
	'   - 必要な権限: なし',
	'',
	'### 推奨',
	'1 cheaper',
].join('\n')

function park_on(tree: string | undefined): string {
	return tree === undefined
		? PARK
		: `${PARK}\n\n---\n- Tree: ${tree.replace(' · ', ' · changes ')}\n`
}

function comment(created_at: string, body: string): IssueComment {
	return { author: 'joshuafolkken', created_at, body, is_trusted: true }
}

// The #7780 sequence: park 13:50:58 → adopt 13:53:02 → park 13:55:07.
function loop_comments(
	earlier: string | undefined,
	latest: string | undefined,
): Array<IssueComment> {
	return [
		comment(FIRST_PARK_AT, park_on(earlier)),
		comment(ADOPT_AT, ADOPT),
		comment(LATEST_PARK_AT, park_on(latest)),
	]
}

const NEW_QUESTION = comment(LATEST_PARK_AT, park_on(TREE).replace('Which lane?', 'Which token?'))

// joshuafolkken/kit#7820: a re-park on the tree the last adopted option left unchanged is a loop.
describe('backlog_triage_park_loop.loop_of', () => {
	it('finds the loop when the re-park after the adopt keeps the tree (#7780)', () => {
		expect(backlog_triage_park_loop.loop_of(loop_comments(TREE, TREE))).toStrictEqual({
			adopted: ADOPT,
			tree: TREE,
		})
	})

	it('reads a Japanese tree line as the same tree', () => {
		const comments = loop_comments(TREE, TREE)
		const japanese = `${PARK}\n\n---\n- ツリー: abc1234 · 変更 0\n`

		comments[0] = comment(FIRST_PARK_AT, japanese)

		expect(backlog_triage_park_loop.loop_of(comments)?.tree).toBe(TREE)
	})

	it.each([
		['the tree moved', loop_comments(TREE, MOVED_TREE)],
		['the uncommitted count moved', loop_comments(TREE, 'abc1234 · 2')],
		['the earlier park has no tree line', loop_comments(undefined, TREE)],
		['the latest park has no tree line', loop_comments(TREE, undefined)],
		['no adopt came between the parks', loop_comments(TREE, TREE).toSpliced(1, 1)],
		['the adopt follows the latest park', loop_comments(TREE, TREE).toSpliced(2, 1)],
		[
			'the parent acted outside the lane (--done)',
			loop_comments(TREE, TREE).with(1, comment(ADOPT_AT, DONE_ADOPT)),
		],
		[
			'the re-park asks a new question on the same tree',
			loop_comments(TREE, TREE).with(2, NEW_QUESTION),
		],
	])('finds no loop when %s', (_case, comments) => {
		expect(backlog_triage_park_loop.loop_of(comments)).toBeUndefined()
	})
})

// joshuafolkken/kit#7818: the #7780 earlier park wrote its permission in free text; it is still a park.
describe('backlog_triage_park_loop.loop_of — a park off the permission vocabulary', () => {
	it('finds the loop when the earlier park names a permission off the vocabulary', () => {
		const prose = park_on(TREE).replace('必要な権限: なし', '必要な権限: Issue のクローズ')
		const comments = loop_comments(TREE, TREE).with(0, comment(FIRST_PARK_AT, prose))

		expect(backlog_triage_park_loop.loop_of(comments)?.tree).toBe(TREE)
	})
})

function adopt_with(comments: Array<IssueComment>): Promise<number> {
	vi.mocked(issue_read.parse_comments).mockResolvedValue(comments)
	vi.mocked(issue_read.trusted_bodies).mockReturnValue(comments.map((entry) => entry.body))

	return backlog_triage_cli.run(['--apply', ISSUE, '--adopt', '1', '--reason', 'retry'], '/repo')
}

beforeEach(() => {
	order.length = 0
	stalled.is_parked = true
	vi.stubEnv(session_language.ENV_KEY, 'en')
	vi.spyOn(console, 'info').mockReturnValue()
	vi.spyOn(console, 'error').mockReturnValue()
})

afterEach(() => {
	vi.unstubAllEnvs()
})

describe('backlog:triage --adopt — a re-park on an unchanged tree', () => {
	it('parks it for a person with the reason instead of requeuing it (ac-92bbf7ee)', async () => {
		await expect(adopt_with(loop_comments(TREE, TREE))).resolves.toBe(0)

		expect(order).toStrictEqual(['stalled'])
		expect(run_stalled_park.apply).toHaveBeenCalledWith(
			ISSUE,
			expect.stringMatching(/option 1 adopted but not requeued \(park loop\).*abc1234 · 0/su),
			'park loop',
		)
		expect(console.info).toHaveBeenCalledWith(expect.stringContaining('not requeued'))
	})

	it('names the earlier adopt in the Japanese reason', async () => {
		vi.stubEnv(session_language.ENV_KEY, 'ja')
		await adopt_with(loop_comments(TREE, TREE))

		expect(run_stalled_park.apply).toHaveBeenCalledWith(
			ISSUE,
			expect.stringContaining(
				`前の採用（${ADOPT}）の後、子はレーンのツリー（${TREE}）が変わらないまま`,
			),
			'park loop',
		)
	})

	it.each([
		['the tree moved (ac-cfd11fa4)', loop_comments(TREE, MOVED_TREE)],
		['an old park has no tree line (ac-e4a9b4d0)', loop_comments(undefined, TREE)],
	])('requeues as before when %s', async (_case, comments) => {
		await expect(adopt_with(comments)).resolves.toBe(0)

		expect(order).toStrictEqual(['run:add'])
	})

	it('reports the hold that failed to land', async () => {
		stalled.is_parked = false

		await expect(adopt_with(loop_comments(TREE, TREE))).resolves.toBe(1)
		expect(console.error).toHaveBeenCalledWith(expect.stringContaining('re-run this command'))
	})
})
