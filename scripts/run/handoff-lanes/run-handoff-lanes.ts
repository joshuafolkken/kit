import { session_cite } from '#scripts/issue/session-cite'
import { josh_command, type JoshResult } from '#scripts/josh/josh-run'
import { lane_registry, type LaneInfo } from '#scripts/lane/lane-registry'
import { lane_report } from '#scripts/lane/lane-report'

// `josh run:handoff-lanes` (joshuafolkken/kit#5845): a `backlogrun` parent's hand-off in one call
// rather than one model round trip per command (`backlogrun-progress.md` → "The hand-off"). It asks
// `cost --cut`; on `over` it reads the lanes, and once every in-flight lane can be polled it runs
// `run:carry --cut`, `run:board --chat` and `run:report --handoff` in order. Each step is its own
// `josh` command, so its verdict stays that command's own; this file only chains and judges them.

const SUCCESS_EXIT_CODE = 0
const COMMAND = 'run:handoff-lanes'
const UNDER_VERDICT = 'under'
const CUT_VERDICT = 'cut'
const BLOCKED_VERDICT = 'blocked'
const CAPPED_VERDICT = 'capped'
const COST_STEP = ['cost', '--cut']
const CARRY_STEP = ['run:carry', '--cut']
const AFTER_CARRY: ReadonlyArray<ReadonlyArray<string>> = [
	['run:board', '--chat'],
	['run:report', '--handoff'],
]

type StepRunner = (argv: ReadonlyArray<string>) => Promise<JoshResult>
type LaneReader = () => Promise<ReadonlyArray<LaneInfo>>
type Print = (text: string) => void

// What the chain reads and writes through, so a test drives it without a subprocess.
interface HandoffIo {
	run: StepRunner
	lanes: LaneReader
	print: Print
}

function first_line(text: string): string {
	return text.split('\n', 1)[0]?.trim() ?? ''
}

function report(verdict: string, next: string): string {
	return `${COMMAND} — ${verdict}\nnext: ${next}`
}

function cites(lanes: ReadonlyArray<LaneInfo>): string {
	return lanes.map((lane) => session_cite.issue(lane.issue)).join(' ')
}

// Only a clean `under` goes back to the loop: an exit 1 with no answer takes `over`'s branch.
function is_under(cost: JoshResult): boolean {
	return cost.code === SUCCESS_EXIT_CODE && first_line(cost.out) === UNDER_VERDICT
}

// A lane nobody can poll — its seat unreadable, or no output path recorded. A stranded lane has no
// child working in it, so it is not in flight and never blocks the cut.
function blocking_lanes(
	lanes: ReadonlyArray<LaneInfo>,
	unreadable: ReadonlySet<LaneInfo>,
): ReadonlyArray<LaneInfo> {
	return lanes.filter(
		(lane) => !lane.is_stranded && (unreadable.has(lane) || lane.output === undefined),
	)
}

// Every reason a lane cannot be polled, so the next ask is not blocked by the one left unnamed.
function blocked_fix(lane: LaneInfo, unreadable: ReadonlySet<LaneInfo>): string {
	const reasons = [
		...(unreadable.has(lane) ? [`is ${lane_report.lane_state(lane)}`] : []),
		...(lane.output === undefined
			? [`records no path: \`pnpm josh lane:output ${lane.issue} <path>\``]
			: []),
	]

	return `${session_cite.issue(lane.issue)} ${reasons.join(' and ')}`
}

function blocked_report(
	blocked: ReadonlyArray<LaneInfo>,
	unreadable: ReadonlySet<LaneInfo>,
): string {
	const fixes = blocked.map((lane) => blocked_fix(lane, unreadable)).join('; ')

	return report(
		`${BLOCKED_VERDICT} ${cites(blocked)}`,
		`no cut, and never assume idle — ${fixes}; name them in the progress comment and re-ask at the next merge`,
	)
}

function print_stranded(lanes: ReadonlyArray<LaneInfo>, print: Print): void {
	const stranded = lanes.filter((lane) => lane.is_stranded)

	if (stranded.length > 0) {
		print(`stranded: ${cites(stranded)} — close with \`pnpm josh lane:prune\``)
	}
}

function fail(io: HandoffIo, argv: ReadonlyArray<string>, code: number): number {
	io.print(
		report(
			`stopped at ${argv.join(' ')} (exit ${String(code)})`,
			`settle what it refused, then rerun \`pnpm josh ${COMMAND}\``,
		),
	)

	return code
}

async function step(io: HandoffIo, argv: ReadonlyArray<string>): Promise<JoshResult> {
	const result = await io.run(argv)

	if (result.out !== '') io.print(result.out)

	return result
}

// The steps after a counted cut: the board is posted before the hand-off report.
async function finish_cut(io: HandoffIo): Promise<number> {
	for (const argv of AFTER_CARRY) {
		// eslint-disable-next-line no-await-in-loop -- each step reads the record the one before it left
		const result = await step(io, argv)

		if (result.code !== SUCCESS_EXIT_CODE) return fail(io, argv, result.code)
	}

	io.print(report(CUT_VERDICT, 'end the turn; the `run:wake` driver polls the lanes'))

	return SUCCESS_EXIT_CODE
}

async function cut(io: HandoffIo): Promise<number> {
	const carry = await step(io, CARRY_STEP)

	if (carry.code !== SUCCESS_EXIT_CODE) return fail(io, CARRY_STEP, carry.code)
	if (first_line(carry.out) !== CAPPED_VERDICT) return await finish_cut(io)
	io.print(
		report(
			CAPPED_VERDICT,
			'no `run:wake` and no hand-off; carry this session on and re-ask at the next merge',
		),
	)

	return SUCCESS_EXIT_CODE
}

async function over(io: HandoffIo): Promise<number> {
	const lanes = await io.lanes()

	print_stranded(lanes, io.print)
	const unreadable = new Set(lane_registry.unreadable_lanes(lanes))
	const blocked = blocking_lanes(lanes, unreadable)

	if (blocked.length === 0) return await cut(io)
	io.print(blocked_report(blocked, unreadable))

	return SUCCESS_EXIT_CODE
}

async function run(io: HandoffIo): Promise<number> {
	const cost = await step(io, COST_STEP)

	if (cost.code !== SUCCESS_EXIT_CODE) {
		io.print(`cost --cut could not answer (exit ${String(cost.code)}); taking over's branch`)
	}

	if (!is_under(cost)) return await over(io)
	io.print(report(UNDER_VERDICT, 'back to the loop'))

	return SUCCESS_EXIT_CODE
}

async function josh_step(argv: ReadonlyArray<string>): Promise<JoshResult> {
	return await josh_command.josh_run(argv, true)
}

async function read_lanes(): Promise<ReadonlyArray<LaneInfo>> {
	return await lane_registry.list_lanes()
}

const DEFAULT_IO: Omit<HandoffIo, 'print'> = { run: josh_step, lanes: read_lanes }

const run_handoff_lanes = { DEFAULT_IO, run }

export type { HandoffIo }
export { run_handoff_lanes }
