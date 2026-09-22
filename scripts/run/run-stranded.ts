import { process_identity } from '#scripts/josh/process-identity'
import { run_carry, type CarryRead, type RunCarry } from './run-carry'
import type { RunWake } from './run-wake'

// The mechanical judge of a *stranded* run (joshuafolkken/kit#2375). On 2026-09-22 a `backlogrun`'s
// cost hand-off left the record carried and handed off, the session that cut it died, no successor ever
// claimed the budget, and no supervisor was watching — so five lanes ran on with nobody driving, and the
// only way forward was a person noticing and running the recovery by hand. Three facts, read and never
// weighed, are what say that state has been reached: the budget was handed off, its owner is gone, and
// no supervisor is alive to wake a successor.
//
// **Pure by design, exactly as `backlog-stalled.ts` is.** The carry read, the owner's liveness and the
// supervisor's are handed in, so the four acceptance cases — all three holding, a live owner, a claimed
// successor, and an unreadable record — and the supervisor's three-valued liveness are unit-tested
// without a process table or a wall clock. The I/O that gathers the three facts is
// `run-stranded-detect.ts`; this file only decides.
//
// **It is a report, never a stop.** A false positive costs one notification, never a halted run or a
// torn-down lane — so every axis is read toward *not* stranded when it cannot be proven: an unreadable
// carry record is not stranded, and a supervisor whose liveness cannot be established counts as watching.
// **And recovery is another actor's, not the reader's** (joshuafolkken/kit#1935): the cutting session is
// refused `busy` and must stay refused, so what the notification names is `run:wake --start`, which
// starts a supervisor that wakes a *fresh* successor rather than driving the run itself.

// **The recovery the notification names.** A supervisor started here reads the handed-off record and
// wakes a successor that claims it with `--owner "$PPID"` — the reader never adopts the budget itself,
// which is the `busy` refusal `run-carry.ts` → `is_count_refused` exists to keep.
const RECOVERY_COMMAND = 'pnpm josh run:wake --start'

// The three answers a supervisor's liveness probe gives, named (joshuafolkken/kit#2375). `live` is a
// supervisor still watching, `gone` is one whose process has died or a record that was never there at
// all, and `unknown` is the platform answering for nobody — a pid that is alive paired with a start
// token this machine could not read. The three are kept apart because the strand judge resolves
// `unknown` toward safety (it counts as watching) while `gone` is the one answer that contributes to a
// strand.
type SupervisorLiveness = 'live' | 'gone' | 'unknown'

const LIVE: SupervisorLiveness = 'live'
const GONE: SupervisorLiveness = 'gone'
const UNKNOWN: SupervisorLiveness = 'unknown'

type StrandedVerdict = 'stranded' | 'ok'

const STRANDED: StrandedVerdict = 'stranded'
const OK: StrandedVerdict = 'ok'

// The three facts, assembled by the detect layer and consumed only here. `read` carries the carry
// record's state, `is_owner_live` whether the process the record names still runs, and `supervisor` the
// three-valued liveness of the wake record.
interface StrandedInput {
	read: CarryRead
	is_owner_live: boolean
	supervisor: SupervisorLiveness
}

// **The supervisor's liveness, three-valued** (joshuafolkken/kit#2375). An absent wake record is `gone`:
// `run:wake --list` reported `none` in the run this fixes, and nothing watching is the very state a
// strand needs. A present record is read through `process_identity.is_same_process`, whose own three
// answers this passes straight through — `true` is `live`, `false` is `gone`, and the platform's "cannot
// tell" is `unknown`. The prober is injected so the three cases are tested without a real process.
function supervisor_liveness(
	wake: RunWake | undefined,
	same_process: (
		pid: number | undefined,
		start: string | undefined,
	) => boolean | undefined = process_identity.is_same_process,
): SupervisorLiveness {
	if (wake === undefined) return GONE

	const is_same = same_process(wake.pid, wake.process_start)

	if (is_same === undefined) return UNKNOWN

	return is_same ? LIVE : GONE
}

// **The whole of the judgement, in four reads.** The carry record must be `carried` — an `expired`,
// `none` or `unreadable` read is never a strand, because there is either no budget to strand or no way
// to trust what the record says. It must be handed off and *not* yet adopted — `adopt_carry` spends
// `is_handed_off` the instant a successor claims it, so a claimed successor reads `false` here. The owner
// must be gone — a live owner is a session still spending the budget, the ordinary in-flight state. And
// the supervisor must be `gone` — `live` or `unknown` both count as something that could still wake a
// successor, so only a proven-absent supervisor completes the strand.
function is_stranded(input: StrandedInput): boolean {
	if (
		input.read.kind !== 'carried' ||
		input.read.carry.is_handed_off !== true ||
		input.is_owner_live
	) {
		return false
	}

	return input.supervisor === GONE
}

// The one line a person reads in the notification and on the stream: which run is stranded, and why. The
// carry record's own summary carries the counts; this frames it as the strand it is.
function describe(carry: RunCarry): string {
	return `Run stranded — ${run_carry.describe_carry(carry)}. The owner is gone, no cut successor claimed the budget, and no supervisor is watching.`
}

function verdict_of(is_run_stranded: boolean): StrandedVerdict {
	return is_run_stranded ? STRANDED : OK
}

const run_stranded = {
	GONE,
	LIVE,
	OK,
	RECOVERY_COMMAND,
	STRANDED,
	UNKNOWN,
	describe,
	is_stranded,
	supervisor_liveness,
	verdict_of,
}

export { run_stranded }
export type { StrandedInput, StrandedVerdict, SupervisorLiveness }
