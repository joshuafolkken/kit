// A reading the board draws as last taken, re-read in the background once it is `interval_ms` old: a
// redraw never waits on the read, and no second read starts while one is under way. Only the very
// first read, with nothing yet to draw, waits for it. Shared by `top` (`run-board-usage-top.ts`) and the
// usage-limit gauges (`run-board-quota-held.ts`).

interface HeldPorts<Reading> {
	read: () => Promise<Reading>
	now: () => number
	interval_ms: number
	// What a first read that fails answers; a later failure keeps the reading before it.
	fallback: Reading
}

interface Held<Reading> {
	reading: Reading | undefined
	read_ms: number
	pending: Promise<Reading> | undefined
}

async function refreshed<Reading>(
	held: Held<Reading>,
	ports: HeldPorts<Reading>,
): Promise<Reading> {
	try {
		held.reading = await ports.read()
	} catch {
		held.reading ??= ports.fallback
	} finally {
		held.pending = undefined
	}

	return held.reading
}

function held_reader<Reading>(ports: HeldPorts<Reading>): () => Promise<Reading> {
	const held: Held<Reading> = { reading: undefined, read_ms: -Infinity, pending: undefined }

	async function read(): Promise<Reading> {
		if (held.pending === undefined && ports.now() - held.read_ms >= ports.interval_ms) {
			held.read_ms = ports.now()
			held.pending = refreshed(held, ports)
		}

		return held.reading ?? (await (held.pending ?? Promise.resolve(ports.fallback)))
	}

	return read
}

const run_board_held = { held_reader }

export { run_board_held }
export type { HeldPorts }
