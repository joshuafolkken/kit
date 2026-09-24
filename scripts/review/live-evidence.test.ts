import { describe, expect, it, vi } from 'vitest'
import { live_evidence } from './live-evidence'

// joshuafolkken/kit#2446. A runtime change needs an evidence section of `command + actual output`;
// which change is runtime is `test:declared`'s classification, and the section is read by the same
// parser as `issue:lint`'s reproduction section.

const diff_mock = vi.hoisted(() => vi.fn<() => Promise<string>>())
const body_mock = vi.hoisted(() => vi.fn<() => Promise<string | undefined>>())

const branch_mock = vi.hoisted(() => vi.fn<() => Promise<string>>())

vi.mock('#scripts/git/git-command', () => ({
	git_command: { diff_main_names: diff_mock, branch: branch_mock },
}))
vi.mock('#scripts/git/git-gh-command', () => ({ git_gh_command: { pr_get_body: body_mock } }))

const RUNTIME_PATHS = ['scripts/review/live-evidence.ts', 'scripts/review/live-evidence.test.ts']
const DOCS_PATHS = ['docs/josh-commands.md', 'prompts/review.md']
const COMMAND = '- `pnpm josh followup`'
const CLOSES = 'closes #2446'

function body_with(section_lines: ReadonlyArray<string>): string {
	return [CLOSES, '', live_evidence.EVIDENCE_HEADING, '', ...section_lines].join('\n')
}

describe('live_evidence.verdict_for', () => {
	it('exempts a change with no runtime path, whatever the body says', () => {
		expect(live_evidence.verdict_for(DOCS_PATHS, undefined)).toBe('exempt')
	})

	it('requires evidence when a runtime path changed and the body has no section', () => {
		expect(live_evidence.verdict_for(RUNTIME_PATHS, CLOSES)).toBe('required')
	})

	it('requires evidence when the body is empty', () => {
		expect(live_evidence.verdict_for(RUNTIME_PATHS, undefined)).toBe('required')
	})

	it('refuses a section written in prose', () => {
		const body = body_with(['実環境で動くことを確認した'])

		expect(live_evidence.verdict_for(RUNTIME_PATHS, body)).toBe('required')
	})

	it('refuses a command with no fenced output', () => {
		expect(live_evidence.verdict_for(RUNTIME_PATHS, body_with([COMMAND]))).toBe('required')
	})

	it('accepts a command followed by its fenced output', () => {
		const body = body_with([COMMAND, '', '```', 'Merge refused: …', '```'])

		expect(live_evidence.verdict_for(RUNTIME_PATHS, body)).toBe('satisfied')
	})

	it('does not read the reproduction section as evidence', () => {
		const body = ['## 再現', '', COMMAND, '', '```', 'out', '```'].join('\n')

		expect(live_evidence.verdict_for(RUNTIME_PATHS, body)).toBe('required')
	})
})

describe('live_evidence.check', () => {
	it('reads the branch diff and the pull request body of the named branch', async () => {
		branch_mock.mockResolvedValueOnce('2446-lane')
		diff_mock.mockResolvedValueOnce(`${RUNTIME_PATHS.join('\n')}\n`)
		body_mock.mockResolvedValueOnce(CLOSES)

		await expect(live_evidence.check('2446-lane')).resolves.toBe('required')
		expect(body_mock).toHaveBeenCalledWith('2446-lane')
	})

	it('answers exempt for a docs-only branch', async () => {
		branch_mock.mockResolvedValueOnce('docs-lane')
		diff_mock.mockResolvedValueOnce(DOCS_PATHS.join('\n'))
		body_mock.mockResolvedValueOnce(undefined)

		await expect(live_evidence.check('docs-lane')).resolves.toBe('exempt')
	})

	// A checkout on another branch would read its own (possibly empty) diff as the named branch's.
	it('refuses a branch that is not the one checked out', async () => {
		branch_mock.mockResolvedValueOnce('main')
		diff_mock.mockClear()

		await expect(live_evidence.check('2446-lane')).rejects.toThrow('run followup from 2446-lane')
		expect(diff_mock).not.toHaveBeenCalled()
	})
})

describe('live_evidence.refusal_message', () => {
	it('names the section the body is missing', () => {
		expect(live_evidence.refusal_message()).toContain(live_evidence.EVIDENCE_HEADING)
	})
})
