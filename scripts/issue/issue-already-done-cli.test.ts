import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { temporary_directory } from '#tools/test/temporary-directory'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { issue_already_done_cli } from './issue-already-done-cli'

// joshuafolkken/kit#4130: the already-merged exit as one command. The GitHub writes and the hold
// release are mocked, so the order they run in — and where a failure stops it — is read back.
// joshuafolkken/kit#7079: evidence citing the merge closes the issue; evidence citing none labels it.

const { issue_comment, issue_apply_label, issue_close, issue_get_body, release } = vi.hoisted(
	() => ({
		issue_get_body: vi.fn<(issue_number: string) => Promise<string | undefined>>(),
		issue_comment: vi.fn<(issue_number: string, body: string) => Promise<string>>(),
		issue_apply_label:
			vi.fn<
				(
					issue_number: string,
					label: string,
				) => Promise<{ is_applied: true } | { is_applied: false; reason: string }>
			>(),
		issue_close:
			vi.fn<
				(issue_number: string, comment: string | undefined, reason?: string) => Promise<boolean>
			>(),
		release: vi.fn<(argv: ReadonlyArray<string>) => Promise<number>>(),
	}),
)

vi.mock('#scripts/gh/git-gh-command', () => ({
	git_gh_command: { issue_comment, issue_apply_label, issue_close, issue_get_body },
}))

vi.mock('#scripts/run/hold/run-hold-cli', () => ({ run_hold_cli: { run: release } }))

// joshuafolkken/kit#7093: whether the evidence checks is `already-done-citation.ts`'s own question
// (its suite reads GitHub's answers); here it answers a merged pull request unless a test refuses.
const { close_refusal } = vi.hoisted(() => ({
	close_refusal: vi.fn<(evidence: string) => Promise<string | undefined>>(),
}))

vi.mock('#scripts/issue/already-done-citation', () => ({
	already_done_citation: { close_refusal },
}))

const ISSUE = '4130'
const FLAG = '--evidence-file'
const EVIDENCE = 'merged in #4000\n- criterion 1: scripts/a.ts:12\n'
const make_directory = temporary_directory('suite')
const work = make_directory('issue-already-done-cli-')
const EVIDENCE_FILE = path.join(work, 'evidence.md')
const UNCITED_FILE = path.join(work, 'uncited.md')
const EMPTY_FILE = path.join(work, 'empty.md')
const LABEL = 'already-done'
const REFUSAL = '#4000 is not merged'

// joshuafolkken/kit#4504: the body of #4446, the follow-up measurement a lane exited here instead
// of with `issue:measured`.
const SAMPLE_WAIT = '- 実施可能条件: #4448 のマージ後 30 マージ'
const MEASUREMENT_BODY = [
	'<!-- josh:run -->',
	'## 背景',
	'',
	'- 種別: 非不具合',
	'- 目的: 効果測定',
	'- 人の判断: 不要',
	'- 優先度: 通常',
	SAMPLE_WAIT,
	'',
	'parent: #4317',
].join('\n')
const WORK_BODY = '## 背景\n\n- 種別: 不具合\n- 優先度: 通常\n'

writeFileSync(EVIDENCE_FILE, EVIDENCE)
writeFileSync(UNCITED_FILE, '- criterion 1: scripts/a.ts:12\n')
writeFileSync(EMPTY_FILE, '  \n\n')

const calls: Array<string> = []

beforeEach(() => {
	calls.length = 0
	issue_comment.mockReset().mockImplementation(async () => {
		calls.push('comment')

		return 'https://github.com/o/r/issues/4130#issuecomment-1'
	})
	issue_apply_label.mockReset().mockImplementation(async () => {
		calls.push('label')

		return { is_applied: true }
	})
	release.mockReset().mockImplementation(async () => {
		calls.push('release')

		return 0
	})
	issue_close.mockReset().mockImplementation(async () => {
		calls.push('close')

		return true
	})
	issue_get_body.mockReset().mockResolvedValue(WORK_BODY)
	close_refusal.mockReset().mockResolvedValue(undefined)
	vi.spyOn(console, 'info').mockImplementation(() => undefined)
	vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
	vi.restoreAllMocks()
})

describe('issue_already_done_cli.run — the exit in order', () => {
	it('posts the evidence, labels it, closes it as completed, then releases the hold', async () => {
		const code = await issue_already_done_cli.run([ISSUE, FLAG, EVIDENCE_FILE])

		expect(code).toBe(0)
		expect(calls).toStrictEqual(['comment', 'label', 'close', 'release'])
		expect(issue_comment).toHaveBeenCalledWith(ISSUE, EVIDENCE.trim())
		expect(close_refusal).toHaveBeenCalledWith(EVIDENCE.trim())
		expect(issue_apply_label).toHaveBeenCalledWith(ISSUE, LABEL)
		expect(issue_close).toHaveBeenCalledWith(ISSUE, undefined, 'completed')
		expect(release).toHaveBeenCalledWith(['--release', ISSUE])
	})

	it('labels an issue whose evidence does not check and leaves it open, saying why', async () => {
		const infos: Array<string> = []

		close_refusal.mockResolvedValue(REFUSAL)
		vi.spyOn(console, 'info').mockImplementation((line: unknown) => {
			infos.push(String(line))
		})
		const code = await issue_already_done_cli.run([ISSUE, FLAG, UNCITED_FILE])

		expect(code).toBe(0)
		expect(calls).toStrictEqual(['comment', 'label', 'release'])
		expect(issue_apply_label).toHaveBeenCalledWith(ISSUE, LABEL)
		expect(issue_close).not.toHaveBeenCalled()
		expect(infos.join('\n')).toContain(REFUSAL)
	})

	it('answers the release exit code', async () => {
		release.mockResolvedValue(1)

		expect(await issue_already_done_cli.run([ISSUE, FLAG, EVIDENCE_FILE])).toBe(1)
	})
})

describe('issue_already_done_cli.run — a failure stops at its step', () => {
	it('applies no label and releases nothing when the comment fails', async () => {
		issue_comment.mockRejectedValue(new Error('HTTP 502'))

		const code = await issue_already_done_cli.run([ISSUE, FLAG, EVIDENCE_FILE])

		expect(code).toBe(1)
		expect(issue_apply_label).not.toHaveBeenCalled()
		expect(release).not.toHaveBeenCalled()
	})

	it('neither closes nor releases when the label is not applied', async () => {
		issue_apply_label.mockResolvedValue({ is_applied: false, reason: 'HTTP 403' })

		const code = await issue_already_done_cli.run([ISSUE, FLAG, EVIDENCE_FILE])

		expect(code).toBe(1)
		expect(calls).toStrictEqual(['comment'])
		expect(issue_close).not.toHaveBeenCalled()
		expect(release).not.toHaveBeenCalled()
	})

	it('leaves the labelled issue open for a person and releases it when the close fails', async () => {
		const errors: Array<string> = []

		issue_close.mockResolvedValue(false)
		vi.spyOn(console, 'error').mockImplementation((line: unknown) => {
			errors.push(String(line))
		})
		const code = await issue_already_done_cli.run([ISSUE, FLAG, EVIDENCE_FILE])

		expect(code).toBe(0)
		expect(calls).toStrictEqual(['comment', 'label', 'release'])
		expect(errors.join('\n')).toContain('the close failed')
	})
})

describe('issue_already_done_cli.run — refuses before writing anything', () => {
	it('names the empty evidence file it refused', async () => {
		const errors: Array<string> = []

		vi.spyOn(console, 'error').mockImplementation((line: unknown) => {
			errors.push(String(line))
		})
		await issue_already_done_cli.run([ISSUE, FLAG, EMPTY_FILE])

		expect(errors).toStrictEqual([`Evidence file is empty: ${EMPTY_FILE}`])
	})

	it.each([
		['an empty evidence file', [ISSUE, FLAG, EMPTY_FILE]],
		['a missing evidence file', [ISSUE, FLAG, path.join(work, 'absent.md')]],
		['no evidence flag', [ISSUE]],
		['a malformed issue number', ['0', FLAG, EVIDENCE_FILE]],
		['an unknown flag', [ISSUE, FLAG, EVIDENCE_FILE, '--force']],
	])('refuses %s', async (_case, argv) => {
		const code = await issue_already_done_cli.run(argv)

		expect(code).toBe(1)
		expect(calls).toStrictEqual([])
	})
})

describe('issue_already_done_cli.run — a measurement-only issue is refused', () => {
	it('writes nothing and points to issue:measured', async () => {
		const errors: Array<string> = []

		issue_get_body.mockResolvedValue(MEASUREMENT_BODY)
		vi.spyOn(console, 'error').mockImplementation((line: unknown) => {
			errors.push(String(line))
		})
		const code = await issue_already_done_cli.run([ISSUE, FLAG, EVIDENCE_FILE])

		expect(code).toBe(1)
		expect(calls).toStrictEqual([])
		expect(errors.join('\n')).toContain(`josh issue:measured ${ISSUE} --evidence-file`)
	})

	it('ignores the declaration inside a code fence', async () => {
		issue_get_body.mockResolvedValue(`${WORK_BODY}\n\`\`\`\n${SAMPLE_WAIT}\n\`\`\`\n`)

		expect(await issue_already_done_cli.run([ISSUE, FLAG, EVIDENCE_FILE])).toBe(0)
	})

	it('writes nothing when the body cannot be read', async () => {
		issue_get_body.mockResolvedValue(undefined)

		expect(await issue_already_done_cli.run([ISSUE, FLAG, EVIDENCE_FILE])).toBe(1)
		expect(calls).toStrictEqual([])
	})
})
