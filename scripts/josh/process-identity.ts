import { execFileSync } from 'node:child_process'

// Whether the process a record names is still the one that wrote it (joshuafolkken/kit#1245).
//
// **A pid is not a process identity, and every record here was treating it as one.** `process.kill(
// pid, 0)` answers "alive" for whatever holds that number *now*, so a marker left behind by a gate
// that was killed starts reading as live again the moment the operating system reissues its pid. For
// the in-flight gate marker that means `josh review:brief` printing "a gate is running on this tree"
// about a gate that no longer exists — a verification saying something that is not true, which is the
// one thing these records exist to prevent.
//
// **The identity is the pair (pid, start time).** A reissued pid necessarily started *after* the
// record was written, so its start time differs and the pair separates the two processes outright.
// This is the fix rather than a narrowing of the window: a lifetime on the record, the other
// candidate, only shortens how long a phantom can be believed.
//
// **The start time is an opaque token, never a date.** Both sides obtain it from the same command in
// the same format and compare it for equality; nothing here parses it, so the source may be replaced
// per platform without any reader changing. Second resolution is enough — a pid is reissued only
// after the whole pid space has wrapped, which takes very many process creations and never the same
// second in which the recorded process started.
//
// **The token is only opaque if it is also stable, which it is not by default.** `ps` renders the
// start time through the caller's own time zone and locale, so the *same* process prints
// `Tue Sep  8 09:15:33 2026` in one shell and `Tue Sep  8 02:15:33 2026` in another that exported
// `TZ=UTC` — and a writer and reader disagreeing about `TZ` would read a live process as a stranger.
// That failure is worse than the one this module fixes, because it fires on a gate that really is
// running: `unit-worker-share` would sweep the marker of a live run and put every suite back on the
// whole machine, and `bench-guard` would clear the caches out from under a running gate. The probe
// therefore pins `TZ` and `LC_ALL` rather than inheriting them.

// The absolute path rather than a name resolved through `PATH`, which both removes the lookup from
// whatever the caller's environment happens to be and lets the probe run with no inherited
// environment at all. macOS and every Linux distribution this runs on ship `ps` here; where it is
// absent the probe answers "cannot tell", which is a case every caller already handles.
const PS_COMMAND = '/bin/ps'
const FORMAT_FLAG = '-o'
// `lstart` is the process's start time, printed as `Tue Sep  8 08:39:04 2026`. Both implementations
// these records are read on print it that way — BSD `ps` on macOS, procps-ng on Linux — which is why
// one command covers both without a platform branch.
const START_TIME_FORMAT = 'lstart='
const PID_FLAG = '-p'
// The two variables that decide how `ps` renders that field, and **the whole environment the probe
// runs in** — nothing is inherited, so the token depends on the process being asked about and on
// nothing whatever about who is asking.
const PROBE_ENVIRONMENT = { TZ: 'UTC', LC_ALL: 'C' }
// A probe that hung would hang `josh review:brief`, `josh bench` and the unit suite's worker share
// alike. Failing is harmless here: it answers "cannot tell", which every caller already handles.
const PROBE_TIMEOUT_MS = 2000
// `process.kill(pid, 0)` runs every permission check and delivers nothing, so it is the standard
// liveness probe: it throws `ESRCH` where the process is gone.
const LIVENESS_SIGNAL = 0
// Below this a pid is not a process: `0` addresses the caller's own process group and anything
// negative addresses another group, so a truncated or hand-edited record carrying either would
// otherwise answer "alive" forever.
const LOWEST_REAL_PID = 1

function is_live_pid(pid: number): boolean {
	if (pid < LOWEST_REAL_PID) return false

	try {
		process.kill(pid, LIVENESS_SIGNAL)

		return true
	} catch {
		return false
	}
}

// `undefined` where the start time cannot be asked for: `ps` is absent (Windows), the field is not
// supported, the probe timed out, or the pid named nothing. An empty answer is folded into the same
// case — `ps` exits non-zero for an unknown pid on some platforms and prints nothing on others, and
// both mean the same thing here.
function read_start(pid: number): string | undefined {
	try {
		const printed = execFileSync(
			PS_COMMAND,
			[FORMAT_FLAG, START_TIME_FORMAT, PID_FLAG, String(pid)],
			{
				encoding: 'utf8',
				timeout: PROBE_TIMEOUT_MS,
				stdio: ['ignore', 'pipe', 'ignore'],
				env: PROBE_ENVIRONMENT,
			},
		).trim()

		return printed.length > 0 ? printed : undefined
	} catch {
		return undefined
	}
}

// Read once and kept: a process's own start time cannot change, and the probe costs a subprocess that
// every record write would otherwise pay again. A `Map` rather than a nullable variable because
// `has` distinguishes "not asked yet" from "asked, and the platform could not answer" — the second is
// a real result, and re-probing on every write would pay the subprocess exactly where it cannot help.
const own_probe = new Map<number, string | undefined>()

function own_start(): string | undefined {
	if (!own_probe.has(process.pid)) own_probe.set(process.pid, read_start(process.pid))

	return own_probe.get(process.pid)
}

// The fields a record carries to name its writer, in one place so no caller assembles them itself.
//
// **Spread rather than assigned, because `exactOptionalPropertyTypes` makes an explicit `undefined` a
// different thing from an absent key** — and a platform whose start time cannot be read must leave
// the key absent, which is exactly what every reader below reads as "cannot tell".
function own_fields(): { pid: number; process_start?: string } {
	const start = own_start()

	return { pid: process.pid, ...(start !== undefined && { process_start: start }) }
}

function compare_start(pid: number, recorded_start: string): boolean | undefined {
	const observed = read_start(pid)

	return observed === undefined ? undefined : observed === recorded_start
}

// **Three answers, because the third one is real and the two callers resolve it in opposite
// directions.** `true` is "the writer is still running", `false` is "it is not", and `undefined` is
// "this platform cannot tell" — a pid that is alive paired with a start time nobody could read, on
// either side of the record.
//
// Collapsing `undefined` into either boolean here would be a decision taken in the wrong place. What
// being wrong costs differs per caller: the in-flight gate marker's readers pay a redundant unit run
// for a false negative, so they take `=== true`; the unit-suite worker share pays a wider share of
// the machine for a false negative and an oversubscribed machine for a false positive, so it takes
// `!== false`. Each one chooses the answer that costs wall time rather than correctness.
//
// **A record written before this field existed lands on `undefined` rather than `true`**, the same
// direction `describes_base` takes for a missing base: a reader that knows less than the writer did
// must never come out ahead of one that knows the same.
function is_same_process(
	pid: number | undefined,
	recorded_start: string | undefined,
): boolean | undefined {
	if (pid === undefined || !is_live_pid(pid)) return false
	if (recorded_start === undefined) return undefined

	return compare_start(pid, recorded_start)
}

// **Whether a record is the caller's own, which is a different question from whether its writer is
// alive** (joshuafolkken/kit#1727). `is_same_process` asks about the recorded process; this asks
// whether that process *is this one*. A supervisor that has been replaced reads its successor's
// record as perfectly live, so liveness alone can never tell a hand-over from an ordinary pass — and
// a writer deciding by liveness overwrites whatever it finds.
//
// **Compared against `own_fields()`, so the two can never disagree about what identity means.** The
// pair a record carries is written there and read here, which is why this lives beside it rather
// than in each record's own module.
//
// **A start time neither side can read leaves the pid as the whole comparison, and that is the
// correct fallback rather than a gap.** Where the platform answers for nobody, both sides are
// `undefined` and equal; where it answers for one and not the other, they differ and the record is
// treated as someone else's — the safe direction, since refusing to write a record that is in fact
// this process's own costs one supervisor pass, and writing over another's costs the run.
function is_own_process(pid: number | undefined, recorded_start: string | undefined): boolean {
	return pid === process.pid && recorded_start === own_start()
}

const process_identity = {
	is_live_pid,
	is_own_process,
	is_same_process,
	own_fields,
	own_start,
	read_start,
}

export { process_identity }
