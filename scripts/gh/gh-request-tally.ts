// How many `gh` requests this process sent, and how many of them GitHub answered `304 Not Modified`
// (joshuafolkken/kit#6694). Every spawn in `git-gh-exec.ts` counts one call, retries included,
// because each spawn can cost REST core quota; a 304 is a call that cost none. A `--paginate` spawn
// is one call here however many pages it fetched.
//
// It only counts, and a later step reads `snapshot()` and writes it out. A `gh` run outside the
// exec layer (a session typing `gh issue view` itself) is not counted.
//
// What GitHub billed is the core allowance's `used`, which also moves for retries, pages and the
// account's other processes (joshuafolkken/kit#6697). A process that records it calls `watch_core`
// with the reader (`gh_core_rate_limit.read_usage`); the reader is injected because it spawns
// through `git-gh-exec.ts`, which imports this file. The first `count_call()` starts one reading
// without waiting for it, and `core_delta()` reads again and answers the difference. A process that
// never calls `gh` reads nothing. The start reading runs beside the first call, so it may already
// include that call's cost. The difference is an upper bound for this process: the account's other
// processes spend the same allowance.

import { run_startup } from '#scripts/run/startup/run-startup'
import { gh_call_kind } from './gh-call-kind'

interface CallCount {
	calls: number
	not_modified: number
}

// The same counts again per call kind (`gh-call-kind.ts`), keyed by the kind.
interface GhRequestTally extends CallCount {
	endpoints: Record<string, CallCount>
}

interface CoreUsage {
	used: number
	// When the window refills, in epoch milliseconds.
	reset_ms: number
}

type CoreUsageReader = () => Promise<CoreUsage | undefined>

interface CoreWatch {
	read: CoreUsageReader | undefined
	start: Promise<CoreUsage | undefined> | undefined
}

interface TallyState {
	tally: CallCount
	endpoints: Map<string, CallCount>
	core: CoreWatch
}

// One state per process, not per module copy (joshuafolkken/kit#7013): `dist/josh.js` and the
// `dist/commands` chunks each carry this module, and a command runs inside the dispatcher's process,
// so a command's calls must land in the counts the dispatcher's `josh_gh_usage.recorded` writes.
const STATE_KEY = Symbol.for('josh.gh-request-tally')

function is_state(value: unknown): value is TallyState {
	return typeof value === 'object' && value !== null && Reflect.has(value, 'endpoints')
}

function shared_state(): TallyState {
	const existing: unknown = Reflect.get(globalThis, STATE_KEY)
	if (is_state(existing)) return existing
	const state: TallyState = {
		tally: { calls: 0, not_modified: 0 },
		endpoints: new Map(),
		core: { read: undefined, start: undefined },
	}

	Reflect.set(globalThis, STATE_KEY, state)

	return state
}

const { tally, endpoints, core } = shared_state()

// A reading that throws reads as none: the start reading is held unawaited, so a rejection would
// otherwise surface as an unhandled one, and the tally never fails the process it counts.
function watch_core(read: CoreUsageReader): void {
	core.read = async (): Promise<CoreUsage | undefined> => {
		try {
			return await read()
		} catch {
			return undefined
		}
	}
}

function endpoint_of(kind: string): CallCount {
	const count = endpoints.get(kind) ?? { calls: 0, not_modified: 0 }

	endpoints.set(kind, count)

	return count
}

function snapshot(): GhRequestTally {
	const entries = [...endpoints].map(([kind, count]) => [kind, { ...count }] as const)

	return { ...tally, endpoints: Object.fromEntries(entries) }
}

// `kind` is the call's `gh_call_kind` key.
function count_call(kind: string): void {
	run_startup.metric('api', gh_call_kind.class_of(kind))
	if (core.read !== undefined) core.start ??= core.read()
	tally.calls += 1
	endpoint_of(kind).calls += 1
}

function count_not_modified(kind: string): void {
	tally.not_modified += 1
	endpoint_of(kind).not_modified += 1
}

// A window that refilled between the readings makes the difference meaningless, so it is none.
function to_delta(start?: CoreUsage, end?: CoreUsage): number | undefined {
	if (start === undefined || start.reset_ms !== end?.reset_ms) return undefined

	return end.used - start.used
}

async function core_delta(): Promise<number | undefined> {
	if (core.read === undefined || core.start === undefined) return undefined
	const [start, end] = await Promise.all([core.start, core.read()])

	return to_delta(start, end)
}

// For tests: the counts belong to the process, so each test starts them at zero itself.
function reset(): void {
	tally.calls = 0
	tally.not_modified = 0
	endpoints.clear()
	core.read = undefined
	core.start = undefined
}

const gh_request_tally = {
	watch_core,
	count_call,
	count_not_modified,
	snapshot,
	core_delta,
	reset,
}

export type { CallCount, CoreUsage, CoreUsageReader, GhRequestTally }
export { gh_request_tally }
