import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { MEASURED_LABEL } from '#scripts/issue/issue-labels'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { issue_measured_cli } from './issue-measured-cli'

// joshuafolkken/kit#4475: a measurement-only issue completes by one command. The GitHub writes and
// the hold release are mocked, so the order they run in — and where a failure stops it — is read back.

const { issue_comment, issue_apply_label, issue_close, release } = vi.hoisted(() => ({
	issue_comment: vi.fn<(issue_number: string, body: string) => Promise<string>>(),
	issue_apply_label:
		vi.fn<
			(
				issue_number: string,
				label: string,
			) => Promise<{ is_applied: true } | { is_applied: false; reason: string }>
		>(),
	issue_close: vi.fn<(issue_number: string, comment: string | undefined) => Promise<boolean>>(),
	release: vi.fn<(argv: ReadonlyArray<string>) => Promise<number>>(),
}))

vi.mock('#scripts/gh/git-gh-command', () => ({
	git_gh_command: { issue_comment, issue_apply_label, issue_close },
}))

vi.mock('#scripts/run/hold/run-hold-cli', () => ({ run_hold_cli: { run: release } }))

const ISSUE = '4452'
const FLAG = '--evidence-file'
const EVIDENCE = '- criterion 1: CI run 123 — 4m12s\n'
const work = mkdtempSync(path.join(tmpdir(), 'issue-measured-cli-'))
const EVIDENCE_FILE = path.join(work, 'evidence.md')
const EMPTY_FILE = path.join(work, 'empty.md')

writeFileSync(EVIDENCE_FILE, EVIDENCE)
writeFileSync(EMPTY_FILE, '\n')

const calls: Array<string> = []

beforeEach(() => {
	calls.length = 0
	issue_comment.mockReset().mockImplementation(async () => {
		calls.push('comment')

		return 'https://github.com/o/r/issues/4452#issuecomment-1'
	})
	issue_close.mockReset().mockImplementation(async () => {
		calls.push('close')

		return true
	})
	release.mockReset().mockImplementation(async () => {
		calls.push('release')

		return 0
	})
	issue_apply_label.mockReset().mockImplementation(async () => {
		calls.push('label')

		return { is_applied: true }
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

describe('issue_measured_cli.run — the completion in order', () => {
	it('posts the result, labels it measured, closes it, then releases the hold', async () => {
		const code = await issue_measured_cli.run([ISSUE, FLAG, EVIDENCE_FILE])

		expect(code).toBe(0)
		expect(calls).toStrictEqual(['comment', 'label', 'close', 'release'])
		expect(issue_comment).toHaveBeenCalledWith(ISSUE, EVIDENCE.trim())
		expect(issue_apply_label).toHaveBeenCalledWith(ISSUE, MEASURED_LABEL)
		expect(issue_close).toHaveBeenCalledWith(ISSUE, undefined)
		expect(release).toHaveBeenCalledWith(['--release', ISSUE])
	})
})

describe('issue_measured_cli.run — a failure stops at its step', () => {
	it('closes nothing when the result comment fails', async () => {
		issue_comment.mockRejectedValue(new Error('HTTP 502'))

		expect(await issue_measured_cli.run([ISSUE, FLAG, EVIDENCE_FILE])).toBe(1)
		expect(issue_close).not.toHaveBeenCalled()
		expect(release).not.toHaveBeenCalled()
	})

	it('closes nothing when the label is not applied', async () => {
		issue_apply_label.mockResolvedValue({ is_applied: false, reason: 'HTTP 404' })

		expect(await issue_measured_cli.run([ISSUE, FLAG, EVIDENCE_FILE])).toBe(1)
		expect(calls).toStrictEqual(['comment'])
		expect(issue_close).not.toHaveBeenCalled()
	})

	it('releases nothing when the close fails', async () => {
		issue_close.mockResolvedValue(false)

		expect(await issue_measured_cli.run([ISSUE, FLAG, EVIDENCE_FILE])).toBe(1)
		expect(calls).toStrictEqual(['comment', 'label'])
	})
})

describe('issue_measured_cli.run — refuses before writing anything', () => {
	it.each([
		['an empty evidence file', [ISSUE, FLAG, EMPTY_FILE]],
		['no evidence flag', [ISSUE]],
		['a malformed issue number', ['0', FLAG, EVIDENCE_FILE]],
	])('refuses %s', async (_case, argv) => {
		expect(await issue_measured_cli.run(argv)).toBe(1)
		expect(calls).toStrictEqual([])
	})

	it('names its own command in the usage line', async () => {
		const errors: Array<string> = []

		vi.spyOn(console, 'error').mockImplementation((line: unknown) => {
			errors.push(String(line))
		})
		await issue_measured_cli.run([ISSUE])

		expect(errors).toStrictEqual([
			'Usage: josh issue:measured <issue-number> --evidence-file <path>',
		])
	})
})
