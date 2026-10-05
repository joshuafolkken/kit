import { git_followup_label } from '#scripts/followup/git-followup-label'
import { git_gh_command } from '#scripts/gh/git-gh-command'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { run_label } from './run-label'

vi.mock('#scripts/gh/git-gh-command', () => ({ git_gh_command: { issue_add_label: vi.fn() } }))
vi.mock('#scripts/followup/git-followup-label', () => ({
	git_followup_label: { strip_in_progress: vi.fn() },
}))

const ISSUE = '3182'
const add_label = vi.mocked(git_gh_command.issue_add_label)
const strip = vi.mocked(git_followup_label.strip_in_progress)
const warnings: Array<string> = []

beforeEach(() => {
	vi.clearAllMocks()
	warnings.length = 0
	vi.spyOn(console, 'warn').mockImplementation((line: string) => {
		warnings.push(line)
	})
	add_label.mockResolvedValue(true)
	strip.mockResolvedValue()
})

describe('run_label.mark', () => {
	it('applies in-progress to the issue and warns about nothing', async () => {
		expect(await run_label.mark(ISSUE)).toBe(true)
		expect(add_label).toHaveBeenCalledWith(ISSUE, 'in-progress')
		expect(warnings).toStrictEqual([])
	})

	it('warns with the manual call when the write is refused', async () => {
		add_label.mockResolvedValue(false)

		expect(await run_label.mark(ISSUE)).toBe(false)
		expect(warnings.join('\n')).toContain(`#${ISSUE}`)
		expect(warnings.join('\n')).toContain("labels[]=in-progress'")
	})
})

describe('run_label.unmark', () => {
	it('strips in-progress through the read-then-remove step followup uses', async () => {
		expect(await run_label.unmark(ISSUE)).toBe(true)
		expect(strip).toHaveBeenCalledWith(ISSUE)
		expect(warnings).toStrictEqual([])
	})

	it('warns with the manual call rather than throwing when the removal fails', async () => {
		strip.mockRejectedValue(new Error('gh api failed'))

		expect(await run_label.unmark(ISSUE)).toBe(false)
		expect(warnings.join('\n')).toContain('labels/in-progress')
	})
})
