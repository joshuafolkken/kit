import { git_command } from '#scripts/git/git-command'
import { issue_file_deferral } from '#scripts/issue/issue-file-deferral'
import { issue_file_interrupt } from '#scripts/issue/issue-file-interrupt'
import { INTERRUPT_ROUTE_LABEL, SPLIT_ROUTE_LABEL } from '#scripts/issue/issue-labels'
import { lane_child_marker } from '#scripts/lane/lane-child-marker'
import { run_event_stream } from '#scripts/run/event/run-event-stream'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'
import { run_hold_member } from '#scripts/run/hold/run-hold-member'
import { split_resolution } from '#scripts/split/split-resolution'
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
const is_run_member = vi.spyOn(run_hold_member, 'is_run_member')
const record_child = vi.spyOn(split_resolution, 'record_child')
const block_finder = vi.spyOn(issue_file_interrupt, 'block_finder')
const note_finder = vi.spyOn(issue_file_deferral, 'note_finder')

function filing_to(target: string): Filing {
	const args = {
		title: TITLE,
		body_file: 'body.md',
		depth: '1',
		route: undefined,
		labels: [],
		repo: target,
		distinct: [],
		found_during: undefined,
		is_over_cap: false,
		is_auto_ok_opted_out: false,
		is_release: false,
		is_blocking_finder: false,
	}

	return { args, body: '', target, current: HERE }
}

beforeEach(() => {
	emit.mockResolvedValue()
	branch.mockResolvedValue('main')
	is_run_member.mockResolvedValue(false)
	record_child.mockResolvedValue()
	block_finder.mockResolvedValue()
	note_finder.mockResolvedValue()
	vi.stubEnv(lane_child_marker.KEY, undefined)
})

afterEach(() => {
	vi.unstubAllEnvs()
	vi.clearAllMocks()
})

// joshuafolkken/kit#4695: a split child is recorded against the lane child that found it, which is what
// answers that lane's split notice before the gate.
describe('issue_file_cli.record — a split child', () => {
	it('hands the route, the finder and the filed reference to the split record', async () => {
		vi.stubEnv(lane_child_marker.KEY, FINDER)
		const filing = filing_to(HERE)

		await issue_file_cli.record(
			URL,
			{ ...filing, args: { ...filing.args, route: SPLIT_ROUTE_LABEL } },
			[],
		)

		expect(record_child).toHaveBeenCalledExactlyOnceWith({
			route: SPLIT_ROUTE_LABEL,
			found_during: FINDER,
			child: '#3438',
		})
	})
})

// joshuafolkken/kit#4768: an interrupt filing hands its finder to the blocked-by record.
describe('issue_file_cli.record — an interrupt', () => {
	it('hands the route, the flag, the finder and the filed number to the blocked-by record', async () => {
		vi.stubEnv(lane_child_marker.KEY, FINDER)
		const filing = filing_to(HERE)
		const args = { ...filing.args, route: INTERRUPT_ROUTE_LABEL, is_blocking_finder: true }

		await issue_file_cli.record(URL, { ...filing, args }, [])

		expect(block_finder).toHaveBeenCalledExactlyOnceWith({
			route: INTERRUPT_ROUTE_LABEL,
			is_blocking_finder: true,
			found_during: FINDER,
			blocker: 3438,
			is_here: true,
		})
	})
})

// joshuafolkken/kit#4821: only a `--found-during` the filing names leaves a deferral note.
describe('issue_file_cli.record — the deferral note', () => {
	it('hands the named finder, the filed reference and the title to the note', async () => {
		const filing = filing_to(HERE)

		await issue_file_cli.record(
			URL,
			{ ...filing, args: { ...filing.args, found_during: '77' } },
			[],
		)

		expect(note_finder).toHaveBeenCalledExactlyOnceWith({
			found_during: '77',
			reference: '#3438',
			title: TITLE,
			current: HERE,
		})
	})

	it('hands no finder when the filing names none, even under a lane child’s mark', async () => {
		vi.stubEnv(lane_child_marker.KEY, FINDER)

		await issue_file_cli.record(URL, filing_to(HERE), [])

		expect(note_finder).toHaveBeenCalledWith(expect.objectContaining({ found_during: undefined }))
	})
})

// joshuafolkken/kit#4750: `--found-during` names the finder over the lane child's mark.
describe('issue_file_cli.record — a named finder', () => {
	it('names the Issue the filing says it was found during', async () => {
		vi.stubEnv(lane_child_marker.KEY, FINDER)
		const filing = filing_to(HERE)

		await issue_file_cli.record(
			URL,
			{ ...filing, args: { ...filing.args, found_during: '77' } },
			[],
		)

		expect(emit).toHaveBeenCalledWith(
			run_event_stream.EVENT_KIND.FILED,
			`#3438[] ${TITLE} (found during #77)`,
		)
	})
})

describe('issue_file_cli.record', () => {
	it('names this repository’s Issue by number and the lane child that found it', async () => {
		vi.stubEnv(lane_child_marker.KEY, FINDER)
		is_run_member.mockResolvedValue(true)

		await issue_file_cli.record(URL, filing_to(HERE), [])

		expect(emit).toHaveBeenCalledWith(
			run_event_stream.EVENT_KIND.FILED,
			`#3438[][run] ${TITLE} (found during #${FINDER})`,
		)
	})

	// joshuafolkken/kit#4099: only a run's own session marks its filing as the run's.
	it('leaves a filing from a session outside the run unmarked', async () => {
		await issue_file_cli.record(URL, filing_to(HERE), [])

		expect(emit).toHaveBeenCalledWith(run_event_stream.EVENT_KIND.FILED, `#3438[] ${TITLE}`)
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
