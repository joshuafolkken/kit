import { git_command } from '#scripts/git/git-command'
import { lane_child_marker } from '#scripts/lane/lane-child-marker'
import { run_event_stream } from '#scripts/run/event/run-event-stream'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { issue_file_cli, type Filing } from './issue-file-cli'

// joshuafolkken/kit#3430: every filing lands on the run's event stream as a `filed` event, so
// `run:board` lists what a run filed — and which lane child's work turned it up.

const HERE = 'joshuafolkken/kit'
const THERE = 'joshuafolkken/app-kit'
const TITLE = 'Count the seats again'
const URL = `https://github.com/${HERE}/issues/3438`
const FINDER = '3415'

const emit = vi.spyOn(run_event_stream_emit, 'emit')
const branch = vi.spyOn(git_command, 'branch')

function filing_to(target: string): Filing {
	const args = {
		title: TITLE,
		body_file: 'body.md',
		depth: '1',
		route: undefined,
		labels: [],
		repo: target,
		distinct: [],
		is_over_cap: false,
		is_auto_ok_opted_out: false,
		is_requested: false,
		is_release: false,
	}

	return { args, body: '', target, current: HERE }
}

beforeEach(() => {
	emit.mockResolvedValue()
	branch.mockResolvedValue('main')
	vi.stubEnv(lane_child_marker.KEY, undefined)
})

afterEach(() => {
	vi.unstubAllEnvs()
	vi.clearAllMocks()
})

describe('issue_file_cli.record', () => {
	it('names this repository’s Issue by number and the lane child that found it', async () => {
		vi.stubEnv(lane_child_marker.KEY, FINDER)

		await issue_file_cli.record(URL, filing_to(HERE), [])

		expect(emit).toHaveBeenCalledWith(
			run_event_stream.EVENT_KIND.FILED,
			`#3438[] ${TITLE} (found during #${FINDER})`,
		)
	})

	// joshuafolkken/kit#3494: the filing's classification label rides on the event, for the board's icon.
	it('writes the kind the filing’s labels classify it as', async () => {
		await issue_file_cli.record(URL, filing_to(HERE), ['auto-ok', 'bug'])

		expect(emit).toHaveBeenCalledWith(run_event_stream.EVENT_KIND.FILED, `#3438[bug] ${TITLE}`)
	})

	it('qualifies an Issue filed in another repository and names no child outside a lane', async () => {
		await issue_file_cli.record(URL, filing_to(THERE), [])

		expect(emit).toHaveBeenCalledWith(run_event_stream.EVENT_KIND.FILED, `${THERE}#3438[] ${TITLE}`)
	})

	// joshuafolkken/kit#3423: a person's run outside a lane is found by the Issue its branch names, so
	// the fold reads its earlier filings with no carry record to scope by.
	it('names the Issue the branch carries as the finder outside a lane', async () => {
		branch.mockResolvedValue(`${FINDER}-count-the-seats`)

		await issue_file_cli.record(URL, filing_to(HERE), [])

		expect(emit).toHaveBeenCalledWith(
			run_event_stream.EVENT_KIND.FILED,
			`#3438[] ${TITLE} (found during #${FINDER})`,
		)
	})
})
