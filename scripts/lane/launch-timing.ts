// What the launcher measured before the command it launches ran (joshuafolkken/kit#7828): how long
// its `dist` rebuild took (`tools/josh/josh-ready.ts`) and how long the command's declared core
// reservation waited for its cores (`scripts/josh/josh-logic.ts`, joshuafolkken/kit#7827) — each
// absent where none ran. The launcher and the bundled command load separate copies of this module, so
// the values sit on `globalThis` under registry symbols every copy resolves to — and, unlike an
// environment variable, never reach a child process the command spawns.
// The named phases a command records past launch (joshuafolkken/kit#7929) — `run:board`'s first-frame
// reads among them — sit beside them under a third symbol: a name keeps its first value, so a read
// taken again every round records only the first board's.
const REBUILD_KEY = Symbol.for('josh.launch.rebuild_ms')
const CORE_WAIT_KEY = Symbol.for('josh.launch.core_wait_ms')
const PHASES_KEY = Symbol.for('josh.launch.phases')

interface TimedPhase {
	name: string
	ms: number
}

function read_ms(key: symbol): number | undefined {
	const value: unknown = Reflect.get(globalThis, key)

	return typeof value === 'number' ? value : undefined
}

// Only this module writes the key, so a map under it is the one it set.
function is_phase_map(value: unknown): value is Map<string, number> {
	return value instanceof Map
}

function phase_map(): Map<string, number> {
	const value: unknown = Reflect.get(globalThis, PHASES_KEY)
	if (is_phase_map(value)) return value
	const created = new Map<string, number>()

	Reflect.set(globalThis, PHASES_KEY, created)

	return created
}

function mark(name: string, ms: number): void {
	const recorded = phase_map()

	if (!recorded.has(name)) recorded.set(name, ms)
}

// Awaits `read`, recording how long it took under `name` — thrown or not.
async function timed<T>(name: string, read: () => Promise<T>): Promise<T> {
	const started = performance.now()

	try {
		return await read()
	} finally {
		mark(name, performance.now() - started)
	}
}

// `read` with every call timed under `name`.
function timing<A extends ReadonlyArray<unknown>, R>(
	name: string,
	read: (...args: A) => Promise<R>,
): (...args: A) => Promise<R> {
	return async (...args) => await timed(name, async () => await read(...args))
}

function phases(): Array<TimedPhase> {
	return [...phase_map()].map(([name, ms]) => ({ name, ms }))
}

function set_rebuild_ms(ms: number): void {
	Reflect.set(globalThis, REBUILD_KEY, ms)
}

function rebuild_ms(): number | undefined {
	return read_ms(REBUILD_KEY)
}

function set_core_wait_ms(ms: number): void {
	Reflect.set(globalThis, CORE_WAIT_KEY, ms)
}

function core_wait_ms(): number | undefined {
	return read_ms(CORE_WAIT_KEY)
}

function clear(): void {
	Reflect.deleteProperty(globalThis, REBUILD_KEY)
	Reflect.deleteProperty(globalThis, CORE_WAIT_KEY)
	Reflect.deleteProperty(globalThis, PHASES_KEY)
}

const launch_timing = {
	clear,
	core_wait_ms,
	mark,
	phases,
	rebuild_ms,
	set_core_wait_ms,
	set_rebuild_ms,
	timed,
	timing,
}

export { launch_timing }
export type { TimedPhase }
