import { beforeEach, describe, expect, it } from 'vitest'
import { launch_timing } from './launch-timing'

const REBUILD_MS = 1234.5

beforeEach(() => {
	launch_timing.clear()
})

describe('launch_timing', () => {
	it('reads no rebuild time where the launcher set none', () => {
		expect(launch_timing.rebuild_ms()).toBeUndefined()
	})

	it('reads back the rebuild time the launcher set', () => {
		launch_timing.set_rebuild_ms(REBUILD_MS)

		expect(launch_timing.rebuild_ms()).toBe(REBUILD_MS)
	})

	it('reads back the core wait the dispatcher set, and clears it beside the rebuild time', () => {
		launch_timing.set_core_wait_ms(REBUILD_MS)

		expect(launch_timing.core_wait_ms()).toBe(REBUILD_MS)
		launch_timing.clear()
		expect(launch_timing.core_wait_ms()).toBeUndefined()
	})

	it('shares the value through the global registry, which a second copy of the module resolves to', () => {
		Reflect.set(globalThis, Symbol.for('josh.launch.rebuild_ms'), REBUILD_MS)

		expect(launch_timing.rebuild_ms()).toBe(REBUILD_MS)
	})
})
