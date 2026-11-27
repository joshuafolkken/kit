import { git_gh_issue_read } from '#scripts/gh/git-gh-issue-read'
import { git_gh_issue_write } from '#scripts/gh/git-gh-issue-write'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { run_handoff_wip } from './run-handoff-wip'

vi.mock('#scripts/gh/git-gh-issue-read', () => ({
	git_gh_issue_read: { issue_get_body_classified: vi.fn() },
}))
vi.mock('#scripts/gh/git-gh-issue-write', () => ({
	git_gh_issue_write: { issue_edit_body: vi.fn() },
}))

const SHA = 'abc1234def'
const ROW = { branch: 'wip/x', sha: SHA }
const ROW_LINE = `- 取り込むブランチ: wip/x @ ${SHA}`
const BODY = ['## 背景', '', '- 種別: 非不具合', ''].join('\n')
const UNREACHABLE = { kind: 'unreadable', reason: 'unreachable', status: undefined } as const
const NEW_LINE = 'fullrun new'
const ISSUE_LINE = 'fullrun #42'

function ports(problem?: string): {
	resolve: () => Promise<string | undefined>
	write_row: ReturnType<typeof vi.fn<(issue: string) => Promise<string | undefined>>>
} {
	return {
		resolve: async () => SHA,
		write_row: vi.fn<(issue: string) => Promise<string | undefined>>(async () => problem),
	}
}

function mock_body(text: string): void {
	vi.mocked(git_gh_issue_read.issue_get_body_classified).mockResolvedValue({ kind: 'read', text })
}

describe('run_handoff_wip.environment_of', () => {
	it('hands down nothing without --wip', async () => {
		const result = await run_handoff_wip.environment_of({ line: NEW_LINE }, ports())

		expect(result).toStrictEqual({ environment: {} })
	})

	it('refuses a branch naming no commit', async () => {
		const handoff = { wip: 'wip/none', line: NEW_LINE }
		const result = await run_handoff_wip.environment_of(handoff, {
			...ports(),
			resolve: async () => undefined,
		})

		expect(result).toStrictEqual({ problem: '--wip: no branch wip/none in this repository' })
	})

	it('hands down the branch with the commit it resolves to on a new line', async () => {
		const result = await run_handoff_wip.environment_of({ wip: 'wip/x', line: NEW_LINE }, ports())

		expect(result).toStrictEqual({ environment: { JOSH_HANDOFF_WIP: `wip/x@${SHA}` } })
	})
})

describe('run_handoff_wip.environment_of on a line naming an Issue', () => {
	it('writes the row into the one named Issue and hands down nothing', async () => {
		const fake = ports()
		const result = await run_handoff_wip.environment_of({ wip: 'wip/x', line: ISSUE_LINE }, fake)

		expect(result).toStrictEqual({ environment: {} })
		expect(fake.write_row).toHaveBeenCalledWith('42', ROW)
	})

	it('refuses when the named Issue could not take the row', async () => {
		const handoff = { wip: 'wip/x', line: ISSUE_LINE }
		const result = await run_handoff_wip.environment_of(handoff, ports('no body'))

		expect(result).toStrictEqual({ problem: '--wip: no body' })
	})

	it.each(['fullrun #1 #2', 'kickoff', 'prrun 1x'])(
		'refuses --wip on %s, which names neither new nor one Issue',
		async (line) => {
			const fake = ports()
			const result = await run_handoff_wip.environment_of({ wip: 'wip/x', line }, fake)

			expect(result).toStrictEqual({ problem: '--wip needs `new` or one #N on the line' })
			expect(fake.write_row).not.toHaveBeenCalled()
		},
	)
})

describe('run_handoff_wip.write_row', () => {
	beforeEach(() => {
		vi.mocked(git_gh_issue_write.issue_edit_body).mockReset()
	})

	it('writes the row into a body without one', async () => {
		mock_body(BODY)

		await expect(run_handoff_wip.write_row('42', ROW)).resolves.toBeUndefined()
		expect(git_gh_issue_write.issue_edit_body).toHaveBeenCalledWith(
			'42',
			expect.stringContaining(ROW_LINE),
		)
	})

	it('leaves a body already naming the row untouched', async () => {
		mock_body(`${BODY}\n${ROW_LINE}`)

		await expect(run_handoff_wip.write_row('42', ROW)).resolves.toBeUndefined()
		expect(git_gh_issue_write.issue_edit_body).not.toHaveBeenCalled()
	})

	it('answers a problem when the body names another row', async () => {
		mock_body(`${BODY}\n- 取り込むブランチ: wip/y @ fff9999`)

		await expect(run_handoff_wip.write_row('42', ROW)).resolves.toContain('wip/y')
	})

	it('answers a problem when the body could not be read', async () => {
		vi.mocked(git_gh_issue_read.issue_get_body_classified).mockResolvedValue(UNREACHABLE)

		await expect(run_handoff_wip.write_row('42', ROW)).resolves.toContain('could not read')
	})

	it('answers a problem when the write fails', async () => {
		mock_body(BODY)
		vi.mocked(git_gh_issue_write.issue_edit_body).mockRejectedValue(new Error('denied'))

		await expect(run_handoff_wip.write_row('42', ROW)).resolves.toContain('denied')
	})
})

describe('run_handoff_wip.rewrite_row', () => {
	beforeEach(() => {
		vi.mocked(git_gh_issue_write.issue_edit_body).mockReset()
	})

	it('replaces the row the body names with the new one', async () => {
		mock_body(`${BODY}\n- 取り込むブランチ: wip/y @ fff9999`)

		await expect(run_handoff_wip.rewrite_row('42', ROW)).resolves.toBeUndefined()

		const written = vi.mocked(git_gh_issue_write.issue_edit_body).mock.calls[0]?.[1]

		expect(written).toContain(ROW_LINE)
		expect(written).not.toContain('wip/y')
	})
})

describe('run_handoff_wip.with_environment', () => {
	it('adds the environment to the launch request', () => {
		const request = { argv: { command: 'claude', args: [] }, cwd: '/repo', env: { A: '1' } }
		const result = run_handoff_wip.with_environment(request, { B: '2' })

		expect(result.env).toStrictEqual({ A: '1', B: '2' })
	})
})
