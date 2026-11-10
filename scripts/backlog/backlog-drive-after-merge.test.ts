import { git_gh_issue_read } from '#scripts/gh/git-gh-issue-read'
import { issue_read } from '#scripts/issue/issue-read'
import { josh_command } from '#scripts/josh/josh-run'
import { telegram_notify } from '#scripts/notify/telegram-notify'
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

// A park with no recommendation over `options` — each `[tier, permission]`.
function unpicked_body(options: ReadonlyArray<readonly [string, string]>): string {
	const listed = options.flatMap(([tier, permission], index) => [
		`${String(index + 1)}. Option ${String(index + 1)}`,
		`   - 層: ${tier}`,
		`   - 必要な権限: ${permission}`,
	])

	return ['### 選択肢', ...listed, '', '### 推奨', '推奨なし a toss-up'].join('\n')
}

interface Recorded {
	ports: ParkPorts
	runs: Array<ReadonlyArray<string>>
	notices: Array<string>
}

function recorded(bodies: ReadonlyArray<string>, codes: ReadonlyArray<number> = []): Recorded {
	const runs: Array<ReadonlyArray<string>> = []
	const notices: Array<string> = []
	const queue = [...codes]

	return {
		runs,
		notices,
		ports: {
			bodies: async () => bodies,
			run: async (argv) => {
				runs.push(argv)

				return queue.shift() ?? 0
			},
			notify: async (line) => {
				notices.push(line)
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

	it('sends no notice for the recommendation it takes', async () => {
		const { ports, notices } = recorded([park_body('A', 'なし')])

		await expect(backlog_drive_after_merge.resolve(ISSUE, ports)).resolves.toBe(true)
		expect(notices).toStrictEqual([])
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

describe('backlog_drive_after_merge — the default notice port', () => {
	it('announces a decided unpicked park through telegram', async () => {
		vi.spyOn(git_gh_issue_read, 'issue_list_comments').mockResolvedValue('[]')
		vi.spyOn(issue_read, 'trusted_bodies').mockReturnValue([unpicked_body([['A', 'なし']])])
		vi.spyOn(josh_command, 'josh_run').mockResolvedValue({ code: 0, out: '' })
		const decided = vi.spyOn(telegram_notify, 'decided').mockResolvedValue(true)

		await expect(backlog_drive_after_merge.resolve(ISSUE)).resolves.toBe(true)
		expect(decided).toHaveBeenCalledWith(
			expect.objectContaining({ body: expect.stringContaining('Auto-decided: option 1') }),
		)
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

// joshuafolkken/kit#7077: a park with no recommendation is decided by the default rule, recorded as
// `Auto-decided: …`, cleared for the next offer, and announced after the fact — once per issue.
const PERSON_THEN_B: ReadonlyArray<readonly [string, string]> = [
	['C', '人'],
	['B', 'なし'],
]
const ONLY_C: ReadonlyArray<readonly [string, string]> = [
	['C', 'なし'],
	['C', '人'],
]

describe('backlog_drive_after_merge — a park with no recommendation', () => {
	it('auto-decides the smallest reversible option, records it, clears it, then notifies', async () => {
		const { ports, runs, notices } = recorded([unpicked_body(PERSON_THEN_B)])

		await after('parked', ports)

		expect(book).not.toHaveBeenCalled()
		expect(runs[0]?.[3]).toContain(backlog_drive_after_merge.DECISION_HEADING)
		expect(runs[0]?.[3]).toContain('Auto-decided: option 2 over option 1 because')
		expect(runs[1]).toStrictEqual(CLEAR)
		expect(notices).toStrictEqual([`#${ISSUE}: Auto-decided: option 2 over option 1`])
	})

	it('leaves a park with only tier C options to a person and books it done', async () => {
		const { ports, runs, notices } = recorded([unpicked_body(ONLY_C)])

		await after('parked', ports)

		expect(runs).toStrictEqual([])
		expect(notices).toStrictEqual([])
		expect(book).toHaveBeenCalledWith(ISSUE, expect.objectContaining({ outcome: 'parked' }), OWNER)
	})

	it('auto-decides once, so the same issue parking again with no recommendation stays', async () => {
		const park = unpicked_body([['B', 'なし']])
		const decided = `${backlog_drive_after_merge.DECISION_HEADING}\n\nAuto-decided: option 1.`
		const { ports, runs, notices } = recorded([park, decided, park])

		await expect(backlog_drive_after_merge.resolve(ISSUE, ports)).resolves.toBe(false)
		expect(runs).toStrictEqual([])
		expect(notices).toStrictEqual([])
	})

	it('sends no notice when clearing the park fails', async () => {
		const { ports, notices } = recorded([unpicked_body([['A', 'なし']])], [0, 1])

		await expect(backlog_drive_after_merge.resolve(ISSUE, ports)).resolves.toBe(false)
		expect(notices).toStrictEqual([])
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
