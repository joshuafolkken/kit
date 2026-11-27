import { git_gh_command } from '#scripts/gh/git-gh-command'
import { AUTO_OK_LABEL, HANDOFF_IMPLEMENTING_LABEL } from '#scripts/issue/issue-labels'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WorkflowHandoff } from './run-handoff-args'
import { run_handoff_release } from './run-handoff-release'

// joshuafolkken/kit#9143: a refused `run:handoff fullrun <N>` ends the `fullrun new` child that filed
// <N>, so the `handoff:implementing` it filed with must not leave <N> stranded without `auto-ok`.

const ISSUE = '9143'
const NUMBERED = `fullrun #${ISSUE}`
const RUN_LANE = 'run:lane'
const NOT_NEEDED_BODY = '## 背景\n\n- 種別: 不具合\n- 人の判断: 不要\n'
const NEEDED_BODY = '## 背景\n\n- 種別: 不具合\n- 人の判断: 要\n'
const FULLRUN_NEW = 'fullrun new'
const HANDED_OFF = { JOSH_HANDOFF_CHILD: '1', JOSH_HANDOFF_KEYWORD: FULLRUN_NEW }

function handoff(line: string): WorkflowHandoff {
	return { kind: 'workflow', keyword: 'fullrun', line, brief_file: undefined }
}

function filed(labels: ReadonlyArray<string>, body = NOT_NEEDED_BODY): void {
	const raw = JSON.stringify({ labels: labels.map((name) => ({ name })), body })

	vi.spyOn(git_gh_command, 'issue_get_labels_and_body').mockResolvedValue(raw)
}

function writes(): {
	remove: ReturnType<typeof vi.fn>
	apply: ReturnType<typeof vi.fn>
} {
	return {
		remove: vi.spyOn(git_gh_command, 'issue_remove_label').mockResolvedValue(),
		apply: vi.spyOn(git_gh_command, 'issue_apply_label').mockResolvedValue({ is_applied: true }),
	}
}

afterEach(() => {
	vi.restoreAllMocks()
})

describe('run_handoff_release.release — a hand-off child whose own filing is refused', () => {
	it('lifts handoff:implementing, then applies the auto-ok the filing withheld', async () => {
		filed([RUN_LANE, HANDOFF_IMPLEMENTING_LABEL])
		const { remove, apply } = writes()

		const line = await run_handoff_release.release(handoff(NUMBERED), HANDED_OFF)

		expect(remove).toHaveBeenCalledWith(ISSUE, HANDOFF_IMPLEMENTING_LABEL)
		expect(apply).toHaveBeenCalledWith(ISSUE, AUTO_OK_LABEL)
		expect(line).toContain('auto-ok: applied')
	})

	it('lifts the label but applies no auto-ok to a body declaring judgement is needed', async () => {
		filed([RUN_LANE, HANDOFF_IMPLEMENTING_LABEL], NEEDED_BODY)
		const { remove, apply } = writes()

		await run_handoff_release.release(handoff(NUMBERED), HANDED_OFF)

		expect(remove).toHaveBeenCalledOnce()
		expect(apply).not.toHaveBeenCalled()
	})
})

describe('run_handoff_release.release — nothing to release', () => {
	it.each([
		['a hand-off without a number', handoff(FULLRUN_NEW), HANDED_OFF],
		['a session that is no hand-off child', handoff(NUMBERED), {}],
	])('reads nothing for %s', async (_name, workflow, environment) => {
		const read = vi.spyOn(git_gh_command, 'issue_get_labels_and_body')

		expect(await run_handoff_release.release(workflow, environment)).toBeUndefined()
		expect(read).not.toHaveBeenCalled()
	})

	it('writes nothing to an issue without the label', async () => {
		filed([RUN_LANE, AUTO_OK_LABEL])
		const { remove } = writes()

		expect(await run_handoff_release.release(handoff(NUMBERED), HANDED_OFF)).toBeUndefined()
		expect(remove).not.toHaveBeenCalled()
	})
})
