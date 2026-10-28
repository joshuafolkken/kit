// The wording of the baseline investigation's notes on the run's event stream (joshuafolkken/kit#4887):
// `lane-baseline.ts` writes the launch and a failure, the session it launches writes its result, and
// `lane-baseline.ts` reads them back so a merge count is investigated once. `run:board` shows each as a
// note, since none reads as an overrun note.

const MERGES_PATTERN = /^baseline @(?<merges>\d+) merges: (?<rest>.*)$/u
const STARTED_PREFIX = 'started — '
const FAILED_PREFIX = 'baseline investigation failed: '

type BaselineNote =
	| { kind: 'started'; merges: number; outcome: string }
	| { kind: 'ended'; merges: number; result: string }
	| { kind: 'failed'; note: string }

function merges_text(merges: number, rest: string): string {
	return `baseline @${String(merges)} merges: ${rest}`
}

// The launch at the `merges`-th merge, and what became of it.
function started_text(merges: number, outcome: string): string {
	return merges_text(merges, `${STARTED_PREFIX}${outcome}`)
}

// The session's result — the overrun investigation's vocabulary (`lane-overrun-prompt.ts`).
function ended_text(merges: number, result: string): string {
	return merges_text(merges, result)
}

// A failure — reading the ledger, or the launch itself — names no merge count, so a later merge asks
// again.
function failed_text(note: string): string {
	return `${FAILED_PREFIX}${note}`
}

function merges_note(merges: number, rest: string): BaselineNote {
	if (rest.startsWith(STARTED_PREFIX)) {
		return { kind: 'started', merges, outcome: rest.slice(STARTED_PREFIX.length) }
	}

	return { kind: 'ended', merges, result: rest }
}

function parse(text: string): BaselineNote | undefined {
	const note = text.slice(FAILED_PREFIX.length)

	if (text.startsWith(FAILED_PREFIX)) return { kind: 'failed', note }

	const groups = MERGES_PATTERN.exec(text)?.groups

	return groups ? merges_note(Number(groups['merges']), groups['rest'] ?? '') : undefined
}

const run_event_baseline = { ended_text, failed_text, parse, started_text }

export type { BaselineNote }
export { run_event_baseline }
