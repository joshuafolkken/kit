import { beforeEach, describe, expect, it, vi } from 'vitest'

const classified_mock = vi.hoisted(() => vi.fn())
const repo_name_mock = vi.hoisted(() => vi.fn())
const info_mock = vi.hoisted(() => vi.fn())
const error_mock = vi.hoisted(() => vi.fn())

vi.mock('#scripts/git/git-gh-command', () => ({
	git_gh_command: {
		issue_view_json_classified: classified_mock,
		repo_get_name_with_owner: repo_name_mock,
	},
}))

const { issue_cite_cli } = await import('./issue-cite-cli')

// `josh issue:cite` — the command that makes the correct citation form as cheap as the bare `#N`
// (joshuafolkken/kit#2220). The cases are the acceptance conditions: several numbers, another
// repository, and a number that could not be read.

const SUCCESS = 0
const FAILURE = 1
const LOCAL_REPO = 'joshuafolkken/kit'
const OTHER_REPO = 'joshuafolkken/app-kit'
const LOCAL_BASE = `https://github.com/${LOCAL_REPO}/issues`
const OTHER_BASE = `https://github.com/${OTHER_REPO}/issues`
const ISSUE_A = '2220'
const ISSUE_B = '1758'
const SERVER_ERROR_STATUS = 500
const UNREADABLE = {
	kind: 'unreadable',
	reason: 'unreachable',
	status: SERVER_ERROR_STATUS,
} as const

function title_read(title: string): { kind: 'read'; json: string } {
	return { kind: 'read', json: JSON.stringify({ title }) }
}

function printed(): string {
	return info_mock.mock.calls.map((call) => String(call[0])).join('\n')
}

function reported(): string {
	return error_mock.mock.calls.map((call) => String(call[0])).join('\n')
}

beforeEach(() => {
	classified_mock.mockReset()
	repo_name_mock.mockReset()
	repo_name_mock.mockResolvedValue(LOCAL_REPO)
	vi.spyOn(console, 'info').mockImplementation(info_mock)
	vi.spyOn(console, 'error').mockImplementation(error_mock)
	info_mock.mockReset()
	error_mock.mockReset()
})

describe('issue_cite_cli.parse_targets', () => {
	it('reads several numbers against the default repository', () => {
		expect(issue_cite_cli.parse_targets(['2220', '1758'], undefined)).toEqual([
			{ number: '2220', repo: undefined },
			{ number: '1758', repo: undefined },
		])
	})

	it('refuses the whole call when a token is not a number', () => {
		expect(issue_cite_cli.parse_targets(['2220', 'oops'], undefined)).toBeUndefined()
	})

	it('refuses an empty argument list', () => {
		expect(issue_cite_cli.parse_targets([], undefined)).toBeUndefined()
	})
})

describe('issue_cite_cli.run — the citation lines', () => {
	it('prints a paste-ready citation line per number, in order', async () => {
		classified_mock.mockImplementation(async (number: string) =>
			title_read(number === ISSUE_A ? 'First' : 'Second'),
		)

		const code = await issue_cite_cli.run([ISSUE_A, ISSUE_B])

		expect(code).toBe(SUCCESS)
		expect(printed()).toBe(
			`[#${ISSUE_A}](${LOCAL_BASE}/${ISSUE_A}) — First\n[#${ISSUE_B}](${LOCAL_BASE}/${ISSUE_B}) — Second`,
		)
	})

	it('cites another repository from --repo without reading the local one', async () => {
		classified_mock.mockResolvedValue(title_read('Cross-repo title'))

		const code = await issue_cite_cli.run(['45', '--repo', OTHER_REPO])

		expect(code).toBe(SUCCESS)
		expect(printed()).toContain(`${OTHER_BASE}/45`)
		expect(repo_name_mock).not.toHaveBeenCalled()
	})

	it('cites an owner/repo#N token against its own repository', async () => {
		classified_mock.mockResolvedValue(title_read('Qualified title'))

		await issue_cite_cli.run([`${OTHER_REPO}#45`])

		expect(printed()).toContain(`[#45](${OTHER_BASE}/45)`)
	})
})

describe('issue_cite_cli.run — the failures', () => {
	it('names an unreadable number on stderr and exits non-zero', async () => {
		classified_mock.mockImplementation(async (number: string) =>
			number === ISSUE_A ? title_read('Fine') : UNREADABLE,
		)

		const code = await issue_cite_cli.run([ISSUE_A, ISSUE_B])

		expect(code).toBe(FAILURE)
		expect(printed()).toContain(`/issues/${ISSUE_A}`)
		expect(reported()).toContain(`#${ISSUE_B}`)
		expect(reported()).toContain('could not be read')
	})

	it('names a number that resolves to nothing as missing', async () => {
		classified_mock.mockResolvedValue({ kind: 'missing' })

		const code = await issue_cite_cli.run(['999999'])

		expect(code).toBe(FAILURE)
		expect(reported()).toContain('does not resolve')
	})

	it('refuses a non-numeric token with usage', async () => {
		const code = await issue_cite_cli.run(['oops'])

		expect(code).toBe(FAILURE)
		expect(reported()).toContain(issue_cite_cli.USAGE)
	})
})
