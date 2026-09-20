// The difference between the issues an `in-progress` label says are running and the lanes that are
// actually open (joshuafolkken/kit#2235).
//
// `epic:next` counts lane occupancy from the `in-progress` label list; `lane:list` reads the work
// trees that are actually open. Nothing named the difference, so a session read hand-made signals —
// `ls` and a remote branch's existence — and reported two running issues as stranded. The two sets
// disagree in two directions, and the harm is asymmetric: a label with no lane silently shrinks the
// free-lane count, while a lane with no label lets another session claim the same issue and open a
// second pull request on the same branch.
//
// **The judgement is read from the two sets, never invented.** The classification is three-valued so
// an unreadable lane listing stays `unknown` rather than collapsing to `stopped` — reported as a dead
// lane, a live one would have its stale label cleared and its issue handed out again.
//
// **Nothing here writes a label.** Removing `in-progress` from a live run is exactly the mistake that
// opens a second pull request, so the repair is a person's — this module only names the difference.

// How a lane listing arrived: the open lanes' issue numbers, or that the listing could not be read.
type LaneRead = { kind: 'lanes'; issues: ReadonlyArray<number> } | { kind: 'unreadable' }

// The three liveness verdicts, named so the `lane:list` oracle vocabulary reads them from here rather
// than repeating the literals. `LIVE` is the silent norm; `STOPPED` and `UNKNOWN` lead the anomaly
// lines below so the token a reader greps for is the one this module classifies with.
const LIVE = 'live'
const STOPPED = 'stopped'
const UNKNOWN = 'unknown'

// Whether an `in-progress` issue's lane is open, stopped, or could not be determined. `unknown` is
// the answer when the lane listing itself could not be read — never `stopped`, which would report a
// running lane as dead.
type Liveness = typeof LIVE | typeof STOPPED | typeof UNKNOWN

interface LabelledIssue {
	issue: number
	liveness: Liveness
}

interface OccupancyReport {
	// Every `in-progress` issue with its lane liveness. A `live` one is the ordinary case; a `stopped`
	// or `unknown` one is the anomaly `describe` names.
	labelled: ReadonlyArray<LabelledIssue>
	// Open lanes whose issue carries no `in-progress` label — the reverse difference. Empty when the
	// lane listing could not be read, since there is nothing to compare against.
	lanes_without_label: ReadonlyArray<number>
}

function to_liveness(issue: number, lanes: LaneRead): Liveness {
	if (lanes.kind === 'unreadable') return UNKNOWN

	return lanes.issues.includes(issue) ? LIVE : STOPPED
}

function to_lanes_without_label(
	in_progress: ReadonlyArray<number>,
	lanes: LaneRead,
): Array<number> {
	if (lanes.kind === 'unreadable') return []

	return lanes.issues.filter((issue) => !in_progress.includes(issue))
}

// The two-directional difference between the `in-progress` issues and the open lanes. Pure: it reads
// the two sets and writes nothing, which is what keeps the label untouched.
function classify(in_progress: ReadonlyArray<number>, lanes: LaneRead): OccupancyReport {
	return {
		labelled: in_progress.map((issue) => ({ issue, liveness: to_liveness(issue, lanes) })),
		lanes_without_label: to_lanes_without_label(in_progress, lanes),
	}
}

function stopped_line(issue: number): string {
	return `⚠ ${STOPPED} #${String(issue)} — carries \`in-progress\` but no lane is open — a stale label. Remove it if the run is done (labels are a person's to change), or reopen the lane.`
}

function unknown_line(issue: number): string {
	return `⚠ ${UNKNOWN} #${String(issue)} — carries \`in-progress\` but the lane listing could not be read, so whether its lane is live is unknown — do not treat it as stopped.`
}

function without_label_line(issue: number): string {
	return `⚠ a lane is open for #${String(issue)} but it carries no \`in-progress\` label — another session could claim the same issue. Apply the label or close the lane (a person's, never this command's).`
}

function labelled_lines(labelled: ReadonlyArray<LabelledIssue>): Array<string> {
	return labelled.flatMap((entry) => {
		if (entry.liveness === 'stopped') return [stopped_line(entry.issue)]
		if (entry.liveness === 'unknown') return [unknown_line(entry.issue)]

		return []
	})
}

// The anomalies as lines for standard error, or `undefined` when the two sets agree — the same shape
// `lane:list` follows for every explanation, so its standard output stays a token per line.
function describe(report: OccupancyReport): string | undefined {
	const lines = [
		...labelled_lines(report.labelled),
		...report.lanes_without_label.map((issue) => without_label_line(issue)),
	]

	return lines.length === 0 ? undefined : lines.join('\n')
}

const lane_occupancy = {
	LIVE,
	STOPPED,
	UNKNOWN,
	classify,
	describe,
}

export { lane_occupancy }
export type { LabelledIssue, LaneRead, Liveness, OccupancyReport }
