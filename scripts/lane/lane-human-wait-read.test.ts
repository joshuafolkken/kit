import { epic_label_age, type TimelineEvent } from '#scripts/epic/epic-label-age'
import { gh_spawn } from '#scripts/gh/gh-spawn'
import { git_gh_issue } from '#scripts/gh/git-gh-issue'
import { MS_PER_MINUTE } from '#scripts/lib/timeouts'
import { confirmation_ledger } from '#scripts/notify/confirmation-ledger'
import type { RunEvent } from '#scripts/run/event/run-event-stream'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { lane_human_wait_read } from './lane-human-wait-read'
import { lane_stats } from './lane-stats'

// joshuafolkken/kit#7890: the waits on a person are read from the timelines of the issues the run
// parked and of the issues holding a stop label, and from the confirmation ledger — every read
// answered here, never by GitHub.

const NOW = Date.parse('2026-11-18T12:00:00.000Z')
const WINDOW = lane_stats.window_of(1, NOW)
const REPO = 'joshuafolkken/kit'
const PARKED = 12
const HELD = 13
const DECISION = 'needs-decision'

function minutes_ago(minutes: number): string {
	return new Date(NOW - minutes * MS_PER_MINUTE).toISOString()
}

// The confirmation the ledger answers with, still unanswered.
const ASKED = { reason: 'run-stopped', at: minutes_ago(5) }

const PARK_EVENTS: ReadonlyArray<RunEvent> = [
	{ pos: 0, at: minutes_ago(30), kind: 'park', text: `#${String(PARKED)} parked (${DECISION})` },
	{ pos: 1, at: minutes_ago(3 * 24 * 60), kind: 'park', text: '#99 parked' },
]

function timeline_of(issue: number): Array<TimelineEvent> {
	return [{ event: 'labeled', created_at: minutes_ago(issue), label: { name: DECISION } }]
}

function serve(repo: string | undefined): void {
	vi.spyOn(gh_spawn, 'get_repo_name_with_owner_within').mockReturnValue(repo)
	vi.spyOn(git_gh_issue, 'issue_list_by_label_in_repo').mockImplementation(async (label) => {
		const rows = label === DECISION ? [{ number: HELD }, { number: PARKED }] : []

		return await { json: JSON.stringify(rows), is_capped: false }
	})
	vi.spyOn(epic_label_age, 'read_events').mockImplementation(async (issue) => {
		if (issue === HELD) throw new Error('HTTP 502')

		return await timeline_of(issue)
	})
	vi.spyOn(confirmation_ledger, 'ledger_directory').mockReturnValue('/ledger')
	vi.spyOn(confirmation_ledger, 'read').mockResolvedValue([
		{ reason: ASKED.reason, checkout: '/repo', asked_at: ASKED.at },
	])
}

beforeEach(() => {
	vi.restoreAllMocks()
})

describe('lane_human_wait_read.read', () => {
	it('reads each parked or labelled issue once, counts a failed timeline as none, adds the ledger', async () => {
		serve(REPO)

		const waits = await lane_human_wait_read.read(PARK_EVENTS, WINDOW)

		expect(vi.mocked(epic_label_age.read_events).mock.calls.map(([issue]) => issue)).toStrictEqual([
			PARKED,
			HELD,
		])
		expect(waits).toStrictEqual([{ reason: DECISION, at: minutes_ago(PARKED) }, ASKED])
	})

	it('reads only the ledger when the repository is unknown', async () => {
		serve(undefined)

		const waits = await lane_human_wait_read.read(PARK_EVENTS, WINDOW)

		expect(waits).toStrictEqual([ASKED])
		expect(epic_label_age.read_events).not.toHaveBeenCalled()
	})
})

describe('lane_human_wait_read.read_for', () => {
	it('reads nothing for a context naming a ledger of its own', async () => {
		serve(REPO)

		const waits = await lane_human_wait_read.read_for({ ledger_path: '/x' }, PARK_EVENTS, WINDOW)

		expect(waits).toStrictEqual([])
		expect(gh_spawn.get_repo_name_with_owner_within).not.toHaveBeenCalled()
	})
})
