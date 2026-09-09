import {
	auto_ok_fixture,
	BLOCKER_NUMBER,
	CREATED_EARLIER,
	CREATED_LATER,
	EPIC_NUMBER,
	FAILURE_EXIT_CODE,
	NEW_ISSUE_NUMBER,
	OLD_ISSUE_NUMBER,
	SUCCESS_EXIT_CODE,
} from '#scripts/auto-ok/auto-ok-fixture'
import { git_gh_exec } from '#scripts/git/git-gh-exec'
import { AUTO_OK_LABEL } from '#scripts/git/issue-labels'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { backlog_fixture } from './backlog-fixture'
import { backlog_next } from './backlog-next'

// The candidate table joshuafolkken/kit#1630 defines, and the two rules that decide it: an epic
// root's `auto-ok` stands for every child, and a child's own `auto-ok` makes it a standalone
// candidate only where the epic tracking it is not opted in and so will never offer it
// (joshuafolkken/kit#1668, narrowing joshuafolkken/kit#1633).

const { issue, blocked_issue, console_streams, opted_in_epic } = auto_ok_fixture

const CHILD = 901
const SECOND_CHILD = 902
const IN_PROGRESS = 'in-progress'
const NEEDS_DECISION = 'needs-decision'
const RATE_LIMITED_STATUS = 429

const streams = console_streams()
const { stdout, stderr } = streams

// A backlog whose one epic child cannot be read — the shape that reaches the `error` verdict, and so
// the only one the transport question is asked on.
function unreadable_child(): void {
	backlog_fixture.stub_backlog({
		opted_in: [opted_in_epic(), issue(NEW_ISSUE_NUMBER, CREATED_LATER)],
		epics: [{ number: EPIC_NUMBER, children: [CHILD] }],
	})
}

beforeEach(() => {
	vi.restoreAllMocks()
	vi.spyOn(console, 'info').mockImplementation(streams.info)
	vi.spyOn(console, 'error').mockImplementation(streams.error)
	vi.spyOn(console, 'warn').mockImplementation(streams.error)
	streams.reset()
})

describe('the candidate table', () => {
	it('offers a runnable child of an epic whose root carries auto-ok', async () => {
		backlog_fixture.stub_backlog({
			opted_in: [opted_in_epic()],
			epics: [{ number: EPIC_NUMBER, children: [CHILD] }],
			children: [{ number: CHILD }],
		})

		expect(await backlog_next.run([])).toBe(SUCCESS_EXIT_CODE)
		expect(stdout()).toBe(String(CHILD))
	})

	it('offers such a child exactly once when it carries auto-ok itself', async () => {
		backlog_fixture.stub_backlog({
			opted_in: [opted_in_epic(), issue(CHILD, CREATED_EARLIER)],
			epics: [{ number: EPIC_NUMBER, children: [CHILD] }],
			children: [{ number: CHILD, labels: [AUTO_OK_LABEL] }],
		})

		expect(await backlog_next.run([])).toBe(SUCCESS_EXIT_CODE)
		expect(stdout()).toBe(String(CHILD))
	})

	it('withholds a child of an epic without auto-ok when neither carries it', async () => {
		backlog_fixture.stub_backlog({ epics: [{ number: EPIC_NUMBER, children: [CHILD] }] })

		expect(await backlog_next.run([])).toBe(SUCCESS_EXIT_CODE)
		expect(stdout()).toBe(backlog_next.VERDICT_TOKENS.complete)
		expect(stderr()).toContain('No open issue carries')
	})
})

// joshuafolkken/kit#1668: a child of an epic that will never offer it falls to the standalone half on
// its own label, and the order it has is still the one its `blocked-by` relations record.
describe('a child of an epic that is not opted in', () => {
	// joshuafolkken/kit#1668 replaced this expectation. Under joshuafolkken/kit#1633 the child was
	// withheld, and no other path offered it either — the epic is not opted in, so the epic half never
	// reads it — which made the person's `auto-ok` on the child silently inert.
	it('offers a child of an epic without auto-ok when the child carries it', async () => {
		backlog_fixture.stub_backlog({
			opted_in: [issue(CHILD, CREATED_EARLIER)],
			epics: [{ number: EPIC_NUMBER, children: [CHILD] }],
			children: [{ number: CHILD, labels: [AUTO_OK_LABEL] }],
		})

		expect(await backlog_next.run([])).toBe(SUCCESS_EXIT_CODE)
		expect(stdout()).toBe(String(CHILD))
	})

	// Opting in says nothing about order, and that half of joshuafolkken/kit#1633 is unchanged: the
	// standalone route still refuses a candidate whose prerequisite is open, which is how an epic's
	// declared order survives being reached from outside the epic.
	it('withholds such a child while its own prerequisite is still open', async () => {
		backlog_fixture.stub_backlog({
			opted_in: [blocked_issue(CHILD, CREATED_EARLIER, [{ number: BLOCKER_NUMBER }])],
			epics: [{ number: EPIC_NUMBER, children: [CHILD] }],
			children: [{ number: CHILD, labels: [AUTO_OK_LABEL] }],
		})

		expect(await backlog_next.run([])).toBe(SUCCESS_EXIT_CODE)
		expect(stdout()).toBe(backlog_next.VERDICT_TOKENS.wait)
	})
})

describe('standalone candidates', () => {
	it('offers a standalone auto-ok issue that no epic tracks', async () => {
		backlog_fixture.stub_backlog({ opted_in: [issue(OLD_ISSUE_NUMBER, CREATED_EARLIER)] })

		expect(await backlog_next.run([])).toBe(SUCCESS_EXIT_CODE)
		expect(stdout()).toBe(String(OLD_ISSUE_NUMBER))
	})

	it('never offers the epic root itself', async () => {
		backlog_fixture.stub_backlog({
			opted_in: [opted_in_epic()],
			epics: [{ number: EPIC_NUMBER, children: [] }],
		})

		expect(await backlog_next.run([])).toBe(SUCCESS_EXIT_CODE)
		expect(stdout()).not.toContain(String(EPIC_NUMBER))
	})
})

describe('dependencies', () => {
	it('withholds a standalone issue whose blocker is still open', async () => {
		backlog_fixture.stub_backlog({
			opted_in: [blocked_issue(OLD_ISSUE_NUMBER, CREATED_EARLIER, [{ number: BLOCKER_NUMBER }])],
		})

		expect(await backlog_next.run([])).toBe(SUCCESS_EXIT_CODE)
		expect(stdout()).toBe(backlog_next.VERDICT_TOKENS.wait)
	})

	it('offers an epic child ahead of the sibling it blocks', async () => {
		backlog_fixture.stub_backlog({
			opted_in: [opted_in_epic()],
			epics: [{ number: EPIC_NUMBER, children: [CHILD, SECOND_CHILD] }],
			children: [{ number: CHILD }, { number: SECOND_CHILD, blocked_by: [CHILD] }],
		})

		expect(await backlog_next.run([])).toBe(SUCCESS_EXIT_CODE)
		expect(stdout()).toBe(String(CHILD))
	})

	it('offers both epic children when neither blocks the other', async () => {
		backlog_fixture.stub_backlog({
			opted_in: [opted_in_epic()],
			epics: [{ number: EPIC_NUMBER, children: [CHILD, SECOND_CHILD] }],
			children: [{ number: CHILD }, { number: SECOND_CHILD }],
		})

		expect(await backlog_next.run([])).toBe(SUCCESS_EXIT_CODE)
		expect(stdout()).toBe(`${String(CHILD)}\n${String(SECOND_CHILD)}`)
	})
})

describe('the order of the pool', () => {
	it('puts an epic child ahead of a standalone issue', async () => {
		backlog_fixture.stub_backlog({
			opted_in: [opted_in_epic(), issue(NEW_ISSUE_NUMBER, CREATED_LATER)],
			epics: [{ number: EPIC_NUMBER, children: [CHILD] }],
			children: [{ number: CHILD }],
		})

		expect(await backlog_next.run([])).toBe(SUCCESS_EXIT_CODE)
		expect(stdout()).toBe(`${String(CHILD)}\n${String(NEW_ISSUE_NUMBER)}`)
	})

	it('ranks standalone issues newest first, as auto-ok:next does', async () => {
		backlog_fixture.stub_backlog({
			opted_in: [issue(OLD_ISSUE_NUMBER, CREATED_EARLIER), issue(NEW_ISSUE_NUMBER, CREATED_LATER)],
		})

		expect(await backlog_next.run([])).toBe(SUCCESS_EXIT_CODE)
		expect(stdout()).toBe(`${String(NEW_ISSUE_NUMBER)}\n${String(OLD_ISSUE_NUMBER)}`)
	})
})

describe('--exclude', () => {
	it('drops the issue just merged from a standalone answer', async () => {
		backlog_fixture.stub_backlog({ opted_in: [issue(OLD_ISSUE_NUMBER, CREATED_EARLIER)] })
		const argv = ['--exclude', String(OLD_ISSUE_NUMBER)]

		expect(await backlog_next.run(argv)).toBe(SUCCESS_EXIT_CODE)
		expect(stdout()).toBe(backlog_next.VERDICT_TOKENS.complete)
	})

	it('drops an epic child that has just merged from every bucket', async () => {
		backlog_fixture.stub_backlog({
			opted_in: [opted_in_epic()],
			epics: [{ number: EPIC_NUMBER, children: [CHILD, SECOND_CHILD] }],
			children: [{ number: CHILD, labels: [IN_PROGRESS] }, { number: SECOND_CHILD }],
		})

		expect(await backlog_next.run(['--exclude', String(CHILD)])).toBe(SUCCESS_EXIT_CODE)
		expect(stdout()).toBe(String(SECOND_CHILD))
	})

	it('takes a comma-separated list and refuses an argument that is not a pair', async () => {
		backlog_fixture.stub_backlog({
			opted_in: [issue(OLD_ISSUE_NUMBER, CREATED_EARLIER), issue(NEW_ISSUE_NUMBER, CREATED_LATER)],
		})
		const both = `${String(OLD_ISSUE_NUMBER)},${String(NEW_ISSUE_NUMBER)}`

		expect(await backlog_next.run(['--exclude', both])).toBe(SUCCESS_EXIT_CODE)
		expect(stdout()).toBe(backlog_next.VERDICT_TOKENS.complete)
		expect(await backlog_next.run(['--wrong'])).toBe(FAILURE_EXIT_CODE)
		expect(stderr()).toContain(backlog_next.USAGE)
	})
})

describe('the verdicts, in epic:next meanings', () => {
	it('says wait when the only child is already in progress', async () => {
		backlog_fixture.stub_backlog({
			opted_in: [opted_in_epic()],
			epics: [{ number: EPIC_NUMBER, children: [CHILD] }],
			children: [{ number: CHILD, labels: [IN_PROGRESS] }],
		})

		expect(await backlog_next.run([])).toBe(SUCCESS_EXIT_CODE)
		expect(stdout()).toBe(backlog_next.VERDICT_TOKENS.wait)
	})

	it('says stop when the only child is parked for a person', async () => {
		backlog_fixture.stub_backlog({
			opted_in: [opted_in_epic()],
			epics: [{ number: EPIC_NUMBER, children: [CHILD] }],
			children: [{ number: CHILD, labels: [NEEDS_DECISION] }],
		})

		expect(await backlog_next.run([])).toBe(SUCCESS_EXIT_CODE)
		expect(stdout()).toBe(backlog_next.VERDICT_TOKENS.stop)
	})

	it('says error and offers nothing when a child could not be read and GitHub is answering', async () => {
		unreadable_child()

		expect(await backlog_next.run([])).toBe(SUCCESS_EXIT_CODE)
		expect(stdout()).toBe(backlog_next.VERDICT_TOKENS.error)
	})

	it('says none when the backlog holds nothing opted in', async () => {
		backlog_fixture.stub_backlog({})

		expect(await backlog_next.run([])).toBe(SUCCESS_EXIT_CODE)
		expect(stdout()).toBe(backlog_next.VERDICT_TOKENS.complete)
	})
})

// joshuafolkken/kit#1663: an unattended run may never re-ask on `error`, so a dropped connection
// answering `error` ended a run with thirteen runnable issues still in the backlog.
describe('a transport failure, told apart from an unusable graph', () => {
	it('says retry rather than error when GitHub was never reached', async () => {
		unreadable_child()
		vi.spyOn(git_gh_exec, 'exec_gh_api_status').mockResolvedValue(undefined)

		expect(await backlog_next.run([])).toBe(SUCCESS_EXIT_CODE)
		expect(stdout()).toBe(backlog_next.VERDICT_TOKENS.retry)
	})

	it('says retry when GitHub answered but the answer was a rate limit', async () => {
		unreadable_child()
		vi.spyOn(git_gh_exec, 'exec_gh_api_status').mockResolvedValue(RATE_LIMITED_STATUS)

		expect(await backlog_next.run([])).toBe(SUCCESS_EXIT_CODE)
		expect(stdout()).toBe(backlog_next.VERDICT_TOKENS.retry)
	})

	it('sends the reader at the connection instead of at gh auth status and the issue', async () => {
		unreadable_child()
		vi.spyOn(git_gh_exec, 'exec_gh_api_status').mockResolvedValue(undefined)

		expect(await backlog_next.run([])).toBe(SUCCESS_EXIT_CODE)
		expect(stderr()).toContain(backlog_next.RETRY_MESSAGE)
		expect(stderr()).not.toContain('gh auth status')
	})

	it('never asks the transport question on a verdict that is not error', async () => {
		backlog_fixture.stub_backlog({ opted_in: [issue(OLD_ISSUE_NUMBER, CREATED_EARLIER)] })
		const status = vi.spyOn(git_gh_exec, 'exec_gh_api_status')

		expect(await backlog_next.run([])).toBe(SUCCESS_EXIT_CODE)
		expect(status).not.toHaveBeenCalled()
	})
})
