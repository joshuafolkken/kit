import { spawn } from 'node:child_process'
import { mkdirSync, renameSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { file_reader } from '#scripts/lib/read-file'

// The `rule:value` reading at the `backlogrun` loop head, without the loop waiting on it.
// Measuring re-reads every transcript and takes minutes, and `backlog:offer`
// ran it synchronously on every iteration, so each dispatch waited on it. The loop head now prints the
// last reading from a cache and, when the last refresh is old enough, starts one in a detached process
// — `josh rule:value --refresh` — so the next iteration prints the newer reading.
//
// **It reports and never fails**, as `rule:value` itself does: a missing cache, an unwritable directory
// or a refresh that could not start prints at most nothing, and never changes the offer's answer.

const CACHE_DIRECTORY = ['node_modules', '.cache', 'josh']
const CACHE_FILE = 'rule-value.txt'
// Touched when a refresh starts, so the loop head starts at most one per interval however often it runs.
const STAMP_FILE = 'rule-value.stamp'
const MS_PER_MINUTE = 60_000
const REFRESH_MINUTES = 15
const REFRESH_MS = REFRESH_MINUTES * MS_PER_MINUTE
const REFRESH_ARGV = ['josh', 'rule:value', '--refresh']
const PNPM = 'pnpm'
const TEMPORARY_SUFFIX = '.tmp'

interface CachePorts {
	now: () => number
	start_refresh: (cwd: string) => void
}

function cache_path(cwd: string, file: string): string {
	return path.join(cwd, ...CACHE_DIRECTORY, file)
}

function read_cached(cwd: string): string | undefined {
	return file_reader.read_if_readable(cache_path(cwd, CACHE_FILE))
}

function is_refresh_due(cwd: string, now_ms: number): boolean {
	try {
		return now_ms - statSync(cache_path(cwd, STAMP_FILE)).mtimeMs >= REFRESH_MS
	} catch {
		return true
	}
}

function write_cache_file(cwd: string, file: string, text: string): void {
	const target = cache_path(cwd, file)
	const temporary = `${target}${TEMPORARY_SUFFIX}`

	mkdirSync(path.dirname(target), { recursive: true })
	writeFileSync(temporary, text)
	renameSync(temporary, target)
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

function refresh_if_due(cwd: string, ports: CachePorts): void {
	if (!is_refresh_due(cwd, ports.now())) return

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
	write_cache_file(cwd, CACHE_FILE, `${text}\n`)
}

const rule_value_cache = { CACHE_FILE, REFRESH_MS, STAMP_FILE, cache_path, emit, store }

export type { CachePorts }
export { rule_value_cache }
