import { execFileSync, spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFileSync, rmSync } from 'node:fs'
import { createServer, type Server } from 'node:net'
import path from 'node:path'
import { PLATFORM_TEMP_ROOT } from './platform-temporary'

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
// **The start time is an opaque token, never a date.** Both sides use the same ordered probes and
// compare the resulting token for equality; readers never parse it. Linux reads `/proc` directly,
// other platforms try `ps`, and a sandbox that permits neither uses a process-owned Unix socket.
// That socket accepts connections only while its writer lives, so a reused pid cannot revive it.
//
// **The token is only opaque if it is also stable, which it is not by default.** `ps` renders the
// start time through the caller's own time zone and locale, so the *same* process prints
// `Tue Sep  8 09:15:33 2026` in one shell and `Tue Sep  8 02:15:33 2026` in another that exported
// `TZ=UTC` — and a writer and reader disagreeing about `TZ` would read a live process as a stranger.
// That failure is worse than the one this module fixes, because it fires on a gate that really is
// running: `unit-worker-share` would sweep the marker of a live run and put every suite back on the
// whole machine, and `bench-guard` would clear the caches out from under a running gate. The probe
// therefore pins `TZ` and `LC_ALL` rather than inheriting them.

// The `ps` fallback uses an absolute path rather than a name resolved through `PATH`, which removes
// the lookup from the caller's environment and lets the probe run with no inherited environment.
// Where neither `/proc` nor `ps` is available, the probe answers "cannot tell", a case every caller
// already handles.
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
const PROC_START_FIELD_INDEX = 19
const BEACON_SCHEME = 'socket:'
const BEACON_SUFFIX = '.sock'
const BEACON_PREFIX = `josh-process-identity-${String(process.getuid?.() ?? '')}-`
const BEACON_ID_LENGTH = 36
const BEACON_ID_PATTERN = /^[\da-f-]+$/u
const SOCKET_PROBE_SOURCE =
	"const net=require('node:net');const socket=net.createConnection(process.argv[1]);socket.once('connect',()=>process.exit(0));socket.once('error',()=>process.exit(1));socket.setTimeout(1000,()=>process.exit(1));"
const beacons = new Map<string, Server>()
const exit_cleanup = { is_registered: false }

interface StartProbes {
	read_proc_start: (pid: number) => string | undefined
	read_ps_start: (pid: number) => string | undefined
}

function is_live_pid(pid: number): boolean {
	if (pid < LOWEST_REAL_PID) return false

	try {
		process.kill(pid, LIVENESS_SIGNAL)

		return true
	} catch {
		return false
	}
}

// Linux exposes field 22 as the process start time in clock ticks since boot. The command name in
// field 2 may itself contain spaces or `)`, so parsing starts after its final closing parenthesis;
// `state` is then index 0 and `starttime` index 19. A direct file read avoids process enumeration and
// remains available to a workspace sandbox that refuses `ps`.
function read_proc_start(pid: number): string | undefined {
	try {
		const stat = readFileSync(`/proc/${String(pid)}/stat`, 'utf8')
		const fields = stat
			.slice(stat.lastIndexOf(')') + 1)
			.trim()
			.split(/\s+/u)
		const start = fields[PROC_START_FIELD_INDEX]

		return start === undefined ? undefined : `proc:${start}`
	} catch {
		return undefined
	}
}

function read_ps_start(pid: number): string | undefined {
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

const START_PROBES: StartProbes = { read_proc_start, read_ps_start }

function safe_probe(probe: (pid: number) => string | undefined, pid: number): string | undefined {
	try {
		return probe(pid)
	} catch {
		return undefined
	}
}

function read_start(pid: number, probes: StartProbes = START_PROBES): string | undefined {
	return safe_probe(probes.read_proc_start, pid) ?? safe_probe(probes.read_ps_start, pid)
}

function close_beacon(token: string): void {
	const server = beacons.get(token)
	if (server === undefined) return

	beacons.delete(token)
	server.close()
	rmSync(token.slice(BEACON_SCHEME.length), { force: true })
}

function close_beacons(): void {
	for (const token of beacons.keys()) close_beacon(token)
}

function ensure_exit_cleanup(): void {
	if (exit_cleanup.is_registered) return

	exit_cleanup.is_registered = true
	process.once('exit', close_beacons)
}

function ignore_beacon_error(): void {
	/* an unavailable beacon makes the identity safely unverifiable */
}

function open_beacon(): string {
	const target = path.join(PLATFORM_TEMP_ROOT, `${BEACON_PREFIX}${randomUUID()}${BEACON_SUFFIX}`)
	const token = `${BEACON_SCHEME}${target}`
	const server = createServer().on('error', ignore_beacon_error).listen(target)

	server.unref()
	beacons.set(token, server)
	ensure_exit_cleanup()

	return token
}

// A Unix-domain listener is the macOS sandbox fallback rather than a weaker pid-only answer. The
// random path is the generation token and the kernel-held listener is its lifetime: SIGKILL closes
// it even when no cleanup handler runs, while a stale filesystem entry accepts no connection. A
// process that later receives the same pid therefore cannot make the old pair live again.
function resolve_own_start(probes: StartProbes = START_PROBES): string {
	return read_start(process.pid, probes) ?? open_beacon()
}

function is_valid_beacon_name(name: string): boolean {
	if (!name.startsWith(BEACON_PREFIX) || !name.endsWith(BEACON_SUFFIX)) return false

	const id = name.slice(BEACON_PREFIX.length, -BEACON_SUFFIX.length)

	return id.length === BEACON_ID_LENGTH && BEACON_ID_PATTERN.test(id)
}

function beacon_target(token: string): string | undefined {
	if (!token.startsWith(BEACON_SCHEME)) return undefined

	const target = token.slice(BEACON_SCHEME.length)
	if (path.dirname(target) !== PLATFORM_TEMP_ROOT) return undefined

	return is_valid_beacon_name(path.basename(target)) ? target : undefined
}

function is_live_beacon(target: string): boolean {
	return (
		spawnSync(process.execPath, ['-e', SOCKET_PROBE_SOURCE, target], {
			stdio: 'ignore',
			timeout: PROBE_TIMEOUT_MS,
		}).status === 0
	)
}

function has_matching_start(
	pid: number,
	recorded_start: string,
	read: (pid: number) => string | undefined,
): boolean | undefined {
	const observed = read(pid)

	return observed === undefined ? undefined : observed === recorded_start
}

function matches_recorded_start(
	pid: number,
	recorded_start: string,
	read: (pid: number) => string | undefined,
): boolean | undefined {
	const target = beacon_target(recorded_start)

	return target === undefined
		? has_matching_start(pid, recorded_start, read)
		: is_live_beacon(target)
}

// Read once and kept: a process's own start time cannot change, and the probe costs a subprocess that
// every record write would otherwise pay again. A `Map` rather than a nullable variable because
// `has` distinguishes "not asked yet" from "asked, and the platform could not answer" — the second is
// a real result, and re-probing on every write would pay the subprocess exactly where it cannot help.
const own_probe = new Map<number, string | undefined>()

function own_start(): string | undefined {
	if (!own_probe.has(process.pid)) own_probe.set(process.pid, resolve_own_start())

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
	read: (pid: number) => string | undefined = read_start,
): boolean | undefined {
	if (pid === undefined || !is_live_pid(pid)) return false
	if (recorded_start === undefined) return undefined

	return matches_recorded_start(pid, recorded_start, read)
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
	close_beacon,
	is_live_pid,
	is_own_process,
	is_same_process,
	own_fields,
	own_start,
	read_start,
	resolve_own_start,
}

export { process_identity }
export type { StartProbes }
