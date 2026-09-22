import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { lane_child_marker, type MarkerSource } from '#scripts/lane/lane-child-marker'
import { run_event_stream } from '#scripts/run/run-event-stream'
import { describe, expect, it } from 'vitest'
import { delivered_rules } from './delivered-rules'
import { setup_cut, type LaneSetupState } from './setup-cut'

// joshuafolkken/kit#2346: the setup-phase cut refuses the first implementation edit a dispatched lane
// child makes once its plan is posted. This suite owns the two halves that decide whether it fires —
// the `Edit` / `Write` occasion in a marked lane child, and the "is the plan the newest event on the
// run stream" read — and both directions matter: a row that stays silent leaves the ~130,000 tokens of
// setup context riding on every request, and one that speaks in an ordinary checkout refuses a person.

const ISSUE = '2346'
const EDIT = 'Edit'
const { PLAN, CUT } = run_event_stream.EVENT_KIND
const WORK_DIRECTORY = mkdtempSync(path.join(tmpdir(), 'setup-cut-'))
const LANE_DIRECTORY = path.join(WORK_DIRECTORY, '.kit-lanes', ISSUE)

const TAKE_THE_SETUP_CUT = `pnpm josh run:cut ${ISSUE} --setup`
const BARE_CUT = `pnpm josh run:cut ${ISSUE}`
const IMPL_CUT = `pnpm josh run:cut --impl ${ISSUE}`
const RESUME_CHECK = `pnpm josh run:cut --resume ${ISSUE}`

interface StateOptions {
	directory?: string
	mark?: string | undefined
	last_event?: () => string | undefined
}

function mark_of(options: StateOptions): string | undefined {
	return 'mark' in options ? options.mark : ISSUE
}

function source_of(mark: string | undefined): MarkerSource {
	return mark === undefined ? {} : { [lane_child_marker.KEY]: mark }
}

function state_of(options: StateOptions = {}): LaneSetupState {
	const { directory = LANE_DIRECTORY, last_event = (): string => PLAN } = options

	return { directory, source: source_of(mark_of(options)), last_event }
}

function edit_call(name = EDIT): { name: string; input: unknown } {
	return { name, input: { file_path: 'scripts/x.ts', old_string: 'a', new_string: 'b' } }
}

// A stream thunk that fails the test if read — proves the git-and-stream read is gated behind the cheap
// tool-name and lane reads, never run on a call this guard does not own.
function unread_event(): string {
	throw new Error('the run stream was read for a call the guard does not own')
}

describe('takes_the_setup_cut', () => {
	it.each([
		[TAKE_THE_SETUP_CUT],
		[`pnpm josh rct ${ISSUE} --setup`],
		[`pnpm josh run:cut --setup=${ISSUE}`],
	])('reads %j as taking the setup cut', (command) => {
		expect(setup_cut.takes_the_setup_cut(command)).toBe(true)
	})

	// The bare cut is the pre-gate boundary, `--impl` the implementation one, and the asking spellings are
	// not a cut — a predicate that counted any of them would credit the wrong boundary as the setup one.
	it.each([[BARE_CUT], [IMPL_CUT], [RESUME_CHECK], ['pnpm josh gate']])(
		'says nothing about %j',
		(command) => {
			expect(setup_cut.takes_the_setup_cut(command)).toBe(false)
		},
	)
})

describe('lane_child_issue', () => {
	it('names the issue for a marked lane child', () => {
		expect(setup_cut.lane_child_issue(state_of())).toBe(ISSUE)
	})

	it('says nothing for a person working in the lane with no mark', () => {
		expect(setup_cut.lane_child_issue(state_of({ mark: undefined }))).toBeUndefined()
	})

	it('says nothing when the mark names another issue', () => {
		expect(setup_cut.lane_child_issue(state_of({ mark: '2345' }))).toBeUndefined()
	})
})

describe('is_uncut_setup_edit', () => {
	it('fires on the first edit once the plan is the newest event', () => {
		expect(setup_cut.is_uncut_setup_edit(edit_call(), state_of())).toBe(true)
	})

	it('fires on a Write as well as an Edit', () => {
		expect(setup_cut.is_uncut_setup_edit(edit_call('Write'), state_of())).toBe(true)
	})

	// Setup is not done until the plan is posted; an empty stream is a run still reading, and a `cut`
	// event is already past the boundary — neither is the setup window.
	it.each([[undefined], [CUT], ['merge']])('stays silent when the newest event is %s', (kind) => {
		const state = state_of({ last_event: (): string | undefined => kind })

		expect(setup_cut.is_uncut_setup_edit(edit_call(), state)).toBe(false)
	})

	it('stays silent for a non-edit tool without reading the stream', () => {
		const state = state_of({ last_event: unread_event })

		expect(setup_cut.is_uncut_setup_edit({ name: 'Bash', input: {} }, state)).toBe(false)
	})

	it('stays silent for a person without reading the stream', () => {
		const state = state_of({ mark: undefined, last_event: unread_event })

		expect(setup_cut.is_uncut_setup_edit(edit_call(), state)).toBe(false)
	})
})

describe('the row is delivered', () => {
	it('is registered among the delivered rules', () => {
		expect(delivered_rules.DELIVERED_RULES.some((rule) => rule.id === 'setup-cut')).toBe(true)
	})
})
