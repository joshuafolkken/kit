import { auto_ok_cli } from '#scripts/auto-ok/auto-ok-cli'
import {
	auto_ok_fixture,
	CREATED_EARLIER,
	CREATED_LATER,
	EPIC_NUMBER,
	FAILURE_EXIT_CODE,
	OLD_ISSUE_NUMBER,
	SUCCESS_EXIT_CODE,
} from '#scripts/auto-ok/auto-ok-fixture'
import { git_gh_command } from '#scripts/git/git-gh-command'
import { listing_outcome } from '#scripts/git/git-gh-issue-list-fixture'
import { AUTO_OK_LABEL, EPIC_LABEL } from '#scripts/git/issue-labels'
import { ALIASES, COMMAND_MAP } from '#scripts/josh/josh-command-map'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { backlog_fixture } from './backlog-fixture'
import { backlog_next } from './backlog-next'

// The output contract and the refusals — the half a loop reads rather than a person.

const { issue, console_streams } = auto_ok_fixture

const COMMAND_NAME = 'backlog:next'
const CHILD = 901
const SECOND_EPIC = 810
const FOREIGN_NUMBER = 903
const FOREIGN_CHILD = `joshuafolkken/app-kit#${String(FOREIGN_NUMBER)}`

const streams = console_streams()
const { stdout, stderr } = streams

beforeEach(() => {
	vi.restoreAllMocks()
	vi.spyOn(console, 'info').mockImplementation(streams.info)
	vi.spyOn(console, 'error').mockImplementation(streams.error)
	vi.spyOn(console, 'warn').mockImplementation(streams.error)
	streams.reset()
})

describe('the output contract', () => {
	it('puts one token per line on standard output and every explanation on standard error', async () => {
		backlog_fixture.stub_backlog({
			opted_in: [
				issue(EPIC_NUMBER, CREATED_LATER, [AUTO_OK_LABEL, EPIC_LABEL]),
				issue(OLD_ISSUE_NUMBER, CREATED_EARLIER),
			],
			epics: [{ number: EPIC_NUMBER, children: [CHILD] }],
			children: [{ number: CHILD }],
		})

		expect(await backlog_next.run([])).toBe(SUCCESS_EXIT_CODE)
		expect(stdout()).toBe(`${String(CHILD)}\n${String(OLD_ISSUE_NUMBER)}`)
		expect(stdout()).not.toMatch(/[^\d\n]/u)
		expect(stderr()).toContain('Runnable children')
	})

	it('spells complete as none, so a loop branches on the same word auto-ok:next prints', () => {
		expect(backlog_next.VERDICT_TOKENS.complete).toBe(auto_ok_cli.NONE_TOKEN)
	})
})

describe('what a token names', () => {
	it('qualifies a child in another repository, so a bare number cannot be misread here', async () => {
		backlog_fixture.stub_backlog({
			opted_in: [issue(EPIC_NUMBER, CREATED_LATER, [AUTO_OK_LABEL, EPIC_LABEL])],
			epics: [{ number: EPIC_NUMBER, children: [CHILD], external: [FOREIGN_CHILD] }],
			children: [{ number: CHILD }, { number: FOREIGN_NUMBER }],
		})

		expect(await backlog_next.run([])).toBe(SUCCESS_EXIT_CODE)
		expect(stdout().split('\n')).toContain(FOREIGN_CHILD)
		expect(stdout().split('\n')).toContain(String(CHILD))
	})

	it('offers a child two auto-ok epics both track exactly once', async () => {
		backlog_fixture.stub_backlog({
			opted_in: [
				issue(EPIC_NUMBER, CREATED_LATER, [AUTO_OK_LABEL, EPIC_LABEL]),
				issue(SECOND_EPIC, CREATED_EARLIER, [AUTO_OK_LABEL, EPIC_LABEL]),
			],
			epics: [
				{ number: EPIC_NUMBER, children: [CHILD] },
				{ number: SECOND_EPIC, children: [CHILD] },
			],
			children: [{ number: CHILD }],
		})

		expect(await backlog_next.run([])).toBe(SUCCESS_EXIT_CODE)
		expect(stdout()).toBe(String(CHILD))
	})

	it('names the checkout of this repository rather than reporting it as absent', async () => {
		backlog_fixture.stub_backlog({ opted_in: [issue(OLD_ISSUE_NUMBER, CREATED_EARLIER)] })

		expect(await backlog_next.run([])).toBe(SUCCESS_EXIT_CODE)
		expect(stderr()).not.toContain('(no local checkout)')
	})
})

describe('a read that failed is not an answer', () => {
	it('refuses when the opted-in listing could not be read', async () => {
		backlog_fixture.stub_backlog({})
		vi.spyOn(git_gh_command, 'issue_list_by_label_summary').mockResolvedValue(
			listing_outcome(undefined),
		)

		expect(await backlog_next.run([])).toBe(FAILURE_EXIT_CODE)
		expect(stdout()).toBe('')
		expect(stderr()).toContain(auto_ok_cli.UNREADABLE_MESSAGE)
	})

	it('refuses when the epic listing could not be read', async () => {
		backlog_fixture.stub_backlog({ opted_in: [issue(OLD_ISSUE_NUMBER, CREATED_EARLIER)] })
		vi.spyOn(git_gh_command, 'issue_list_by_label').mockResolvedValue(listing_outcome(undefined))

		expect(await backlog_next.run([])).toBe(FAILURE_EXIT_CODE)
		expect(stdout()).toBe('')
		expect(stderr()).toContain(auto_ok_cli.EPICS_UNREADABLE_MESSAGE)
	})

	it('refuses when this repository could not be named', async () => {
		backlog_fixture.stub_backlog({ opted_in: [issue(OLD_ISSUE_NUMBER, CREATED_EARLIER)] })
		vi.spyOn(git_gh_command, 'repo_get_name_with_owner').mockResolvedValue(undefined)

		expect(await backlog_next.run([])).toBe(FAILURE_EXIT_CODE)
		expect(stdout()).toBe('')
		expect(stderr()).toContain(backlog_next.REPO_UNREADABLE_MESSAGE)
	})
})

describe(`josh ${COMMAND_NAME} registration`, () => {
	it('is registered as a command', () => {
		const entry = COMMAND_MAP[COMMAND_NAME]

		expect(entry?.script).toBe('scripts/backlog/backlog-next.ts')
	})

	it('is reachable through the bl alias', () => {
		const { bl } = ALIASES

		expect(bl).toBe(COMMAND_NAME)
	})
})
