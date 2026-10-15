import type { LaneInfo } from '#scripts/lane/lane-registry'
import { expect, it, vi } from 'vitest'

const IN_PROGRESS = ['in-progress']
const CLAIMED = '3867'
const PARKED = '3865'
const IN_REVIEW = '3869'
const UNDISPATCHED = '3871'

const STATES = new Map([
	[CLAIMED, { labels: IN_PROGRESS, is_human_review: false }],
	[PARKED, { labels: ['needs-decision'], is_human_review: false }],
	[IN_REVIEW, { labels: IN_PROGRESS, is_human_review: true }],
	[UNDISPATCHED, { labels: IN_PROGRESS, is_human_review: false }],
])

vi.mock('#scripts/issue/issue-state-cli', () => ({
	issue_state_cli: {
		read_issue: vi.fn(async (issue: string) => ({
			kind: 'state',
			state: { state: 'OPEN', ...STATES.get(issue) },
		})),
	},
}))

const { backlog_drive_carried } = await import('./backlog-drive-carried')

function lane(issue: string, output: string | undefined): LaneInfo {
	return {
		issue,
		branch: `${issue}-lane`,
		directory: `/lanes/${issue}`,
		seat: undefined,
		development_port: undefined,
		preview_port: undefined,
		output,
		is_stranded: false,
	}
}

it('carries only dispatched lanes that still claim their issue outside a review stop', async () => {
	const lanes = [
		lane(CLAIMED, '/t/a.log'),
		lane(PARKED, '/t/b.log'),
		lane(IN_REVIEW, '/t/c.log'),
		lane(UNDISPATCHED, undefined),
	]

	expect(await backlog_drive_carried.carried(lanes)).toStrictEqual([CLAIMED])
})
