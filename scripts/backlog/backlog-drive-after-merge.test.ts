import { git_gh_issue_read } from '#scripts/gh/git-gh-issue-read'
import { issue_read } from '#scripts/issue/issue-read'
import { josh_command } from '#scripts/josh/josh-run'
import type { MergeResult } from '#scripts/run/merge/run-merge-cli'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { backlog_drive_after_merge, type ParkPorts } from './backlog-drive-after-merge'
import { backlog_drive_named } from './backlog-drive-named'
import { backlog_drive_retry } from './backlog-drive-retry'

vi.mock('./backlog-drive-retry', () => ({
	backlog_drive_retry: { after_merge: vi.fn(async () => undefined) },
}))

vi.mock('./backlog-drive-named', () => ({
	backlog_drive_named: { mark_done: vi.fn(async () => undefined) },
}))

const ISSUE = '6738'
const OWNER = '4242'
const CLEAR = ['run:park', ISSUE, '--clear']
const book = vi.mocked(backlog_drive_named.mark_done)

function park_body(tier: string, permission: string): string {
	return [
		'## Which way?',
		'',
		'### 選択肢',
		'1. File it as an interrupt',
		`   - 層: ${tier}`,
		`   - 必要な権限: ${permission}`,
		'',
		'### 推奨',
		'1 it is our own verification',
	].join('\n')
}

interface Recorded {
	ports: ParkPorts
	runs: Array<ReadonlyArray<string>>
}

function recorded(bodies: ReadonlyArray<string>, codes: ReadonlyArray<number> = []): Recorded {
	const runs: Array<ReadonlyArray<string>> = []
	const queue = [...codes]

	return {
		runs,
		ports: {
			bodies: async () => bodies,
			run: async (argv) => {
				runs.push(argv)

				return queue.shift() ?? 0
			},
		},
	}
}

async function after(outcome: MergeResult['outcome'], ports: ParkPorts): Promise<void> {
	const result: MergeResult = { token: '', code: 0, is_offer: true, outcome }

	await backlog_drive_after_merge.after_merge(ISSUE, result, OWNER, ports)
}

beforeEach(() => {
	vi.mocked(backlog_drive_retry.after_merge).mockClear()
	book.mockClear()
})

// joshuafolkken/kit#6738: a park whose recommendation needs no person is decided by the driver, with
// no person, and its label comes off so the next offer hands the child back to a lane. It is not
// booked done, so a named run keeps the child and the issues declared after it.
describe('backlog_drive_after_merge — a parked child', () => {
	it('decides a tier A park needing no permission, then clears it', async () => {
		const { ports, runs } = recorded([park_body('A', 'なし')])

		await after('parked', ports)

		expect(book).not.toHaveBeenCalled()
		expect(runs.map((argv) => argv.slice(0, 2))).toStrictEqual([
			['issue:comment', ISSUE],
			['run:park', ISSUE],
		])
		expect(runs[0]?.[3]).toContain(backlog_drive_after_merge.DECISION_HEADING)
		expect(runs[0]?.[3]).toContain('option 1')
		expect(runs[1]).toStrictEqual(CLEAR)
	})

	it('reads the trusted comments and posts through josh by default', async () => {
		vi.spyOn(git_gh_issue_read, 'issue_list_comments').mockResolvedValue('[]')
		vi.spyOn(issue_read, 'trusted_bodies').mockReturnValue([park_body('A', 'なし')])
		const run = vi.spyOn(josh_command, 'josh_run').mockResolvedValue({ code: 0, out: '' })

		await expect(backlog_drive_after_merge.resolve(ISSUE)).resolves.toBe(true)
		expect(run).toHaveBeenLastCalledWith(CLEAR, true)
		vi.restoreAllMocks()
	})
})

describe('backlog_drive_after_merge — a park left to a person', () => {
	it.each([
		// joshuafolkken/kit#7001: adopting it takes no action, so the child would park again.
		["a park needing the parent's own action", park_body('A', '親')],
		['a tier B park', park_body('B', 'なし')],
		['a park needing a person', park_body('A', '人')],
		['a park needing the trust setting', park_body('A', '信頼設定')],
	])('leaves %s on the decision row, untouched', async (_case, body) => {
		const { ports, runs } = recorded([body])

		await expect(backlog_drive_after_merge.resolve(ISSUE, ports)).resolves.toBe(false)
		expect(runs).toStrictEqual([])
	})

	it('reads the latest park, not an earlier one', async () => {
		const { ports, runs } = recorded([park_body('A', 'なし'), park_body('A', '人')])

		await expect(backlog_drive_after_merge.resolve(ISSUE, ports)).resolves.toBe(false)
		expect(runs).toStrictEqual([])
	})

	it('decides at most once on an issue, so a repeated park goes to a person', async () => {
		const decided = `${backlog_drive_after_merge.DECISION_HEADING}\n\nTaking option 1.`
		const { ports, runs } = recorded([park_body('A', 'なし'), decided, park_body('A', 'なし')])

		await expect(backlog_drive_after_merge.resolve(ISSUE, ports)).resolves.toBe(false)
		expect(runs).toStrictEqual([])
	})

	it('books a park left to a person done', async () => {
		await after('parked', recorded([park_body('B', 'なし')]).ports)

		expect(book).toHaveBeenCalledWith(ISSUE, expect.objectContaining({ outcome: 'parked' }), OWNER)
	})

	it('keeps the park when the decision comment fails', async () => {
		const { ports, runs } = recorded([park_body('A', 'なし')], [1])

		await expect(backlog_drive_after_merge.resolve(ISSUE, ports)).resolves.toBe(false)
		expect(runs).toHaveLength(1)
	})
})

describe('backlog_drive_after_merge — other outcomes', () => {
	it('books a merge done, then retries the waiting issues', async () => {
		const { ports, runs } = recorded([park_body('A', 'なし')])

		await after('merged', ports)

		expect(book).toHaveBeenCalledBefore(vi.mocked(backlog_drive_retry.after_merge))
		expect(backlog_drive_retry.after_merge).toHaveBeenCalledWith(Number(ISSUE))
		expect(runs).toStrictEqual([])
	})

	it('only books a failed child done', async () => {
		const { ports, runs } = recorded([park_body('A', 'なし')])

		await after('failed', ports)

		expect(book).toHaveBeenCalledOnce()
		expect(backlog_drive_retry.after_merge).not.toHaveBeenCalled()
		expect(runs).toStrictEqual([])
	})
})
