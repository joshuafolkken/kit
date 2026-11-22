// A GitHub read in flight. The plan and the closed children are queries that
// take seconds, so a live board launches each and goes on redrawing; the read keeps its answer once it
// lands, and the next redraw folds it in. A rejected read answers with the value given for a failed one
// — nothing awaits a background read to see it throw — and says why, so the board can name the reason
// rather than drop it (joshuafolkken/kit#8475).

// `undefined` while the read is in flight.
interface Answer<T> {
	value: T
	// Why a rejected read failed; none where it answered.
	error?: string | undefined
}

interface Fetch<T> {
	// Settles once the read has answered, never rejecting — what a board that waits for a read awaits.
	landed: Promise<void>
	answer: () => Answer<T> | undefined
}

// What a failure is said as: the first line of its message.
function reason_of(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error)

	return message.split('\n', 1)[0] ?? ''
}

async function answer_of<T>(read: () => Promise<T>, failed: T): Promise<Answer<T>> {
	try {
		return { value: await read() }
	} catch (error) {
		return { value: failed, error: reason_of(error) }
	}
}

function launch<T>(read: () => Promise<T>, failed: T): Fetch<T> {
	const box: { answer: Answer<T> | undefined } = { answer: undefined }

	async function land(): Promise<void> {
		box.answer = await answer_of(read, failed)
	}

	return { landed: land(), answer: () => box.answer }
}

const run_board_fetch = { launch, reason_of }

export { run_board_fetch }
export type { Fetch }
