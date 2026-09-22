import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { issue_comment_cli } from './issue-comment-cli'

// joshuafolkken/kit#2304: the write side that was missing. The `gh api` call is mocked so the body the
// command would post is read back without touching GitHub, and a real temp file exercises the
// `--body-file` path the rule steers every caller toward.

const { issue_comment } = vi.hoisted(() => ({
	issue_comment: vi.fn<(issue_number: string, body: string) => Promise<string>>(),
}))

vi.mock('#scripts/git/git-gh-command', () => ({
	git_gh_command: { issue_comment },
}))

const COMMENT_URL = 'https://github.com/o/r/issues/5#issuecomment-1'
const BODY_FILE_FLAG = '--body-file'
const INLINE_BODY = 'a short note'
const FILE_BODY = 'park: needs a decision\n'
const work = mkdtempSync(path.join(tmpdir(), 'issue-comment-cli-'))
const BODY_FILE = path.join(work, 'body.md')

writeFileSync(BODY_FILE, FILE_BODY)

const printed: Array<string> = []
const errors: Array<string> = []

beforeEach(() => {
	printed.length = 0
	errors.length = 0
	issue_comment.mockReset()
	issue_comment.mockResolvedValue(COMMENT_URL)
	vi.spyOn(console, 'info').mockImplementation((line: unknown) => {
		printed.push(String(line))
	})
	vi.spyOn(console, 'error').mockImplementation((line: unknown) => {
		errors.push(String(line))
	})
})

afterEach(() => {
	vi.restoreAllMocks()
})

afterAll(() => {
	rmSync(work, { recursive: true, force: true })
})

describe('issue_comment_cli.run — posts one comment and prints its URL', () => {
	it('posts an inline --body and prints the returned URL', async () => {
		const code = await issue_comment_cli.run(['5', '--body', INLINE_BODY])

		expect(code).toBe(0)
		expect(issue_comment).toHaveBeenCalledWith('5', INLINE_BODY)
		expect(printed).toContain(COMMENT_URL)
	})

	it('reads the body from --body-file, so no shell evaluates it', async () => {
		const code = await issue_comment_cli.run(['5', BODY_FILE_FLAG, BODY_FILE])

		expect(code).toBe(0)
		expect(issue_comment).toHaveBeenCalledWith('5', FILE_BODY)
		expect(printed).toContain(COMMENT_URL)
	})
})

describe('issue_comment_cli.run — refuses a call it cannot post', () => {
	it('refuses a missing issue number with the usage line', async () => {
		const code = await issue_comment_cli.run(['--body', 'note'])

		expect(code).toBe(1)
		expect(issue_comment).not.toHaveBeenCalled()
		expect(errors).toContain(issue_comment_cli.USAGE)
	})

	it('refuses a malformed issue number', async () => {
		const code = await issue_comment_cli.run(['not-a-number', '--body', 'note'])

		expect(code).toBe(1)
		expect(issue_comment).not.toHaveBeenCalled()
	})

	it('refuses a call with no body at all', async () => {
		const code = await issue_comment_cli.run(['5'])

		expect(code).toBe(1)
		expect(issue_comment).not.toHaveBeenCalled()
		expect(errors).toContain(issue_comment_cli.USAGE)
	})

	it('refuses both body flags at once, printing the resolver message not the usage line', async () => {
		const code = await issue_comment_cli.run(['5', '--body', 'x', BODY_FILE_FLAG, BODY_FILE])

		expect(code).toBe(1)
		expect(issue_comment).not.toHaveBeenCalled()
		expect(errors.some((line) => line.includes('--body') && line.includes('not both'))).toBe(true)
	})
})
