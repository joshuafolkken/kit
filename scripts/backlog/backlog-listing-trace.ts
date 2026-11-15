// What each `auto-ok` listing check of a waiting driver found, printed to its log when it differs from
// the previous check, so a missed wake shows which step it fell at (joshuafolkken/kit#7583). Every
// change prints: each one wakes an ask.
type ListingOutcome = 'no-free-lane' | 'unchanged' | 'changed' | 'failed'

type ListingNote = (outcome: ListingOutcome) => void

const CHANGED: ListingOutcome = 'changed'

function print_error(line: string): void {
	console.error(line)
}

function tracer(print: (line: string) => void = print_error): ListingNote {
	const memory: { last?: ListingOutcome } = {}

	return function note(outcome: ListingOutcome): void {
		if (outcome !== CHANGED && outcome === memory.last) return

		memory.last = outcome
		print(`listing check: ${outcome} at ${new Date().toISOString()}`)
	}
}

function ignore(): void {
	// A watcher no driver traces: the arrival probe's output is the parent's wake line.
}

// The driver's one trace, shared by the free-lane gate (`backlog-offer-timing.ts`) and its watcher.
const drive = tracer()

const backlog_listing_trace = { drive, ignore, tracer }

export type { ListingNote, ListingOutcome }
export { backlog_listing_trace }
