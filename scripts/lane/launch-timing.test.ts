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

	// joshuafolkken/kit#8218: the command reads its code load against when the dispatcher began loading it.
	it('reads back the dispatch time the dispatcher set, and clears it beside the others', () => {
		expect(launch_timing.dispatched_ms()).toBeUndefined()
		launch_timing.set_dispatched_ms(REBUILD_MS)

		expect(launch_timing.dispatched_ms()).toBe(REBUILD_MS)
		launch_timing.clear()
		expect(launch_timing.dispatched_ms()).toBeUndefined()
	})

	it('shares the value through the global registry, which a second copy of the module resolves to', () => {
		Reflect.set(globalThis, Symbol.for('josh.launch.rebuild_ms'), REBUILD_MS)

		expect(launch_timing.rebuild_ms()).toBe(REBUILD_MS)
	})
})

describe('launch_timing phases', () => {
	it('keeps the first value each phase name was given, in the order first marked', () => {
		launch_timing.mark('worker', REBUILD_MS)
		launch_timing.mark('quotas', 1)
		launch_timing.mark('worker', 0)

		expect(launch_timing.phases()).toStrictEqual([
			{ name: 'worker', ms: REBUILD_MS },
			{ name: 'quotas', ms: 1 },
		])
	})

	it('records how long a timed read took, even one that throws, and clears the phases', async () => {
		await expect(launch_timing.timed('machine', async () => 'read')).resolves.toBe('read')
		await expect(
			launch_timing.timed('quotas', async () => {
				throw new Error('failed')
			}),
		).rejects.toThrow('failed')

		expect(launch_timing.phases().map((phase) => phase.name)).toStrictEqual(['machine', 'quotas'])
		launch_timing.clear()
		expect(launch_timing.phases()).toStrictEqual([])
	})
})
