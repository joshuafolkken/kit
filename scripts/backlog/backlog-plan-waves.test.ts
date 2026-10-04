import {
	auto_ok_fixture,
	CREATED_LATER,
	EPIC_NUMBER,
	FAILURE_EXIT_CODE,
	SUCCESS_EXIT_CODE,
} from '#scripts/auto-ok/auto-ok-fixture'
import { git_gh_command } from '#scripts/gh/git-gh-command'
import type { OpenIssueData } from '#scripts/git/schemas'
import { AUTO_OK_LABEL, BUG_LABEL, EPIC_LABEL, RUN_SOLO_LABEL } from '#scripts/issue/issue-labels'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { backlog_fixture } from './backlog-fixture'
import { backlog_next } from './backlog-next'
import { backlog_plan } from './backlog-plan'
import { backlog_plan_cli } from './backlog-plan-cli'
import { backlog_waves } from './backlog-waves'

// joshuafolkken/kit#2778: `josh backlog:plan --waves` end to end, through the same reads
// `backlog:next` makes. Kept apart from `backlog-plan.test.ts`, which is at its line limit.

const { issue, console_streams } = auto_ok_fixture

const FIRST = 901
const SOLO = 902
const BLOCKED = 903

const streams = console_streams()
const { stdout } = streams

function open_row(number: number, labels: ReadonlyArray<string> = []): OpenIssueData {
	return issue(number, CREATED_LATER, labels)
}

// One opted-in epic: an ordinary child listed first, a run:solo defect listed second — which the
// ranking lifts to the head (joshuafolkken/kit#2928) — and a child waiting on the first.
function stub_backlog(): void {
	backlog_fixture.stub_backlog({
		opted_in: [open_row(EPIC_NUMBER, [AUTO_OK_LABEL, EPIC_LABEL])],
		epics: [{ number: EPIC_NUMBER, children: [FIRST, SOLO, BLOCKED] }],
		children: [
			{ number: FIRST },
			{ number: SOLO, labels: [BUG_LABEL, RUN_SOLO_LABEL] },
			{ number: BLOCKED, blocked_by: [FIRST] },
		],
	})
	vi.spyOn(git_gh_command, 'issue_list_recent').mockResolvedValue({
		json: JSON.stringify([FIRST, SOLO, BLOCKED].map((number) => open_row(number))),
		is_capped: false,
	})
}

beforeEach(() => {
	vi.restoreAllMocks()
	vi.spyOn(console, 'info').mockImplementation(streams.info)
	vi.spyOn(console, 'error').mockImplementation(streams.error)
	vi.spyOn(console, 'warn').mockImplementation(streams.error)
	streams.reset()
})

describe('josh backlog:plan --waves', () => {
	it('prints the run order wave by wave, the run:solo defect first', async () => {
		stub_backlog()

		expect(await backlog_plan_cli.run(['--waves'])).toBe(SUCCESS_EXIT_CODE)
		expect(stdout()).toContain(`Wave 1  ${backlog_fixture.cite(SOLO)} ${backlog_plan.SOLO_MARK}\n`)
		expect(stdout()).toContain(`Wave 2  ${backlog_fixture.cite(FIRST)}\n`)
		expect(stdout()).toContain(`Wave 3  ${backlog_fixture.cite(BLOCKED)}\n`)
	})

	it('opens on the same issue backlog:next prints for an idle repository', async () => {
		stub_backlog()
		await backlog_next.run([])
		const next = stdout()

		streams.reset()
		await backlog_plan_cli.run(['--waves'])

		expect(stdout()).toContain(`Wave 1  ${backlog_fixture.cite(Number(next))} `)
	})

	it('refuses to combine the waves with named issues', async () => {
		stub_backlog()

		expect(await backlog_plan_cli.run([`#${String(FIRST)}`, '--waves'])).toBe(FAILURE_EXIT_CODE)
		expect(streams.stderr()).toContain(backlog_plan_cli.WAVES_WITH_NAMED_MESSAGE)
	})

	it('refuses named issues placed after --waves rather than dropping them', async () => {
		stub_backlog()

		expect(await backlog_plan_cli.run(['--waves', `#${String(FIRST)}`])).toBe(FAILURE_EXIT_CODE)
		expect(streams.stderr()).toContain(backlog_plan_cli.WAVES_WITH_NAMED_MESSAGE)
	})

	it('leaves the plan without --waves as the sections it always printed', async () => {
		stub_backlog()
		await backlog_plan_cli.run([])

		expect(stdout()).toContain(backlog_plan.READY_HEADING)
		expect(stdout()).not.toContain(backlog_waves.UNREACHED_HEADING)
	})
})
