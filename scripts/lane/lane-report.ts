import { PORT_SEED_KEY, ports } from '#ports'
import type { LaneInfo } from './lane-registry'

// What a person reads when they ask what is open (joshuafolkken/kit#1490).
//
// The ports are computed through `ports/index.js` rather than by adding the bases here, so the
// numbers printed are the same numbers `josh port` and `playwright.config.ts` will resolve inside
// the lane — a second formula would be a place for them to disagree.

const NO_LANES = 'No lanes are open.'
const OPEN_STATE = 'open'
// A registration whose work tree is gone: what an interruption leaves, and what `lane:prune` clears.
const STRANDED_STATE = 'stranded'
// A live lane whose `.env` cannot be read. It is shown rather than hidden, because it is what stops
// the next `lane:open` — a state nobody could see would look like an unexplained refusal.
const UNREADABLE_STATE = 'unreadable'
const UNKNOWN_VALUE = '-'
const COLUMN_SEPARATOR = '  '

function seed_environment(seed: number): Record<string, string> {
	return { [PORT_SEED_KEY]: String(seed) }
}

function development_port(seed: number): number {
	return ports.resolve_development_port(seed_environment(seed))
}

function preview_port(seed: number): number {
	return ports.resolve_preview_port(seed_environment(seed))
}

function lane_state(lane: LaneInfo): string {
	if (lane.is_stranded) return STRANDED_STATE

	return lane.seed === undefined ? UNREADABLE_STATE : OPEN_STATE
}

function seed_columns(seed: number | undefined): Array<string> {
	if (seed === undefined) return [UNKNOWN_VALUE, UNKNOWN_VALUE, UNKNOWN_VALUE]

	return [String(seed), String(development_port(seed)), String(preview_port(seed))]
}

// The recorded output path goes last and is labelled, so it is told apart from the directory beside
// it (joshuafolkken/kit#1713). A lane that records none prints `output -` rather than nothing at
// all: a session that did not open the lane has to be able to see that the record is missing, not
// read a shorter row as one field it failed to notice.
function output_column(output: string | undefined): string {
	return `output ${output ?? UNKNOWN_VALUE}`
}

function describe_lane(lane: LaneInfo): string {
	const [seed, development, preview] = seed_columns(lane.seed)

	return [
		`#${lane.issue}`,
		`seed ${String(seed)}`,
		`dev ${String(development)}`,
		`preview ${String(preview)}`,
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

function describe_ports(seed: number | undefined): string {
	if (seed === undefined) return 'no port seed could be read'

	return `${PORT_SEED_KEY}=${String(seed)}, dev ${String(development_port(seed))}, preview ${String(preview_port(seed))}`
}

// The one-line confirmation a person reads on standard error while standard output carries the
// directory alone, so `dir=$(pnpm josh lane:open 1490)` stays usable.
function describe_opened(lane: LaneInfo): string {
	return `Opened a lane for #${lane.issue} on ${lane.branch}: ${describe_ports(lane.seed)}.`
}

const lane_report = {
	NO_LANES,
	OPEN_STATE,
	STRANDED_STATE,
	UNREADABLE_STATE,
	describe_lane,
	describe_lanes,
	describe_opened,
	development_port,
	lane_state,
	preview_port,
}

export { lane_report }
