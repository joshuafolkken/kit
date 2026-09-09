import {
	auto_ok_fixture,
	CREATED_LATER,
	EPIC_NUMBER,
	FAILURE_EXIT_CODE,
	SUCCESS_EXIT_CODE,
} from '#scripts/auto-ok/auto-ok-fixture'
import type { EpicChild } from '#scripts/epic/epic-graph'
import { epic_report } from '#scripts/epic/epic-report'
import { git_gh_command } from '#scripts/git/git-gh-command'
import {
	AUTO_OK_LABEL,
	EPIC_LABEL,
	IN_PROGRESS_LABEL,
	NEEDS_DECISION_LABEL,
} from '#scripts/git/issue-labels'
import type { OpenIssueData } from '#scripts/git/schemas'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { backlog_fixture } from './backlog-fixture'
import { backlog_plan, type PlanContext } from './backlog-plan'
import { backlog_plan_cli } from './backlog-plan-cli'
import { backlog_scope } from './backlog-scope'

// joshuafolkken/kit#1652: the plan a person reads before a `backlogrun` starts. Four sections, one
// ask — what may run in parallel, what is waiting and on which issue, what is waiting on a person,
// and what the backlog will not run at all.

const { issue, console_streams } = auto_ok_fixture

const READY_CHILD = 901
const BLOCKED_CHILD = 902
const PARKED_CHILD = 903
const OUTSIDER = 904
const CYCLE_MESSAGE = 'cycle: #901 → #902'

const streams = console_streams()
const { stdout, stderr } = streams

function open_row(number: number, labels: ReadonlyArray<string> = []): OpenIssueData {
	return issue(number, CREATED_LATER, labels)
}

function plan_context(open_numbers: ReadonlyArray<number>): PlanContext {
	return {
		repo: backlog_fixture.REPO,
		titles: new Map(),
		open_numbers: new Set(open_numbers),
	}
}

function epic_child(blockers: ReadonlyArray<number>, labels: ReadonlyArray<string>): EpicChild {
	return {
		number: BLOCKED_CHILD,
		repo: backlog_fixture.REPO,
		state: 'OPEN',
		labels: [...labels],
		blocked_by: blockers.map((number) => ({ repo: backlog_fixture.REPO, number })),
	}
}

// The one listing the plan reads beyond the pool: it carries the titles and the set the out-of-scope
// rows are subtracted from.
function stub_open(rows: ReadonlyArray<OpenIssueData>): void {
	vi.spyOn(git_gh_command, 'issue_list_recent').mockResolvedValue({
		json: JSON.stringify(rows),
		is_capped: false,
	})
}

// One epic, opted in at the root: a child free to start, a child waiting on it, and a child parked on
// a person. Beside them an open issue nobody opted in, which is what the out-of-scope half is for.
function stub_backlog(): void {
	backlog_fixture.stub_backlog({
		opted_in: [open_row(EPIC_NUMBER, [AUTO_OK_LABEL, EPIC_LABEL])],
		epics: [{ number: EPIC_NUMBER, children: [READY_CHILD, BLOCKED_CHILD, PARKED_CHILD] }],
		children: [
			{ number: READY_CHILD },
			{ number: BLOCKED_CHILD, blocked_by: [READY_CHILD] },
			{ number: PARKED_CHILD, labels: [NEEDS_DECISION_LABEL] },
		],
	})
	stub_open([
		open_row(EPIC_NUMBER, [AUTO_OK_LABEL, EPIC_LABEL]),
		open_row(READY_CHILD),
		open_row(BLOCKED_CHILD),
		open_row(PARKED_CHILD),
		open_row(OUTSIDER, []),
	])
}

beforeEach(() => {
	vi.restoreAllMocks()
	vi.spyOn(console, 'info').mockImplementation(streams.info)
	vi.spyOn(console, 'error').mockImplementation(streams.error)
	vi.spyOn(console, 'warn').mockImplementation(streams.error)
	streams.reset()
})

describe('the four sections a person reads before the run starts', () => {
	it('prints all four headings from one ask', async () => {
		stub_backlog()

		await backlog_plan_cli.run([])

		const plan = stdout()

		expect(plan).toContain(backlog_plan.READY_HEADING)
		expect(plan).toContain(backlog_plan.WAITING_HEADING)
		expect(plan).toContain(backlog_plan.HUMAN_HEADING)
		expect(plan).toContain(backlog_plan.SCOPE_HEADING)
	})

	it('names a ready child with its title so the plan reads without opening GitHub', async () => {
		stub_backlog()

		await backlog_plan_cli.run([])

		expect(stdout()).toContain(`#${String(READY_CHILD)}  issue ${String(READY_CHILD)}`)
	})

	it('answers success when the plan was rendered', async () => {
		stub_backlog()

		expect(await backlog_plan_cli.run([])).toBe(SUCCESS_EXIT_CODE)
	})
})

describe('what a waiting child is waiting on', () => {
	it('names the blocking issue rather than only saying it waits', async () => {
		stub_backlog()

		await backlog_plan_cli.run([])

		expect(stdout()).toContain(`waiting on #${String(READY_CHILD)}`)
	})

	it('reads the label before the edges, so a child a run holds is not called blocked', () => {
		const child = epic_child([READY_CHILD], [IN_PROGRESS_LABEL])

		expect(backlog_plan.waiting_note(child, plan_context([READY_CHILD]))).toBe(
			backlog_plan.IN_PROGRESS_NOTE,
		)
	})

	// The edge survives its blocker closing, so naming it unfiltered sends a person to a closed issue.
	it('never names a blocker that has since closed', () => {
		const child = epic_child([READY_CHILD], [])

		expect(backlog_plan.waiting_note(child, plan_context([]))).toBe(backlog_plan.PAST_OFFER_NOTE)
	})

	// Absence from a cut listing is "not read", never "closed". Read as closed, a standing blocker
	// disappears and the row claims the child is merely next in line while the run keeps waiting.
	it('names every blocker when the open listing could not be read to the end', () => {
		const child = epic_child([READY_CHILD], [])
		const unknown = { repo: backlog_fixture.REPO, titles: new Map(), open_numbers: undefined }

		expect(backlog_plan.waiting_note(child, unknown)).toBe(`waiting on #${String(READY_CHILD)}`)
	})

	it('says a child is merely next in line when it declares nothing and carries no label', () => {
		const child = epic_child([], [])

		expect(backlog_plan.waiting_note(child, plan_context([]))).toBe(backlog_plan.PAST_OFFER_NOTE)
	})
})

describe('a classification that could not be made is not a plan', () => {
	it('renders an unusable graph as no plan, never as an empty ready section', () => {
		const result = epic_report.build_result({ runnable: [], time: [], human: [] }, [
			{ kind: 'cycle', message: CYCLE_MESSAGE },
		])

		const text = backlog_plan.format_plan(result, [], plan_context([]))

		expect(text).toContain(backlog_plan.UNUSABLE_HEADING)
		expect(text).toContain(CYCLE_MESSAGE)
		expect(text).not.toContain(backlog_plan.READY_HEADING)
	})
})

describe('the issues the backlog will not run', () => {
	it('lists an open issue nobody opted in, with the reason', async () => {
		stub_backlog()

		await backlog_plan_cli.run([])

		const plan = stdout()

		expect(plan).toContain(`#${String(OUTSIDER)}`)
		expect(plan).toContain(backlog_scope.NO_OPT_IN_REASON)
	})

	it('calls an opted-in epic root a container rather than an omission', async () => {
		stub_backlog()

		await backlog_plan_cli.run([])

		expect(stdout()).toContain(backlog_scope.EPIC_ROOT_REASON)
	})

	// The labels of an excluded issue are still there to be read, and reading them names a cap that
	// had nothing to do with why it is absent from the plan.
	it('names the exclusion, not a label, for an issue the caller excluded', async () => {
		stub_backlog()

		await backlog_plan_cli.run(['--exclude', String(OUTSIDER)])

		expect(stdout()).toContain(backlog_scope.EXCLUDED_REASON)
	})

	it('never lists an issue the plan already placed', async () => {
		stub_backlog()

		await backlog_plan_cli.run([])

		const scope = stdout().split(backlog_plan.SCOPE_HEADING)[1] ?? ''

		expect(scope).not.toContain(`#${String(READY_CHILD)}`)
	})
})

describe('a read that failed is not an empty section', () => {
	// A cut listing is a cut set difference, not the ignorable prefix a display's cap is.
	it('warns that the plan is partial when the open listing was cut', async () => {
		stub_backlog()
		vi.spyOn(git_gh_command, 'issue_list_recent').mockResolvedValue({
			json: JSON.stringify([open_row(OUTSIDER)]),
			is_capped: true,
		})

		await backlog_plan_cli.run([])

		expect(stderr()).toContain(backlog_plan_cli.OPEN_TRUNCATED_MESSAGE)
	})

	it('reports an unreadable open listing instead of printing a plan', async () => {
		backlog_fixture.stub_backlog({
			opted_in: [open_row(EPIC_NUMBER, [AUTO_OK_LABEL, EPIC_LABEL])],
			epics: [{ number: EPIC_NUMBER, children: [READY_CHILD] }],
			children: [{ number: READY_CHILD }],
		})
		vi.spyOn(git_gh_command, 'issue_list_recent').mockResolvedValue({
			json: undefined,
			is_capped: false,
		})

		expect(await backlog_plan_cli.run([])).toBe(FAILURE_EXIT_CODE)
		expect(stderr()).toContain(backlog_plan_cli.OPEN_UNREADABLE_MESSAGE)
	})
})
