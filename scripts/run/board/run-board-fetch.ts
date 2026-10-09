// A GitHub read in flight. The plan and the closed children are queries that
// take seconds, so a live board launches each and goes on redrawing; the read keeps its answer once it
// lands, and the next redraw folds it in. A rejected read answers with the value given for a failed one
// — nothing awaits a background read to see it throw.

// `undefined` while the read is in flight.
interface Answer<T> {
	value: T
}

interface Fetch<T> {
	// Settles once the read has answered, never rejecting — what a board that waits for a read awaits.
	landed: Promise<void>
	answer: () => Answer<T> | undefined
}

async function answer_of<T>(read: () => Promise<T>, failed: T): Promise<Answer<T>> {
	try {
		return { value: await read() }
	} catch {
		return { value: failed }
	}
}

function launch<T>(read: () => Promise<T>, failed: T): Fetch<T> {
	const box: { answer: Answer<T> | undefined } = { answer: undefined }

	async function land(): Promise<void> {
		box.answer = await answer_of(read, failed)
	}

	return { landed: land(), answer: () => box.answer }
}

const run_board_fetch = { launch }

export { run_board_fetch }
export type { Fetch }
