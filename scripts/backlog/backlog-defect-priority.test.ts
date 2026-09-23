import {
	auto_ok_fixture,
	CREATED_EARLIER,
	EPIC_NUMBER,
	SUCCESS_EXIT_CODE,
} from '#scripts/auto-ok/auto-ok-fixture'
import { git_gh_command } from '#scripts/git/git-gh-command'
import { INTERRUPT_ROUTE_LABEL } from '#scripts/git/issue-labels'
import { behavior_change_lint } from '#scripts/issue/behavior-change-lint'
import { defect_rate, type DefectRate } from '#scripts/issue/defect-rate'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { backlog_defect_priority } from './backlog-defect-priority'
import { backlog_fixture, type BacklogInput, type ChildInput } from './backlog-fixture'
import { backlog_next } from './backlog-next'
import { backlog_plan_cli } from './backlog-plan-cli'

// joshuafolkken/kit#2455: while the defect rate is above its baseline, `backlog:next` offers defects
// and hardening first and defers new mechanisms; at or below it, the order is the graph's own.

const { console_streams, issue, opted_in_epic } = auto_ok_fixture

const MECHANISM = 901
const CODE_ONLY = 902
const DEFECT = 903
const INTERRUPTED_MECHANISM = 904
const UNDECLARED = 905

const CHILDREN: ReadonlyArray<ChildInput> = [
	{ number: MECHANISM, body: behavior_change_lint.DECLARATION_LINE },
	{ number: CODE_ONLY, body: '- 種別: コードのみ' },
	{ number: DEFECT, body: defect_rate.DEFECT_DECLARATION_LINE },
	{
		number: INTERRUPTED_MECHANISM,
		body: behavior_change_lint.DECLARATION_LINE,
		labels: [INTERRUPT_ROUTE_LABEL],
	},
	{ number: UNDECLARED },
]

const GRAPH_ORDER = [MECHANISM, CODE_ONLY, DEFECT, INTERRUPTED_MECHANISM, UNDECLARED]

const ABOVE_BASELINE: DefectRate = { ...backlog_fixture.AT_BASELINE, defects: 22 }

const streams = console_streams()
const { stdout, stderr } = streams

const ABOVE_NOTE = 'above its baseline'

function stub(rate: Pick<BacklogInput, 'defect_rate' | 'is_rate_unreadable'>): void {
	backlog_fixture.stub_backlog({
		opted_in: [opted_in_epic()],
		epics: [{ number: EPIC_NUMBER, children: GRAPH_ORDER }],
		children: CHILDREN,
		...rate,
	})
}

function offered(): string {
	return stdout()
}

function joined(numbers: ReadonlyArray<number>): string {
	return numbers.map(String).join('\n')
}

beforeEach(() => {
	vi.restoreAllMocks()
	vi.spyOn(console, 'info').mockImplementation(streams.info)
	vi.spyOn(console, 'error').mockImplementation(streams.error)
	vi.spyOn(console, 'warn').mockImplementation(streams.error)
	streams.reset()
})

describe('backlog:next while the defect rate is above its baseline', () => {
	it('offers defects first, keeps the rest in place and defers new mechanisms', async () => {
		stub({ defect_rate: ABOVE_BASELINE })

		expect(await backlog_next.run([])).toBe(SUCCESS_EXIT_CODE)
		expect(offered()).toBe(
			joined([DEFECT, INTERRUPTED_MECHANISM, CODE_ONLY, UNDECLARED, MECHANISM]),
		)
		expect(stderr()).toContain(ABOVE_NOTE)
	})
})

// The plan renders the same answer, so it cannot promise an order the run does not take.
describe('backlog:plan while the defect rate is above its baseline', () => {
	it('lists the ready children in the order backlog:next offers them', async () => {
		stub({ defect_rate: ABOVE_BASELINE })
		vi.spyOn(git_gh_command, 'issue_list_recent').mockResolvedValue({
			json: JSON.stringify(GRAPH_ORDER.map((number) => issue(number, CREATED_EARLIER))),
			is_capped: false,
		})

		expect(await backlog_plan_cli.run([])).toBe(SUCCESS_EXIT_CODE)

		const plan = stdout()

		expect(plan.indexOf(`#${String(DEFECT)} `)).toBeLessThan(plan.indexOf(`#${String(MECHANISM)} `))
	})
})

describe('backlog:next at or below the baseline', () => {
	it('keeps the graph order when the rate equals the baseline', async () => {
		stub({ defect_rate: backlog_fixture.AT_BASELINE })

		expect(await backlog_next.run([])).toBe(SUCCESS_EXIT_CODE)
		expect(offered()).toBe(joined(GRAPH_ORDER))
		expect(stderr()).not.toContain(ABOVE_NOTE)
	})

	it('keeps the graph order when the rate cannot be read', async () => {
		stub({ is_rate_unreadable: true })

		expect(await backlog_next.run([])).toBe(SUCCESS_EXIT_CODE)
		expect(offered()).toBe(joined(GRAPH_ORDER))
		expect(stderr()).toContain(backlog_defect_priority.UNMEASURED_MESSAGE)
	})
})
