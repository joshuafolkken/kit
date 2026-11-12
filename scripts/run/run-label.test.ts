import { git_followup_label } from '#scripts/followup/git-followup-label'
import { git_gh_command } from '#scripts/gh/git-gh-command'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { run_label } from './run-label'
import { run_maintenance } from './run-maintenance'

vi.mock('./run-maintenance', () => ({ run_maintenance: { label: vi.fn() } }))
vi.mock('#scripts/followup/git-followup-label', () => ({
	git_followup_label: { strip_in_progress: vi.fn() },
}))

const ISSUE = '3182'
const add_label = vi.mocked(run_maintenance.label)
const strip = vi.mocked(git_followup_label.strip_in_progress)
const warnings: Array<string> = []
const clear_label = vi.spyOn(git_gh_command, 'issue_clear_label')
const apply_label = vi.spyOn(git_gh_command, 'issue_apply_label')

beforeEach(() => {
	warnings.length = 0
	vi.spyOn(console, 'warn').mockImplementation((line: string) => {
		warnings.push(line)
	})
	add_label.mockResolvedValue(true)
	strip.mockResolvedValue()
	clear_label.mockResolvedValue(true)
	apply_label.mockResolvedValue({ is_applied: true })
})

// joshuafolkken/kit#7313: a dispatched-back issue kept `needs-human-merge`, so its lane's review was refused.
describe('run_label.claim', () => {
	it('takes the needs-human-merge park off before it applies in-progress', async () => {
		expect(await run_label.claim(ISSUE)).toStrictEqual({ is_applied: true })
		expect(clear_label).toHaveBeenCalledWith(ISSUE, 'needs-human-merge')
		expect(apply_label).toHaveBeenCalledWith(ISSUE, 'in-progress')
		expect(warnings).toStrictEqual([])
	})

	it('warns with the manual call and still applies in-progress when the park stays on', async () => {
		clear_label.mockResolvedValue(false)

		expect(await run_label.claim(ISSUE)).toStrictEqual({ is_applied: true })
		expect(warnings.join('\n')).toContain('labels/needs-human-merge')
		expect(apply_label).toHaveBeenCalledOnce()
	})
})

describe('run_label.mark', () => {
	it('applies in-progress to the issue and warns about nothing', async () => {
		expect(await run_label.mark(ISSUE)).toBe(true)
		expect(add_label).toHaveBeenCalledWith(ISSUE)
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
