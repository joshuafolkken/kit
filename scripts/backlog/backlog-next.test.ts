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
import { AUTO_OK_LABEL, EPIC_LABEL } from '#scripts/git/issue-labels'
import type { OpenIssueData } from '#scripts/git/schemas'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { backlog_fixture } from './backlog-fixture'
import { backlog_next } from './backlog-next'

// The candidate table joshuafolkken/kit#1630 defines, and the two rules that decide it: an epic
// root's `auto-ok` stands for every child, and a child's own `auto-ok` never makes it a standalone
// candidate.

const { issue, blocked_issue, console_streams } = auto_ok_fixture

const CHILD = 901
const SECOND_CHILD = 902
const IN_PROGRESS = 'in-progress'
const NEEDS_DECISION = 'needs-decision'

const streams = console_streams()
const { stdout, stderr } = streams

function opted_in_epic(): OpenIssueData {
	return issue(EPIC_NUMBER, CREATED_LATER, [AUTO_OK_LABEL, EPIC_LABEL])
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

	it('withholds a child of an epic without auto-ok even when the child carries it', async () => {
		backlog_fixture.stub_backlog({
			opted_in: [issue(CHILD, CREATED_EARLIER)],
			epics: [{ number: EPIC_NUMBER, children: [CHILD] }],
			children: [{ number: CHILD, labels: [AUTO_OK_LABEL] }],
		})

		expect(await backlog_next.run([])).toBe(SUCCESS_EXIT_CODE)
		expect(stdout()).toBe(backlog_next.VERDICT_TOKENS.complete)
	})

	it('withholds a child of an epic without auto-ok when neither carries it', async () => {
		backlog_fixture.stub_backlog({ epics: [{ number: EPIC_NUMBER, children: [CHILD] }] })

		expect(await backlog_next.run([])).toBe(SUCCESS_EXIT_CODE)
		expect(stdout()).toBe(backlog_next.VERDICT_TOKENS.complete)
		expect(stderr()).toContain('No open issue carries')
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

	it('says error and offers nothing when a child could not be read', async () => {
		backlog_fixture.stub_backlog({
			opted_in: [opted_in_epic(), issue(NEW_ISSUE_NUMBER, CREATED_LATER)],
			epics: [{ number: EPIC_NUMBER, children: [CHILD] }],
		})

		expect(await backlog_next.run([])).toBe(SUCCESS_EXIT_CODE)
		expect(stdout()).toBe(backlog_next.VERDICT_TOKENS.error)
	})

	it('says none when the backlog holds nothing opted in', async () => {
		backlog_fixture.stub_backlog({})

		expect(await backlog_next.run([])).toBe(SUCCESS_EXIT_CODE)
		expect(stdout()).toBe(backlog_next.VERDICT_TOKENS.complete)
	})
})
