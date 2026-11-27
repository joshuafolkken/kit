import {
	auto_ok_fixture,
	CREATED_EARLIER,
	SUCCESS_EXIT_CODE,
} from '#scripts/auto-ok/auto-ok-fixture'
import type { OpenIssueData } from '#scripts/git/git-schemas'
import { issue_auto_ok } from '#scripts/issue/issue-auto-ok'
import { issue_handoff_filing } from '#scripts/issue/issue-handoff-filing'
import { AUTO_OK_LABEL, RUN_LANE_LABEL } from '#scripts/issue/issue-labels'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { backlog_fixture } from './backlog-fixture'
import { backlog_next } from './backlog-next'

// joshuafolkken/kit#9143 (ac-15e86d41): an Issue a handed-off `fullrun new` child filed was opted into
// `auto-ok` and offered to `backlogrun` beside the run implementing it. The listing `backlog:next`
// reads is GitHub's `auto-ok` label query, so the row is built exactly as `issue:file` labels it and
// listed only when that filing carries `auto-ok`.

const FILED = 901
const NOT_NEEDED_BODY = '## 背景\n\n- 種別: 不具合\n- 人の判断: 不要\n'

const streams = auto_ok_fixture.console_streams()
const { stdout } = streams

function filed_row(line: string): ReadonlyArray<OpenIssueData> {
	const environment = { JOSH_HANDOFF_CHILD: '1', JOSH_HANDOFF_KEYWORD: line }
	const labels = issue_handoff_filing.with_label([RUN_LANE_LABEL], environment)
	const decision = issue_auto_ok.decide({
		is_opted_out: false,
		is_cross_repository: false,
		labels,
		body: NOT_NEEDED_BODY,
	})

	if (!decision.is_applied) return []

	return [auto_ok_fixture.issue(FILED, CREATED_EARLIER, [AUTO_OK_LABEL, ...labels])]
}

beforeEach(() => {
	vi.restoreAllMocks()
	vi.spyOn(console, 'info').mockImplementation(streams.info)
	vi.spyOn(console, 'error').mockImplementation(streams.error)
	vi.spyOn(console, 'warn').mockImplementation(streams.error)
	streams.reset()
})

describe('backlog:next — an Issue a handed-off implementing run filed', () => {
	it('does not offer an Issue a handed-off fullrun new filed', async () => {
		backlog_fixture.stub_backlog({ opted_in: filed_row('fullrun new') })

		expect(await backlog_next.run([])).toBe(SUCCESS_EXIT_CODE)
		expect(stdout()).not.toContain(String(FILED))
	})

	it('still offers an Issue a handed-off kickoff new filed', async () => {
		backlog_fixture.stub_backlog({ opted_in: filed_row('kickoff new') })

		expect(await backlog_next.run([])).toBe(SUCCESS_EXIT_CODE)
		expect(stdout()).toBe(String(FILED))
	})
})
