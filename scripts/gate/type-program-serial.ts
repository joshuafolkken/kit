import { gate_labels } from './gate-labels'

// **One gate builds one whole-project TypeScript program at a time** (joshuafolkken/kit#7031). The
// type check's `tsc` and the cold type-aware ESLint each hold the project's program, and six lanes
// running both at once ran the machine out of memory into swap (measured on that Issue). The memory
// admission alone does not keep them apart: both are admitted together whenever the free memory holds
// the pair. The wait sits ahead of the core claim, so a check waiting its turn holds no cores.

const TYPE_PROGRAM_LABELS: ReadonlySet<string> = new Set([
	gate_labels.LINT_LABEL,
	gate_labels.TYPE_CHECK_LABEL,
])

type SerialRun = <T>(label: string, run: () => Promise<T>) => Promise<T>

async function after<T>(previous: Promise<void>, run: () => Promise<T>): Promise<T> {
	await previous

	return await run()
}

// The next turn waits for this one to end, failed or not; the failure itself is its caller's to read.
async function settled(turn: Promise<unknown>): Promise<void> {
	try {
		await turn
	} catch {
		// The rejection reaches its caller through the turn itself.
	}
}

// A runner that chains every type-program check behind the one before it and starts any other check
// at once.
function serial_runner(): SerialRun {
	let tail: Promise<void> = Promise.resolve()

	async function serialized<T>(label: string, run: () => Promise<T>): Promise<T> {
		if (!TYPE_PROGRAM_LABELS.has(label)) return await run()

		const turn = after(tail, run)

		tail = settled(turn)

		return await turn
	}

	return serialized
}

const type_program_serial = { serial_runner }

export type { SerialRun }
export { type_program_serial }
