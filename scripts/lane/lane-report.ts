import type { LaneInfo } from './lane-registry'

// What a person reads when they ask what is open (joshuafolkken/kit#1490, joshuafolkken/kit#1494).
//
// The dev and preview ports are the ones the registry already resolved through `ports/index.js`
// when it read each lane's `.env`, so the numbers printed here are the same ones `josh port` and
// `playwright.config.ts` resolve inside the lane — nothing recomputes them, so there is no second
// formula for the two to disagree over.

const NO_LANES = 'No lanes are open.'
const OPEN_STATE = 'open'
// A registration whose work tree is gone: what an interruption leaves, and what `lane:prune` clears.
const STRANDED_STATE = 'stranded'
// A live lane whose `.env` cannot be read. It is shown rather than hidden, because it is what stops
// the next `lane:open` — a state nobody could see would look like an unexplained refusal.
const UNREADABLE_STATE = 'unreadable'
const UNKNOWN_VALUE = '-'
const COLUMN_SEPARATOR = '  '

function lane_state(lane: LaneInfo): string {
	if (lane.is_stranded) return STRANDED_STATE

	return lane.seat === undefined ? UNREADABLE_STATE : OPEN_STATE
}

function value_or_unknown(value: number | undefined): string {
	return value === undefined ? UNKNOWN_VALUE : String(value)
}

// The recorded output path goes last and is labelled, so it is told apart from the directory beside
// it (joshuafolkken/kit#1713). A lane that records none prints `output -` rather than nothing at
// all: a session that did not open the lane has to be able to see that the record is missing, not
// read a shorter row as one field it failed to notice.
function output_column(output: string | undefined): string {
	return `output ${output ?? UNKNOWN_VALUE}`
}

function describe_lane(lane: LaneInfo): string {
	return [
		`#${lane.issue}`,
		`seat ${value_or_unknown(lane.seat)}`,
		`dev ${value_or_unknown(lane.development_port)}`,
		`preview ${value_or_unknown(lane.preview_port)}`,
		lane.branch,
		lane_state(lane),
		lane.directory,
		output_column(lane.output),
	].join(COLUMN_SEPARATOR)
}

function describe_lanes(lanes: ReadonlyArray<LaneInfo>): string {
	if (lanes.length === 0) return NO_LANES

	return lanes.map((lane) => describe_lane(lane)).join('\n')
}

function describe_ports(lane: LaneInfo): string {
	if (lane.seat === undefined) return 'no lane seat could be read'

	return `seat ${String(lane.seat)}, dev ${value_or_unknown(lane.development_port)}, preview ${value_or_unknown(lane.preview_port)}`
}

// The one-line confirmation a person reads on standard error while standard output carries the
// directory alone, so `dir=$(pnpm josh lane:open 1490)` stays usable.
function describe_opened(lane: LaneInfo): string {
	return `Opened a lane for #${lane.issue} on ${lane.branch}: ${describe_ports(lane)}.`
}

const lane_report = {
	NO_LANES,
	OPEN_STATE,
	STRANDED_STATE,
	UNREADABLE_STATE,
	describe_lane,
	describe_lanes,
	describe_opened,
	lane_state,
}

export { lane_report }
