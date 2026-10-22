import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { issue_evidence_exit } from './issue-evidence-exit'

// joshuafolkken/kit#4475: the shape `issue:already-done` and `issue:measured` share — the evidence
// comment, the exit's own finishing write, then the release. The writes are mocked so the order and
// the stop on a failed step are read back.

const { issue_comment, release } = vi.hoisted(() => ({
	issue_comment: vi.fn<(issue_number: string, body: string) => Promise<string>>(),
	release: vi.fn<(argv: ReadonlyArray<string>) => Promise<number>>(),
}))

vi.mock('#scripts/gh/git-gh-command', () => ({ git_gh_command: { issue_comment } }))
vi.mock('#scripts/run/hold/run-hold-cli', () => ({ run_hold_cli: { run: release } }))

const ISSUE = '4475'
const FLAG = '--evidence-file'
const COMMAND = 'issue:example'
const work = mkdtempSync(path.join(tmpdir(), 'issue-evidence-exit-'))
const EVIDENCE_FILE = path.join(work, 'evidence.md')

writeFileSync(EVIDENCE_FILE, '  evidence\n')

const calls: Array<string> = []
const finish = vi.fn<(issue_number: string) => Promise<boolean>>()

beforeEach(() => {
	calls.length = 0
	issue_comment.mockReset().mockImplementation(async () => {
		calls.push('comment')

		return 'url'
	})
	finish.mockReset().mockImplementation(async () => {
		calls.push('finish')

		return true
	})
	release.mockReset().mockImplementation(async () => {
		calls.push('release')

		return 0
	})
	vi.spyOn(console, 'info').mockImplementation(() => undefined)
	vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
	vi.restoreAllMocks()
})

afterAll(() => {
	rmSync(work, { recursive: true, force: true })
})

describe('issue_evidence_exit.run', () => {
	it('posts the trimmed evidence, then finishes, then releases', async () => {
		const code = await issue_evidence_exit.run([ISSUE, FLAG, EVIDENCE_FILE], {
			command: COMMAND,
			finish,
		})

		expect(code).toBe(0)
		expect(calls).toStrictEqual(['comment', 'finish', 'release'])
		expect(issue_comment).toHaveBeenCalledWith(ISSUE, 'evidence')
		expect(finish).toHaveBeenCalledWith(ISSUE)
	})

	it('releases nothing when the finishing write fails', async () => {
		finish.mockResolvedValue(false)

		expect(
			await issue_evidence_exit.run([ISSUE, FLAG, EVIDENCE_FILE], { command: COMMAND, finish }),
		).toBe(1)
		expect(release).not.toHaveBeenCalled()
	})

	it('names the calling command in the usage line', async () => {
		const errors: Array<string> = []

		vi.spyOn(console, 'error').mockImplementation((line: unknown) => {
			errors.push(String(line))
		})

		expect(await issue_evidence_exit.run([ISSUE], { command: COMMAND, finish })).toBe(1)
		expect(errors).toStrictEqual([`Usage: josh ${COMMAND} <issue-number> ${FLAG} <path>`])
		expect(calls).toStrictEqual([])
	})
})
