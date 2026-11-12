import { beforeEach, describe, expect, it, vi } from 'vitest'

const merge_mock = vi.hoisted(() => vi.fn())
const josh_run_mock = vi.hoisted(() => vi.fn())
const scoped_mock = vi.hoisted(() => vi.fn())
const alerts_mock = vi.hoisted(() => vi.fn())
const pr_number_mock = vi.hoisted(() => vi.fn())

vi.mock('#scripts/gh/git-gh-code-scanning', () => ({
	git_gh_code_scanning: { own_alerts_note: alerts_mock },
}))
vi.mock('#scripts/gh/git-gh-pr-read', () => ({
	git_gh_pr_read: { pr_get_number: pr_number_mock },
}))
vi.mock('#scripts/git/git-command', () => ({ git_command: { branch: async () => '5381-lane' } }))
vi.mock('#scripts/git/main-merge', () => ({ main_merge: { merge: merge_mock } }))
vi.mock('#scripts/josh/josh-run', () => ({ josh_command: { josh_run: josh_run_mock } }))
vi.mock('./run-ship-scoped', () => ({ run_ship_scoped: { scoped_gate: scoped_mock } }))
const { run_ship_sync } = await import('./run-ship-sync')

// joshuafolkken/kit#5381: a followup red on a code scanning alert in the pull request's own files
// stops at once — a merge of the default branch and a gate over it cannot clear that alert.

const OK = 0
const FAILED = 1
const PR_NUMBER = 5381
const TITLE = 'Stop on own CodeQL alerts #5381'
const CHECKS_RED = { code: FAILED, out: 'PR checks failed (failed checks: CodeQL).' }
const ALERT_NOTE = 'code scanning alerts:\n  js/rule — scripts/a.ts:3'
const FOLLOWUP = ['followup', TITLE]
const PUSH = ['git', '-y', '--skip-commit', '--skip-pr', TITLE]

function commands(): ReadonlyArray<ReadonlyArray<string>> {
	return josh_run_mock.mock.calls.map((call) => call[0] as ReadonlyArray<string>)
}

beforeEach(() => {
	merge_mock.mockReset().mockResolvedValue({ kind: 'merged', branch: 'main' })
	josh_run_mock
		.mockReset()
		.mockResolvedValue({ code: OK, out: '' })
		.mockResolvedValueOnce(CHECKS_RED)
	scoped_mock.mockReset().mockResolvedValue({ code: OK, out: '' })
	alerts_mock.mockReset().mockResolvedValue(undefined)
	pr_number_mock.mockReset().mockResolvedValue(PR_NUMBER)
})

describe('run_ship_sync.followup_stage — a code scanning alert in the pull request’s own files', () => {
	it.each([CHECKS_RED.out, 'PR checks failed (merge conflict; failed checks: CodeQL).'])(
		'stops with the rule and file:line, merging and gating nothing on %s',
		async (out) => {
			josh_run_mock.mockReset().mockResolvedValue({ code: FAILED, out })
			alerts_mock.mockResolvedValue(ALERT_NOTE)

			expect(await run_ship_sync.followup_stage(TITLE, [])).toStrictEqual({
				code: FAILED,
				out: `${out}\n${ALERT_NOTE}`,
				cause: 'check',
			})
			expect(alerts_mock).toHaveBeenCalledWith(PR_NUMBER)
			expect(merge_mock).not.toHaveBeenCalled()
			expect(scoped_mock).not.toHaveBeenCalled()
			expect(commands()).toStrictEqual([FOLLOWUP])
		},
	)

	it('recognizes a CodeQL failure reported on stderr', async () => {
		josh_run_mock.mockReset().mockResolvedValue({ code: FAILED, out: '', err: CHECKS_RED.out })
		alerts_mock.mockResolvedValue(ALERT_NOTE)

		expect(await run_ship_sync.followup_stage(TITLE, [])).toMatchObject({ cause: 'check' })
		expect(merge_mock).not.toHaveBeenCalled()
	})
})

describe('run_ship_sync.followup_stage — no alert to stop on merges again as before', () => {
	it.each(['PR checks failed (failed checks: Unit Tests).', 'PR checks failed (merge conflict).'])(
		'retries %s without reading alerts',
		async (out) => {
			josh_run_mock
				.mockReset()
				.mockResolvedValue({ code: OK, out: '' })
				.mockResolvedValueOnce({ code: FAILED, out })
			alerts_mock.mockResolvedValue(ALERT_NOTE)

			expect(await run_ship_sync.followup_stage(TITLE, [])).toMatchObject({ code: OK })
			expect(alerts_mock).not.toHaveBeenCalled()
			expect(merge_mock).toHaveBeenCalledOnce()
		},
	)

	it('merges, gates and pushes when no alert sits in the changed files or none is readable', async () => {
		expect(await run_ship_sync.followup_stage(TITLE, [])).toMatchObject({ code: OK })
		expect(commands()).toStrictEqual([FOLLOWUP, PUSH, FOLLOWUP])
		expect(scoped_mock).toHaveBeenCalledOnce()
	})

	it.each([
		['no open pull request', async () => undefined],
		[
			'an unreadable pull request',
			async () => {
				throw new Error('gh down')
			},
		],
	])('merges again without asking for alerts on %s', async (_label, read) => {
		pr_number_mock.mockImplementation(read)

		expect(await run_ship_sync.followup_stage(TITLE, [])).toMatchObject({ code: OK })
		expect(alerts_mock).not.toHaveBeenCalled()
		expect(merge_mock).toHaveBeenCalledOnce()
	})
})
