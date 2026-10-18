import type { MachineSample, MemoryReading } from '#scripts/gate/machine-capacity'
import { describe, expect, it } from 'vitest'
import { backlog_drive } from './backlog-drive'
import { backlog_drive_fixture } from './backlog-drive-fixture'
import { backlog_drive_memory } from './backlog-drive-memory'

// joshuafolkken/kit#4084: no lane opens while the machine has no memory for one more, and the held
// offer is asked again within one poll of the memory clearing.

const { CONFIG, OFFERED, POLL_MS, harness, offer, state } = backlog_drive_fixture
const { HOLD_REASON } = backlog_drive_memory
// A machine of 100 MB, so the available figure is the share free.
const TOTAL_MB = 100
const SECOND_MS = 1000
const HALF_SECOND_MS = 500
const PRESSURE_NORMAL = 1
const PRESSURE_WARNING = 2
const RED_SWAP_MB = 10
const THREE_PASSES = { ...CONFIG, window_ms: POLL_MS * 3 }

interface Reading {
	at_ms: number
	memory: Partial<MemoryReading>
}

function used(percent: number, at_ms = 0): Reading {
	return { at_ms, memory: { available_mb: TOTAL_MB - percent } }
}

const UNREAD: MemoryReading = {
	available_mb: undefined,
	swapped_mb: undefined,
	pressure_level: undefined,
}

function sample_of(reading: Reading | undefined): MachineSample {
	return {
		cpu: { busy: 0, total: 0 },
		memory: { ...UNREAD, ...reading?.memory },
		total_mb: TOTAL_MB,
	}
}

// The hold each reading leaves, read in turn through one gauge.
async function holds_over(readings: ReadonlyArray<Reading>): Promise<Array<boolean>> {
	const queue = [...readings]
	let current: Reading | undefined
	const memory_held = backlog_drive_memory.gauge({
		read: async () => {
			current = queue.shift()

			return sample_of(current)
		},
		now: () => current?.at_ms ?? 0,
	})

	const answers: Array<boolean> = []

	while (answers.length < readings.length) {
		// eslint-disable-next-line no-await-in-loop -- the gauge carries its hold from one reading to the next
		answers.push(await memory_held())
	}

	return answers
}

describe('backlog_drive_memory.gauge', () => {
	it('holds from 🧠 red and keeps holding until 🧠 is back under yellow', async () => {
		const answers = await holds_over([used(84), used(85), used(70), used(69)])

		expect(answers).toStrictEqual([false, true, true, false])
	})

	it('holds while the kernel reads pressure, and resumes once it reads normal', async () => {
		const pressured = {
			at_ms: 0,
			memory: { available_mb: TOTAL_MB, pressure_level: PRESSURE_WARNING },
		}
		const normal = { at_ms: 0, memory: { available_mb: TOTAL_MB, pressure_level: PRESSURE_NORMAL } }

		await expect(holds_over([pressured, normal])).resolves.toStrictEqual([true, false])
	})

	it('never holds on readings it could not take', async () => {
		await expect(holds_over([{ at_ms: 0, memory: {} }])).resolves.toStrictEqual([false])
	})
})

describe('backlog_drive_memory.gauge — swap', () => {
	it('holds on a red swap rate measured over at least a second', async () => {
		const swapped = [
			{ at_ms: 0, memory: { swapped_mb: 0 } },
			{ at_ms: SECOND_MS, memory: { swapped_mb: RED_SWAP_MB } },
		]

		await expect(holds_over(swapped)).resolves.toStrictEqual([false, true])
	})

	it('keeps a swap hold until 💾 is back under yellow, with 🧠 and the kernel clear', async () => {
		const swapped = [0, RED_SWAP_MB, RED_SWAP_MB * 2, RED_SWAP_MB * 2].map((swapped_mb, index) => ({
			at_ms: SECOND_MS * index,
			memory: { available_mb: TOTAL_MB, swapped_mb },
		}))

		await expect(holds_over(swapped)).resolves.toStrictEqual([false, true, true, false])
	})

	it('reads no swap rate from two readings closer than a second', async () => {
		const swapped = [
			{ at_ms: 0, memory: { swapped_mb: 0 } },
			{ at_ms: HALF_SECOND_MS, memory: { swapped_mb: RED_SWAP_MB } },
		]

		await expect(holds_over(swapped)).resolves.toStrictEqual([false, false])
	})

	it('keeps a swap hold through a reading too close to measure a rate of its own', async () => {
		const swapped = [
			{ at_ms: 0, memory: { available_mb: TOTAL_MB, swapped_mb: 0 } },
			{ at_ms: SECOND_MS, memory: { available_mb: TOTAL_MB, swapped_mb: RED_SWAP_MB } },
			{
				at_ms: SECOND_MS + HALF_SECOND_MS,
				memory: { available_mb: TOTAL_MB, swapped_mb: RED_SWAP_MB },
			},
		]

		await expect(holds_over(swapped)).resolves.toStrictEqual([false, true, true])
	})
})

describe('backlog_drive.run_loop — a memory hold', () => {
	it('launches nothing on a held run offer and records the hold as memory', async () => {
		const { ports, calls, holds } = harness({
			offers: [offer('run', [OFFERED])],
			memory_held: [true],
		})

		await backlog_drive.run_loop(state(), THREE_PASSES, ports)

		expect(calls).toStrictEqual(['offer'])
		expect(holds).toStrictEqual([HOLD_REASON])
	})

	it('asks again and launches on the next poll once the memory clears', async () => {
		const offers = [offer('run', [OFFERED]), offer('run', [OFFERED])]
		const { ports, calls, offers: asked } = harness({ offers, memory_held: [true, false] })
		const start_ms = ports.now().getTime()
		const asked_at: Array<number> = []
		const { offer: ask } = ports

		ports.offer = async (asked_state) => {
			asked_at.push(ports.now().getTime() - start_ms)

			return await ask(asked_state)
		}

		await backlog_drive.run_loop(state(), THREE_PASSES, ports)

		expect(calls).toStrictEqual(['offer', 'offer', `launch ${OFFERED}`])
		expect(asked_at).toStrictEqual([0, POLL_MS])
		expect(asked[1]?.is_memory_held).toBe(true)
	})

	it('clears the hold on an offer that is not run', async () => {
		const offers = [offer('run', [OFFERED]), offer('wait')]
		const { ports, states } = harness({ offers, memory_held: [true] })

		await backlog_drive.run_loop(state(), { ...CONFIG, window_ms: CONFIG.offer_ms }, ports)

		expect(states[0]?.is_memory_held).toBe(true)
		expect(states.at(-1)?.is_memory_held).toBe(false)
	})
})
