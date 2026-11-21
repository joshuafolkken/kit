import { epic_label_age } from '#scripts/epic/epic-label-age'
import { gh_spawn } from '#scripts/gh/gh-spawn'
import { git_gh_issue } from '#scripts/gh/git-gh-issue'
import { issue_human_stops } from '#scripts/issue/issue-human-stops'
import { json_value } from '#scripts/lib/json-value'
import { confirmation_ledger } from '#scripts/notify/confirmation-ledger'
import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'
import { z } from 'zod'
import { lane_human_wait_stats, type HumanWait } from './lane-human-wait-stats'
import type { MeasureContext } from './lane-sampler'
import type { StatsWindow } from './lane-stats'
import { lane_stop_stats } from './lane-stop-stats'

// The waits on a person `lane-human-wait-stats.ts` tabulates, read where they are kept: a labelled
// stop on the issue timeline, a label-less one in the confirmation ledger (joshuafolkken/kit#7890).
//
// **Which timelines**: the issues the run parked in the period (its event stream) and the issues
// holding a stop label now. A label put on and taken off by hand on an issue no run parked is not
// read — no listing names the issues a label has left. A read that fails counts no wait.

const REPO_TIMEOUT_MS = 10_000
// One listing page per label: a stop label held by more issues than this is a backlog no wait
// median would describe.
const HOLDER_LIMIT = 100
const NUMBER_FIELD = 'number'

const holders_schema = z.array(z.object({ number: z.number() }))

function parked_in(events: ReadonlyArray<RunEvent>, window: StatsWindow): Array<number> {
	return lane_stop_stats
		.events_of(events, run_event_stream.EVENT_KIND.PARK)
		.filter((park) => park.at_ms >= window.since_ms && park.at_ms <= window.until_ms)
		.map((park) => park.issue)
		.filter((issue): issue is number => issue !== undefined && Number.isSafeInteger(issue))
}

async function holders(label: string, repo: string): Promise<Array<number>> {
	try {
		const outcome = await git_gh_issue.issue_list_by_label_in_repo(label, HOLDER_LIMIT, repo, {
			json_fields: NUMBER_FIELD,
		})

		const rows = json_value.parse_array(outcome.json ?? '')

		return holders_schema.parse(rows).map((row) => row.number)
	} catch {
		return []
	}
}

async function timeline_waits(issue: number, repo: string): Promise<Array<HumanWait>> {
	try {
		return lane_human_wait_stats.label_waits(await epic_label_age.read_events(issue, repo))
	} catch {
		return []
	}
}

async function label_waits(
	events: ReadonlyArray<RunEvent>,
	window: StatsWindow,
): Promise<Array<HumanWait>> {
	const repo = gh_spawn.get_repo_name_with_owner_within(REPO_TIMEOUT_MS)

	if (repo === undefined) return []
	const labels = [...issue_human_stops.labels()]
	const held = await Promise.all(labels.map(async (label) => await holders(label, repo)))
	const issues = [...new Set([...parked_in(events, window), ...held.flat()])]
	const waits = await Promise.all(issues.map(async (issue) => await timeline_waits(issue, repo)))

	return waits.flat()
}

async function confirmation_waits(window: StatsWindow): Promise<Array<HumanWait>> {
	const directory = confirmation_ledger.ledger_directory()

	if (directory === undefined) return []
	const entries = await confirmation_ledger.read(directory, new Date(window.since_ms))

	return lane_human_wait_stats.confirmation_waits(entries)
}

// Every wait on a person that may have begun in `window`; the table drops the rest.
async function read(
	events: ReadonlyArray<RunEvent>,
	window: StatsWindow,
): Promise<Array<HumanWait>> {
	const [labelled, confirmed] = await Promise.all([
		label_waits(events, window),
		confirmation_waits(window),
	])

	return [...labelled, ...confirmed]
}

// The waits are this repository's, so a context naming a ledger of its own — another run's records
// or a fixture's — reads none.
async function read_for(
	context: MeasureContext,
	events: ReadonlyArray<RunEvent>,
	window: StatsWindow,
): Promise<Array<HumanWait>> {
	if (context.ledger_path !== undefined) return []

	return await read(events, window)
}

const lane_human_wait_read = { read, read_for }

export { lane_human_wait_read }
