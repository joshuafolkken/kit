import { PROJECT_ROOT } from './init/init-paths'
import { stamp_file } from './josh/stamp-file'

// The verification gate's full output, kept somewhere the console's size limit cannot reach
// (joshuafolkken/kit#1227).
//
// **The problem is that the only copy of a failure's detail was the console.** `josh gate` buffers
// every check and prints the failing ones whole, and joshuafolkken/kit#1173 then declared
// `BASH_MAX_OUTPUT_LENGTH` at 8,000 characters — a cap on what a command may carry into an agent's
// context, with a measured p99 of 15,989 characters for a Bash call. The verdict is the last line and
// so always survives, which is why a red gate can never read as green; what does not survive is the
// middle, and the middle is where the failure says what it was. The escape hatch was to re-run one
// check by hand, which is a judgement the reader has to make about output they cannot see.
//
// So the gate writes every check's output to a file and prints where it is. Nothing about the
// verdict changes; what changes is that the detail behind it no longer exists only in a window that
// may have been elided.

const GATE_LOG_PREFIX = 'josh-gate-log-'
const GATE_LOG_SUFFIX = '.log'

// **The temp directory, per checkout, deterministic — the convention `stamp-file.ts` already
// defines**, and it is imported rather than re-derived. A file inside the repository would need a
// gitignore entry here and in every consumer `josh sync` reaches, bought for something nobody keeps.
// The path is stable across runs, so each gate overwrites the last one's log: one file per checkout,
// and nothing accumulates.
function gate_log_path(target?: string): string {
	return target ?? stamp_file.stamp_path(GATE_LOG_PREFIX, PROJECT_ROOT, GATE_LOG_SUFFIX)
}

// The header the console already prints for this step, reused verbatim. The gate builds it once and
// hands it here, so a log section can never name a check differently from the block above it.
interface GateLogEntry {
	header: string
	output: string
}

function format_gate_log_entry(entry: GateLogEntry): string {
	return `=== ${entry.header} ===\n${entry.output}\n`
}

function format_gate_log(entries: ReadonlyArray<GateLogEntry>): string {
	return entries.map((entry) => format_gate_log_entry(entry)).join('\n')
}

// **Written on every run that started a check, passing ones included.** Writing only on failure
// would make the record a judgement about which runs are worth keeping, and the judgement is wrong
// in both of the cases that already print a body on a green gate: a check that passed with warnings,
// and one that passed without running. It also costs a reader nothing — the file is overwritten, so
// a green run leaves exactly as many files behind as a red one. A gate that reused a recorded green
// result started no check and has nothing to write, which is why this is called from the checked
// path alone.
//
// **A write that fails never changes the verdict.** The log is a convenience for whoever reads the
// output next, and a temp-directory problem must not turn a green gate red — the same rule the
// green-gate record and the in-flight marker already follow. `undefined` is that failure, and the
// notice below says so out loud rather than leaving the reader to notice a missing line.
function write_gate_log(entries: ReadonlyArray<GateLogEntry>, target?: string): string | undefined {
	const destination = gate_log_path(target)

	try {
		return stamp_file.write_text_stamp(destination, format_gate_log(entries))
	} catch {
		return undefined
	}
}

const LOG_NOTICE_PREFIX = 'full output: '
const LOG_FAILED_NOTICE = 'full output: could not be written; re-run with `> gate.log 2>&1`'

// **The notice goes immediately *above* the verdict, never below it.** `josh-verdict.ts` documents
// the gate's verdict as its last line and builds two readers on that: `time-reported-failure.ts`
// resumes its scan after the verdict, and the `2>&1 | tail -40` in
// `prompts/collaboration-workflow/output-bounds.md` keeps the end of the output. A line after the
// verdict would sit inside both of those windows and take the property away for a line that is not
// the answer. Above it, the path survives a `tail` exactly as the verdict does.
function format_log_notice(log_path: string | undefined): string {
	if (log_path === undefined) return `${LOG_FAILED_NOTICE}\n`

	return `${LOG_NOTICE_PREFIX}${log_path}\n`
}

const gate_log = {
	format_gate_log,
	format_log_notice,
	gate_log_path,
	GATE_LOG_PREFIX,
	GATE_LOG_SUFFIX,
	LOG_FAILED_NOTICE,
	LOG_NOTICE_PREFIX,
	write_gate_log,
}

export type { GateLogEntry }
export { gate_log }
