// What the launcher measured before the command it launches ran (joshuafolkken/kit#7828): how long
// its `dist` rebuild took (`tools/josh/josh-ready.ts`) and how long the command's declared core
// reservation waited for its cores (`scripts/josh/josh-logic.ts`, joshuafolkken/kit#7827) — each
// absent where none ran. The launcher and the bundled command load separate copies of this module, so
// the values sit on `globalThis` under registry symbols every copy resolves to — and, unlike an
// environment variable, never reach a child process the command spawns.
const REBUILD_KEY = Symbol.for('josh.launch.rebuild_ms')
const CORE_WAIT_KEY = Symbol.for('josh.launch.core_wait_ms')

function read_ms(key: symbol): number | undefined {
	const value: unknown = Reflect.get(globalThis, key)

	return typeof value === 'number' ? value : undefined
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
}

const launch_timing = { clear, core_wait_ms, rebuild_ms, set_core_wait_ms, set_rebuild_ms }

export { launch_timing }
