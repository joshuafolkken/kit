// What the launcher (`tools/josh/josh-ready.ts`) measured before the command it launches ran
// (joshuafolkken/kit#7828): how long its `dist` rebuild took, absent where none ran. The launcher and
// the bundled command load separate copies of this module, so the value sits on `globalThis` under a
// registry symbol both copies resolve to — and, unlike an environment variable, never reaches a child
// process the command spawns.
const REBUILD_KEY = Symbol.for('josh.launch.rebuild_ms')

function set_rebuild_ms(ms: number): void {
	Reflect.set(globalThis, REBUILD_KEY, ms)
}

function rebuild_ms(): number | undefined {
	const value: unknown = Reflect.get(globalThis, REBUILD_KEY)

	return typeof value === 'number' ? value : undefined
}

function clear(): void {
	Reflect.deleteProperty(globalThis, REBUILD_KEY)
}

const launch_timing = { clear, rebuild_ms, set_rebuild_ms }

export { launch_timing }
