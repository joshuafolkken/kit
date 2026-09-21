import { run_event_stream } from './run-event-stream'
import { run_step, type StepInput } from './run-step'

// The golden-transcript input for the run driver (joshuafolkken/kit#2250). #2248 lifted the run's step
// sequence out of prose and into `run-step.ts`'s `next_action`; once the steps are code, the steps can
// be pinned. This drives that pure function across the representative scenarios and renders one line per
// turn, so `run-transcript-fixture.test.ts` can hold the whole sequence byte-for-byte against a
// checked-in golden — a regression in the steps shows as a diff rather than passing a prose slice that
// silently degraded to an empty string.
//
// **Nothing here reads GitHub, the clock, a process or the filesystem.** The driver is a pure function
// of three mechanical facts, so the same fixture always renders the same transcript — the property the
// golden depends on.

const KIND = run_event_stream.EVENT_KIND
const ISSUE = '2250'

// The three facts the driver branches on, at their unremarkable values: an open issue, nothing owed,
// nothing carried, no event emitted yet. Each frame states only what its turn changes.
const DEFAULTS: StepInput = {
	issue_number: ISSUE,
	state: 'OPEN',
	is_human_review: false,
	latest_scope: 'skip',
	last_event: undefined,
	carry_kind: 'none',
	is_lane_child: false,
}

// One turn of a run: `label` names the position the run has reached in words, and `at` is the change
// this turn makes to the driver's input. The action is computed from the input, never written into the
// fixture — that is what makes the golden a test of the driver rather than of itself.
interface Frame {
	label: string
	at: Partial<StepInput>
}

interface Scenario {
	name: string
	summary: string
	base: Partial<StepInput>
	frames: ReadonlyArray<Frame>
}

const START: Frame = { label: 'start', at: {} }
const PLANNED: Frame = { label: 'planned', at: { last_event: KIND.PLAN } }

// The five scenarios the acceptance criteria name — a child completing, a park, a cut and its resume,
// lanes full, and the consecutive-failure stop — followed by the terminal answers the driver reads
// before position matters.
const SCENARIOS: ReadonlyArray<Scenario> = [
	{
		name: 'child-completion',
		summary: 'a launched child runs through to its merge',
		base: {},
		frames: [
			START,
			PLANNED,
			{ label: 'child launched', at: { last_event: KIND.CHILD_LAUNCH } },
			{ label: 'child merged', at: { last_event: KIND.MERGE } },
		],
	},
	{
		name: 'park',
		summary: 'a child is parked and the batch moves on',
		base: {},
		frames: [START, { label: 'child parked', at: { last_event: KIND.PARK } }],
	},
	{
		name: 'cut-and-resume',
		summary: 'the run is cut before its gate, then resumes to the merge',
		base: {},
		frames: [
			START,
			{ label: 'cut taken', at: { last_event: KIND.CUT } },
			{ label: 'resumed, pr open', at: { last_event: KIND.PR_OPENED, carry_kind: 'carried' } },
			{ label: 'second review', at: { last_event: KIND.REVIEW_ROUND, carry_kind: 'carried' } },
			{ label: 'merged', at: { last_event: KIND.MERGE, carry_kind: 'carried' } },
		],
	},
	{
		name: 'lanes-full',
		summary: 'every lane holds a child, so the parent waits',
		base: {},
		frames: [START, { label: 'lanes full', at: { last_event: KIND.CHILD_LAUNCH } }],
	},
	{
		name: 'consecutive-failure-stop',
		summary: 'the failure guard stops the run',
		base: {},
		frames: [
			START,
			{ label: 'outage', at: { last_event: KIND.OUTAGE } },
			{ label: 'guard stops', at: { last_event: KIND.STOP } },
		],
	},
	{
		name: 'expired-budget',
		summary: 'the whole-run budget is spent — a person decides',
		base: { carry_kind: 'expired' },
		frames: [START],
	},
	{
		name: 'unreadable-carry',
		summary: 'the carry record cannot be read',
		base: { carry_kind: 'unreadable' },
		frames: [START],
	},
	{
		name: 'closed-already-done',
		summary: 'the issue is already closed, whatever the events say',
		base: { state: 'CLOSED' },
		frames: [START, { label: 'after a merge', at: { last_event: KIND.MERGE } }],
	},
	{
		name: 'needs-human-review',
		summary: 'the issue stops before its commit for a person',
		base: { is_human_review: true },
		frames: [START],
	},
	{
		name: 'update-deps-first',
		summary: 'a required dependency update comes before implementing',
		base: { latest_scope: 'required' },
		frames: [START],
	},
]

const LABEL_WIDTH = 18
const KIND_WIDTH = 8

function frame_input(base: Partial<StepInput>, at: Partial<StepInput>): StepInput {
	return { ...DEFAULTS, ...base, ...at }
}

// One transcript line: the position in words, the action's kind, and the exact line the driver prints.
function render_frame(base: Partial<StepInput>, frame: Frame): string {
	const action = run_step.next_action(frame_input(base, frame.at))

	return `  ${frame.label.padEnd(LABEL_WIDTH)} ${action.kind.padEnd(KIND_WIDTH)} ${action.line}`
}

function render_scenario(scenario: Scenario): string {
	const header = `## ${scenario.name}\n${scenario.summary}`
	const lines = scenario.frames.map((frame) => render_frame(scenario.base, frame))

	return [header, ...lines].join('\n')
}

function render_all(): string {
	return `${SCENARIOS.map((scenario) => render_scenario(scenario)).join('\n\n')}\n`
}

const run_transcript = { render_all }

export { run_transcript }
