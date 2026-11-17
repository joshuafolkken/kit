import { beforeEach, describe, expect, it, vi } from 'vitest'

const { order, closed, released } = vi.hoisted(() => ({
	order: new Array<string>(),
	closed: { ok: true },
	released: { code: 0 },
}))

function step<T>(name: string, value: () => T): () => Promise<T> {
	return async () => {
		order.push(name)

		return await value()
	}
}

vi.mock('#scripts/run/carry/run-carry', () => ({
	run_carry: {
		repository_directory: vi.fn(async () => '/repo/.git'),
		carry_path: vi.fn(() => '/repo/.git/carry'),
		read_carry: vi.fn(() => ({ kind: 'carried' })),
	},
}))
vi.mock('#scripts/issue/issue-state-cli', () => ({ issue_state_cli: { read_issue: vi.fn() } }))
vi.mock('#scripts/gh/git-gh-issue-read', () => ({
	git_gh_issue_read: { issue_list_comments: vi.fn(async () => '[]') },
}))
vi.mock('#scripts/issue/issue-read', () => ({
	issue_read: { parse_comments: vi.fn(async () => []), trusted_bodies: vi.fn() },
}))
vi.mock('#scripts/epic/epic-blocked-by', () => ({
	epic_blocked_by: { listing_epics: vi.fn(async () => [7700]), record: vi.fn() },
}))
vi.mock('#scripts/epic/epic-decide', () => ({
	epic_decide: { decide: vi.fn(step('decide', () => 0)) },
}))
vi.mock('#scripts/run/park/run-park', () => ({
	run_park: {
		clear: vi.fn(() => {
			order.push('clear')
		}),
	},
}))
vi.mock('#scripts/josh/josh-run', () => ({
	josh_command: { josh_run: vi.fn(step('run:add', () => ({ code: 0 }))) },
}))
vi.mock('#scripts/gh/git-gh-command', () => ({
	git_gh_command: { issue_close: vi.fn(step('close', () => closed.ok)) },
}))
vi.mock('#scripts/epic/epic-close', () => ({
	epic_close: { close_completed_epics: vi.fn(step('epics', () => undefined)) },
}))
vi.mock('#scripts/run/park/run-park-release', () => ({
	run_park_release: { release: vi.fn(step('release', () => released.code)) },
}))
vi.mock('./backlog-triage-filing', () => ({
	backlog_triage_filing: { problem_of: vi.fn(async () => undefined), block: vi.fn() },
}))

const { issue_read } = await import('#scripts/issue/issue-read')
const { git_gh_command } = await import('#scripts/gh/git-gh-command')
const { run_park_release } = await import('#scripts/run/park/run-park-release')
const { backlog_triage_cli } = await import('./backlog-triage-cli')
const { backlog_triage_close } = await import('./backlog-triage-close')

const ISSUE = '7732'
const REASON = 'nothing left to improve'
const CLOSE = '親（issue:close）'
const FILE_AND_CLOSE = '親（issue:file のあと issue:close）'

function park_with(permission: string): string {
	const option = [
		'1. Close it without implementing',
		'   - 層: A',
		`   - 必要な権限: ${permission}`,
	]

	return ['## Close it?', '### 選択肢', ...option, '### 推奨', '1 nothing to improve'].join('\n')
}

async function adopt(permission: string, ...extra: ReadonlyArray<string>): Promise<number> {
	vi.mocked(issue_read.trusted_bodies).mockReturnValue([park_with(permission)])

	return await backlog_triage_cli.run(
		['--apply', ISSUE, '--adopt', '1', '--reason', REASON, ...extra],
		'/repo',
	)
}

beforeEach(() => {
	order.length = 0
	closed.ok = true
	released.code = 0
	vi.spyOn(console, 'info').mockReturnValue()
	vi.spyOn(console, 'error').mockReturnValue()
})

// joshuafolkken/kit#7805: an adopted closing option closes the Issue and returns the lane.
describe('backlog:triage --adopt a closing option', () => {
	it('closes the #7732-shaped park as not planned and returns the lane, never requeuing (ac-5ade9e72, ac-a190fb5b)', async () => {
		await expect(adopt(CLOSE)).resolves.toBe(0)

		expect(order).toStrictEqual(['decide', 'clear', 'close', 'epics', 'release'])
		expect(git_gh_command.issue_close).toHaveBeenCalledWith(
			ISSUE,
			expect.stringContaining(REASON),
			'not_planned',
		)
		expect(run_park_release.release).toHaveBeenCalledWith(ISSUE)
	})

	it('still asks a filing-and-closing option for --done, writing nothing without it', async () => {
		await expect(adopt(FILE_AND_CLOSE)).resolves.toBe(1)

		expect(order).toStrictEqual([])
	})

	it('closes a filing-and-closing option given --done, with no blocked-by', async () => {
		await expect(adopt(FILE_AND_CLOSE, '--done', 'filed #7800')).resolves.toBe(0)

		expect(order).toStrictEqual(['decide', 'clear', 'close', 'epics', 'release'])
	})

	it('refuses a failed close without requeuing it', async () => {
		closed.ok = false

		await expect(adopt(CLOSE)).resolves.toBe(1)

		expect(order).toStrictEqual(['decide', 'clear', 'close'])
	})

	it('names the release to run when only the release fails', async () => {
		released.code = 1

		await expect(adopt(CLOSE)).resolves.toBe(1)

		expect(console.error).toHaveBeenCalledWith(expect.stringContaining(`run:release ${ISSUE}`))
	})
})

// joshuafolkken/kit#7821: a no-diff investigation lane closes through the same path, as completed.
describe('backlog_triage_close.close_completed', () => {
	const DELIVERABLE = 'https://github.com/joshuafolkken/kit/issues/7780#issuecomment-1'

	it('closes as completed citing the deliverable, then closes epics and returns the lane (ac-54f096cd, ac-1b7874a6)', async () => {
		await expect(backlog_triage_close.close_completed(ISSUE, DELIVERABLE)).resolves.toStrictEqual({
			next: 'closed as completed · lane returned, not requeued',
		})

		expect(order).toStrictEqual(['close', 'epics', 'release'])
		expect(git_gh_command.issue_close).toHaveBeenCalledWith(
			ISSUE,
			expect.stringContaining(DELIVERABLE),
			'completed',
		)
	})

	it('keeps the adopt close not planned with its own comment', async () => {
		await backlog_triage_close.close(ISSUE, REASON)

		expect(git_gh_command.issue_close).toHaveBeenCalledWith(
			ISSUE,
			`Closed as not planned by an adopted park option (\`backlog:triage --adopt\`): ${REASON}`,
			'not_planned',
		)
	})

	it('names the failed close without releasing', async () => {
		closed.ok = false

		const result = await backlog_triage_close.close_completed(ISSUE, DELIVERABLE)

		expect(result).toStrictEqual({ problem: expect.stringContaining('re-run this command') })
		expect(order).toStrictEqual(['close'])
	})
})
