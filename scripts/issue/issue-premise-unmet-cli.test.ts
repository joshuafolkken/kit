import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { temporary_directory } from '#tools/test/temporary-directory'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { issue_body_keys } from './issue-body-keys'
import { issue_premise_unmet_cli } from './issue-premise-unmet-cli'

// joshuafolkken/kit#7286: the declared-close-condition exit. The GitHub and git reads, the writes and
// the hold release are mocked, so what refuses before any write — and the order the writes run in —
// is read back.

const mocks = vi.hoisted(() => ({
	issue_get_body: vi.fn<(issue_number: string) => Promise<string | undefined>>(),
	issue_comment: vi.fn<(issue_number: string, body: string) => Promise<string>>(),
	issue_close:
		vi.fn<
			(issue_number: string, comment: string | undefined, reason?: string) => Promise<boolean>
		>(),
	release: vi.fn<(argv: ReadonlyArray<string>) => Promise<number>>(),
	commit_count_beyond: vi.fn<(base: string, tip: string) => Promise<number>>(),
	status: vi.fn<(directory?: string) => Promise<string>>(),
	pr_exists: vi.fn<(branch_name: string) => Promise<boolean>>(),
	close_completed_epics: vi.fn<() => Promise<void>>(),
}))

vi.mock('#scripts/gh/git-gh-command', () => ({
	git_gh_command: {
		issue_comment: mocks.issue_comment,
		issue_close: mocks.issue_close,
		issue_get_body: mocks.issue_get_body,
	},
}))

vi.mock('#scripts/run/hold/run-hold-cli', () => ({ run_hold_cli: { run: mocks.release } }))

vi.mock('#scripts/git/git-command', () => ({
	git_command: { commit_count_beyond: mocks.commit_count_beyond, status: mocks.status },
}))

vi.mock('#scripts/gh/git-gh-pr-read', () => ({ git_gh_pr_read: { pr_exists: mocks.pr_exists } }))

vi.mock('#scripts/lane/lane-registry', () => ({
	lane_registry: { lane_root_directory: async (): Promise<string> => '/lanes' },
}))

vi.mock('#scripts/epic/epic-close', () => ({
	epic_close: { close_completed_epics: mocks.close_completed_epics },
}))

const ISSUE = '7249'
const FLAG = '--evidence-file'
const make_directory = temporary_directory('suite')
const work = make_directory('issue-premise-unmet-cli-')
const EVIDENCE_FILE = path.join(work, 'evidence.md')
const BACKGROUND = issue_body_keys.heading('background')
const DECLARED_BODY = `${BACKGROUND}\n\n${issue_body_keys.prefix('close_condition')} load time < persist time\n`
const UNDECLARED_BODY = `${BACKGROUND}\n\n${issue_body_keys.prefix('premise')} load time > persist time\n`
const EMPTY_DECLARATION_BODY = `${BACKGROUND}\n\n${issue_body_keys.prefix('close_condition')}\n`

writeFileSync(EVIDENCE_FILE, 'load 40 ms, persist 120 ms: the declared close condition holds\n')

const calls: Array<string> = []

function record(name: string): void {
	calls.push(name)
}

// Every read answers the admitted case: a declared body, a clean lane branch and no pull request.
function reset_reads(): void {
	mocks.issue_get_body.mockReset().mockResolvedValue(DECLARED_BODY)
	mocks.commit_count_beyond.mockReset().mockResolvedValue(0)
	mocks.status.mockReset().mockResolvedValue('')
	mocks.pr_exists.mockReset().mockResolvedValue(false)
}

beforeEach(() => {
	calls.length = 0
	reset_reads()
	mocks.issue_comment.mockReset().mockImplementation(async () => {
		record('comment')

		return 'https://github.com/o/r/issues/7249#issuecomment-1'
	})
	mocks.issue_close.mockReset().mockImplementation(async () => {
		record('close')

		return true
	})
	mocks.release.mockReset().mockImplementation(async () => {
		record('release')

		return 0
	})
	mocks.close_completed_epics.mockReset().mockResolvedValue(undefined)
	vi.spyOn(console, 'info').mockImplementation(() => undefined)
	vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
	vi.restoreAllMocks()
})

const REFUSALS = [
	{
		name: 'no close-condition line',
		arrange: (): unknown => mocks.issue_get_body.mockResolvedValue(UNDECLARED_BODY),
	},
	{
		name: 'an empty close-condition line',
		arrange: (): unknown => mocks.issue_get_body.mockResolvedValue(EMPTY_DECLARATION_BODY),
	},
	{
		name: 'an unread body',
		arrange: (): unknown => mocks.issue_get_body.mockResolvedValue(undefined),
	},
	{
		name: 'commits beyond main',
		arrange: (): unknown => mocks.commit_count_beyond.mockResolvedValue(1),
	},
	{
		name: 'uncommitted changes',
		arrange: (): unknown => mocks.status.mockResolvedValue(' M a.ts\n'),
	},
	{ name: 'a pull request', arrange: (): unknown => mocks.pr_exists.mockResolvedValue(true) },
	{
		name: 'an unreadable branch',
		arrange: (): unknown => mocks.commit_count_beyond.mockRejectedValue(new Error('bad revision')),
	},
	{
		name: 'an unreadable pull request',
		arrange: (): unknown => mocks.pr_exists.mockRejectedValue(new Error('gh down')),
	},
]

describe('issue_premise_unmet_cli.run — refused with nothing written', () => {
	it.each(REFUSALS)('refuses $name', async ({ arrange }) => {
		arrange()

		const code = await issue_premise_unmet_cli.run([ISSUE, FLAG, EVIDENCE_FILE])

		expect(code).toBe(1)
		expect(calls).toStrictEqual([])
		expect(console.error).toHaveBeenCalledWith(expect.stringContaining('nothing written'))
	})
})

describe('issue_premise_unmet_cli.run — admitted', () => {
	it('comments, closes as not planned, then releases', async () => {
		const code = await issue_premise_unmet_cli.run([ISSUE, FLAG, EVIDENCE_FILE])

		expect(code).toBe(0)
		expect(calls).toStrictEqual(['comment', 'close', 'release'])
		expect(mocks.issue_close).toHaveBeenCalledWith(ISSUE, undefined, 'not_planned')
		expect(mocks.release).toHaveBeenCalledWith(['--release', ISSUE])
		expect(mocks.commit_count_beyond).toHaveBeenCalledWith('origin/main', `${ISSUE}-lane`)
		expect(mocks.status).toHaveBeenCalledWith(path.join('/lanes', ISSUE))
		expect(mocks.close_completed_epics).toHaveBeenCalledWith({
			issue_number: ISSUE,
			is_merged: true,
		})
	})

	it('stops at a failed close and names it, leaving the hold', async () => {
		mocks.issue_close.mockImplementation(async () => {
			record('close')

			return false
		})

		const code = await issue_premise_unmet_cli.run([ISSUE, FLAG, EVIDENCE_FILE])

		expect(code).toBe(1)
		expect(calls).toStrictEqual(['comment', 'close'])
		expect(console.error).toHaveBeenCalledWith(expect.stringContaining('not-planned close failed'))
		expect(mocks.close_completed_epics).not.toHaveBeenCalled()
	})

	it('stops at a failed comment, before the close', async () => {
		mocks.issue_comment.mockRejectedValue(new Error('gh down'))

		const code = await issue_premise_unmet_cli.run([ISSUE, FLAG, EVIDENCE_FILE])

		expect(code).toBe(1)
		expect(calls).toStrictEqual([])
		expect(console.error).toHaveBeenCalledWith(
			expect.stringContaining('Evidence comment not posted'),
		)
	})
})
