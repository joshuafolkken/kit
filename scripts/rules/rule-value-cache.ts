import { spawn } from 'node:child_process'
import { statSync } from 'node:fs'
import path from 'node:path'
import { git_common_directory } from '#scripts/git/git-common-directory'
import { atomic_write } from '#scripts/lib/atomic-write'
import { file_reader } from '#scripts/lib/read-file'
import { MS_PER_MINUTE } from '#scripts/lib/timeouts'

// The `rule:value` reading at the `backlogrun` loop head, without the loop waiting on it.
// Measuring re-reads every transcript and takes minutes, and `backlog:offer`
// ran it synchronously on every iteration, so each dispatch waited on it. The loop head now prints the
// last reading from a cache and, when the last refresh is old enough, starts one in a detached process
// — `josh rule:value --refresh` — so the next iteration prints the newer reading.
//
// **It reports and never fails**, as `rule:value` itself does: a missing cache, an unwritable directory
// or a refresh that could not start prints at most nothing, and never changes the offer's answer.

// Outside a repository only: inside one the cache lives in the common git directory, so a lane's work
// tree reads the reading its parent's loop head stored rather than measuring again
// (joshuafolkken/kit#5186). The reading is the main checkout's — its transcripts and every lane's —
// because only the main checkout writes it (`is_linked_work_tree`); a lane's own measurement reaches
// only its own transcripts (`cost_transcript.transcript_directories`).
const FALLBACK_DIRECTORY = ['node_modules', '.cache', 'josh']
const CACHE_FILE = 'rule-value.txt'
// Touched when a refresh starts, so the loop head starts at most one per interval however often it runs.
const STAMP_FILE = 'rule-value.stamp'
const REFRESH_MINUTES = 15
const REFRESH_MS = REFRESH_MINUTES * MS_PER_MINUTE
const REFRESH_ARGV = ['josh', 'rule:value', '--refresh']
const PNPM = 'pnpm'

interface CachePorts {
	now: () => number
	start_refresh: (cwd: string) => void
}

interface FreshReading {
	text: string
	taken_at: Date
}

function cache_path(cwd: string, file: string): string {
	const common = git_common_directory.repository(cwd)

	if (common === undefined) return path.join(cwd, ...FALLBACK_DIRECTORY, file)

	return path.join(common, git_common_directory.STATE_DIRECTORY, file)
}

function read_cached(cwd: string): string | undefined {
	return file_reader.read_if_readable(cache_path(cwd, CACHE_FILE))
}

function taken_at_if_fresh(cwd: string, now_ms: number): Date | undefined {
	try {
		const { mtime } = statSync(cache_path(cwd, CACHE_FILE))

		return now_ms - mtime.getTime() < REFRESH_MS ? mtime : undefined
	} catch {
		return undefined
	}
}

// The stored reading when it was taken inside the refresh interval — what `josh rule:value` prints
// instead of measuring. `undefined` is a miss: no reading, or one older than the interval.
function read_fresh(
	cwd: string = process.cwd(),
	now_ms: number = Date.now(),
): FreshReading | undefined {
	const taken_at = taken_at_if_fresh(cwd, now_ms)

	if (taken_at === undefined) return undefined

	const text = read_cached(cwd)

	return text === undefined ? undefined : { text, taken_at }
}

function is_refresh_due(cwd: string, now_ms: number): boolean {
	try {
		return now_ms - statSync(cache_path(cwd, STAMP_FILE)).mtimeMs >= REFRESH_MS
	} catch {
		return true
	}
}

function write_cache_file(cwd: string, file: string, text: string): void {
	atomic_write.replace_file(cache_path(cwd, file), text)
}

function ignore_spawn_error(): void {
	/* a refresh that could not start leaves the last reading in place */
}

// Detached with no descriptor shared, so the loop head exits — and a backgrounded caller completes —
// without waiting on the measurement.
function start_refresh_default(cwd: string): void {
	const child = spawn(PNPM, REFRESH_ARGV, { cwd, detached: true, stdio: 'ignore' })

	child.on('error', ignore_spawn_error)
	child.unref()
}

const DEFAULT_PORTS: CachePorts = { now: Date.now, start_refresh: start_refresh_default }

// A linked work tree — a lane — measures its own transcripts alone, so it never writes the main
// checkout's reading or its stamp: either would stand in for the whole repository's for an interval.
function is_linked_work_tree(cwd: string): boolean {
	return git_common_directory.resolve(cwd) !== undefined
}

function refresh_if_due(cwd: string, ports: CachePorts): void {
	if (is_linked_work_tree(cwd) || !is_refresh_due(cwd, ports.now())) return

	write_cache_file(cwd, STAMP_FILE, new Date(ports.now()).toISOString())
	ports.start_refresh(cwd)
}

// The loop-head call: the last reading to stderr, then a refresh when one is due.
function emit(cwd: string = process.cwd(), ports: CachePorts = DEFAULT_PORTS): void {
	const cached = read_cached(cwd)

	if (cached !== undefined) process.stderr.write(cached)

	try {
		refresh_if_due(cwd, ports)
	} catch {
		// A refresh that could not be recorded or started leaves the last reading in place.
	}
}

// The detached refresh's body: the reading written whole, so a reader never sees half of one.
function store(text: string, cwd: string = process.cwd()): void {
	if (is_linked_work_tree(cwd)) return

	write_cache_file(cwd, CACHE_FILE, `${text}\n`)
}

const rule_value_cache = { CACHE_FILE, REFRESH_MS, STAMP_FILE, cache_path, emit, read_fresh, store }

export type { CachePorts, FreshReading }
export { rule_value_cache }
