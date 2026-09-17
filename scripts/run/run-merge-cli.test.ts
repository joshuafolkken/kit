import { CONTEXT_CUT_THRESHOLD } from '#scripts/cost-runtime/context-cut-threshold'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// joshuafolkken/kit#2024: the composite `run:merge` command, exercised end to end with the side-effect
// steps and the GitHub read mocked. The four branches the acceptance criteria name are each asserted —
// a merged child (under budget and over budget), a needs-decision child left parked, a failed child,
// and the failure guard tripping — plus the human-review stop and the unreadable-state retry.

const read_issue_mock = vi.hoisted(() => vi.fn())
const do_merged_mock = vi.hoisted(() => vi.fn())
const do_failed_mock = vi.hoisted(() => vi.fn())
const ask_next_mock = vi.hoisted(() => vi.fn())
const is_over_budget_mock = vi.hoisted(() => vi.fn())
const info_mock = vi.hoisted(() => vi.fn())

vi.mock('#scripts/issue/issue-state-cli', () => ({
	issue_state_cli: { read_issue: read_issue_mock },
}))

vi.mock('./run-merge-steps', () => ({
	run_merge_steps: {
		ask_next: ask_next_mock,
		do_failed: do_failed_mock,
		do_merged: do_merged_mock,
		is_over_budget: is_over_budget_mock,
	},
}))

const { run_merge_cli } = await import('./run-merge-cli')

const CHILD = '2024'
const REPO = 'joshuafolkken/kit'
const EPIC_ARGS = [CHILD, '--epic', '900', '--repo', REPO]
const NEXT = '2039'
const SUCCESS = 0
const FAILURE = 1
const BELOW_GUARD = 1
const AT_GUARD = 3
const CLOSED = 'CLOSED'
const OPEN = 'OPEN'
const IN_PROGRESS = 'in-progress'
const NEEDS_DECISION = 'needs-decision'
const NEEDS_HUMAN_REVIEW = 'needs-human-review'

function state_read(
	state: string,
	labels: ReadonlyArray<string>,
	is_human_review = false,
): unknown {
	return { kind: 'state', state: { state, labels, is_human_review } }
}

beforeEach(() => {
	read_issue_mock.mockReset()
	do_merged_mock.mockReset().mockResolvedValue(undefined)
	do_failed_mock.mockReset()
	ask_next_mock.mockReset().mockResolvedValue(NEXT)
	is_over_budget_mock.mockReset().mockResolvedValue(false)
	info_mock.mockReset()
	vi.spyOn(console, 'info').mockImplementation(info_mock)
})

describe('run_merge_cli.run — a merged child', () => {
	it('merges a closed child and offers the next', async () => {
		read_issue_mock.mockResolvedValue(state_read(CLOSED, []))

		expect(await run_merge_cli.run(EPIC_ARGS)).toBe(SUCCESS)
		expect(do_merged_mock).toHaveBeenCalledOnce()
		expect(info_mock).toHaveBeenCalledWith(NEXT)
	})

	it('hands off when the merge crosses the budget', async () => {
		read_issue_mock.mockResolvedValue(state_read(CLOSED, []))
		is_over_budget_mock.mockResolvedValue(true)

		expect(await run_merge_cli.run(EPIC_ARGS)).toBe(SUCCESS)
		expect(info_mock).toHaveBeenCalledWith(run_merge_cli.OVER_TOKEN)
	})
})

describe('run_merge_cli.run — a child that did not merge', () => {
	it('leaves a needs-decision child parked without merging it', async () => {
		read_issue_mock.mockResolvedValue(state_read(OPEN, [NEEDS_DECISION]))

		expect(await run_merge_cli.run(EPIC_ARGS)).toBe(SUCCESS)
		expect(do_merged_mock).not.toHaveBeenCalled()
		expect(ask_next_mock).toHaveBeenCalledOnce()
	})

	it('parks a failed or budget-exhausted worker once without retrying it', async () => {
		read_issue_mock.mockResolvedValue(state_read(OPEN, [IN_PROGRESS]))
		do_failed_mock.mockResolvedValue({ carry: { failures: BELOW_GUARD }, is_parked: true })

		expect(await run_merge_cli.run(EPIC_ARGS)).toBe(SUCCESS)
		expect(do_failed_mock).toHaveBeenCalledOnce()
		expect(ask_next_mock).toHaveBeenCalledOnce()
		expect(info_mock).toHaveBeenCalledWith(NEXT)
	})

	it('stops when the failure guard trips', async () => {
		read_issue_mock.mockResolvedValue(state_read(OPEN, [IN_PROGRESS]))
		do_failed_mock.mockResolvedValue({ carry: { failures: AT_GUARD }, is_parked: true })

		expect(await run_merge_cli.run(EPIC_ARGS)).toBe(SUCCESS)
		expect(info_mock).toHaveBeenCalledWith(run_merge_cli.STOP_TOKEN)
		expect(ask_next_mock).not.toHaveBeenCalled()
	})

	it('stops with an error when the failed child could not be parked', async () => {
		read_issue_mock.mockResolvedValue(state_read(OPEN, [IN_PROGRESS]))
		do_failed_mock.mockResolvedValue({ carry: { failures: BELOW_GUARD }, is_parked: false })

		expect(await run_merge_cli.run(EPIC_ARGS)).toBe(FAILURE)
		expect(info_mock).toHaveBeenCalledWith(run_merge_cli.STOP_TOKEN)
		expect(ask_next_mock).not.toHaveBeenCalled()
	})
})

describe('run_merge_cli.run — a stop and a refusal', () => {
	it('stops for a human-review child without offering more', async () => {
		read_issue_mock.mockResolvedValue(state_read(OPEN, [NEEDS_HUMAN_REVIEW], true))

		expect(await run_merge_cli.run(EPIC_ARGS)).toBe(SUCCESS)
		expect(info_mock).toHaveBeenCalledWith(run_merge_cli.HUMAN_REVIEW_TOKEN)
		expect(ask_next_mock).not.toHaveBeenCalled()
	})

	it('asks to retry when the child state cannot be read', async () => {
		read_issue_mock.mockResolvedValue({ kind: 'unreadable' })

		expect(await run_merge_cli.run(EPIC_ARGS)).toBe(FAILURE)
		expect(info_mock).toHaveBeenCalledWith(run_merge_cli.RETRY_TOKEN)
	})

	it('uses the shared threshold without a numeric argument', () => {
		expect(run_merge_cli.parse([CHILD])?.over).toBe(CONTEXT_CUT_THRESHOLD)
	})

	it('accepts but ignores an in-flight legacy threshold', () => {
		expect(run_merge_cli.parse([CHILD, '--over', '300000'])?.over).toBe(CONTEXT_CUT_THRESHOLD)
		expect(run_merge_cli.parse([CHILD, '--over', '1'])?.over).toBe(CONTEXT_CUT_THRESHOLD)
	})

	it('keeps legacy threshold parsing strict', () => {
		expect(run_merge_cli.parse([CHILD, '--over', 'invalid'])).toBeUndefined()
	})
})

describe('run_merge_cli.parse — sanitizes subprocess-bound arguments', () => {
	it('refuses an epic that is not an issue number', () => {
		const argv = [CHILD, '--epic', 'evil', '--repo', REPO]

		expect(run_merge_cli.parse(argv)).toBeUndefined()
	})

	it('refuses a repository that is not an owner/repo slug', () => {
		const argv = [CHILD, '--epic', '900', '--repo=--force']

		expect(run_merge_cli.parse(argv)).toBeUndefined()
	})

	it('refuses an option-shaped slug whose half starts with a hyphen', () => {
		const argv = [CHILD, '--epic', '900', '--repo=--evil/x']

		expect(run_merge_cli.parse(argv)).toBeUndefined()
	})

	it('accepts a well-formed epic and repository', () => {
		expect(run_merge_cli.parse(EPIC_ARGS)?.repo).toBe(REPO)
	})
})
