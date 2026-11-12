import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const get_body_mock = vi.hoisted(() =>
	vi.fn<(issue_number: string) => Promise<string | undefined>>(),
)
const read_block_mock = vi.hoisted(() => vi.fn())
const ahead_mock = vi.hoisted(() => vi.fn())
const info_mock = vi.hoisted(() => vi.fn())
const error_mock = vi.hoisted(() => vi.fn())

vi.mock('#scripts/gh/git-gh-issue-read', () => ({
	git_gh_issue_read: { issue_get_body: get_body_mock },
}))

vi.mock('#scripts/issue/issue-read-cli', () => ({
	issue_read_cli: { read_block: read_block_mock },
}))

vi.mock('#scripts/run/ship/run-ship-preflight', () => ({
	run_ship_preflight: { ahead: ahead_mock },
}))

const { issue_read } = await import('#scripts/issue/issue-read')
const { run_prep_cli } = await import('./run-prep-cli')

const SUCCESS = 0
const FAILURE = 1
const ISSUE = '5564'
const SUMMARY = '--summary'
const BODY = ['## 受け入れ条件', '', '- [ ] one', '- [ ] two'].join('\n')

function trusted_block(is_body_trusted: boolean | undefined): unknown {
	return { kind: 'ok', block: '', trust: { is_body_trusted, has_trusted_comment: false } }
}

function printed(): string {
	return String(info_mock.mock.calls[0]?.[0])
}

beforeEach(() => {
	get_body_mock.mockReset()
	read_block_mock.mockReset().mockResolvedValue(trusted_block(true))
	ahead_mock.mockReset()
	info_mock.mockReset()
	error_mock.mockReset()
	vi.spyOn(console, 'info').mockImplementation(info_mock)
	vi.spyOn(console, 'error').mockImplementation(error_mock)
})

afterEach(() => {
	vi.restoreAllMocks()
})

describe('run_prep_cli.run --summary', () => {
	it('prints the skeleton from the body alone and skips the bundle', async () => {
		get_body_mock.mockResolvedValue(BODY)

		expect(await run_prep_cli.run([ISSUE, SUMMARY])).toBe(SUCCESS)
		expect(get_body_mock).toHaveBeenCalledWith(ISSUE)
		expect(ahead_mock).not.toHaveBeenCalled()
		expect(printed()).toBe(
			['## Now', '', '## Change', '', '## Check', '- one', '  - test:', '- two', '  - test:'].join(
				'\n',
			),
		)
	})
})

describe('run_prep_cli.run --summary author trust', () => {
	it('marks a body whose author is not trusted', async () => {
		get_body_mock.mockResolvedValue(BODY)
		read_block_mock.mockResolvedValue(trusted_block(false))

		await run_prep_cli.run([ISSUE, SUMMARY])

		expect(printed().startsWith(`${issue_read.UNTRUSTED_BODY_HEADING}\n`)).toBe(true)
	})

	it('marks the body when the trust read failed', async () => {
		get_body_mock.mockResolvedValue(BODY)
		read_block_mock.mockResolvedValue({ kind: 'unreadable' })

		expect(await run_prep_cli.run([ISSUE, SUMMARY])).toBe(SUCCESS)
		expect(printed()).toContain(issue_read.UNTRUSTED_BODY_HEADING)
	})
})

describe('run_prep_cli.run --summary arguments', () => {
	it('accepts the flag before the issue number', async () => {
		get_body_mock.mockResolvedValue(BODY)

		expect(await run_prep_cli.run([SUMMARY, ISSUE])).toBe(SUCCESS)
	})

	it('fails when the body cannot be read', async () => {
		get_body_mock.mockResolvedValue(undefined)

		expect(await run_prep_cli.run([ISSUE, SUMMARY])).toBe(FAILURE)
		expect(info_mock).not.toHaveBeenCalled()
		expect(String(error_mock.mock.calls[0]?.[0])).toContain('unreadable')
	})

	it('refuses the flag without an issue number', async () => {
		expect(await run_prep_cli.run([SUMMARY])).toBe(FAILURE)
		expect(String(error_mock.mock.calls[0]?.[0])).toContain(SUMMARY)
	})
})
