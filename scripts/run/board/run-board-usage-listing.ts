import { existsSync } from 'node:fs'
import path from 'node:path'
import type { ProcessRow, ProcessTable } from '#scripts/lane/lane-process-table'
import { MS_PER_SECOND } from '#scripts/lib/timeouts'
import type { StatedProcess } from './run-board-paused'

// The usage columns' reading of one process snapshot (`lane-process-table.ts`), the same rows the lane
// count reads, so no second `ps` is spawned (joshuafolkken/kit#4246).
// **The executable is cut from the command line**, since the snapshot carries the full line rather than
// `comm`: an absolute path runs on across its spaces — `Application Support/`, `Visual Studio Code.app/`
// — to the shortest run of words that names an existing file, since the text alone cannot tell a spaced
// directory from a relative argument (`node scripts/foo.ts`). When no run exists, the path ends at the
// last word holding a directory before the first option or absolute path; a file name with a space of
// its own is then cut at it, which leaves the bundle that names an app whole.

const DAY_SEPARATOR = '-'
const CLOCK_SEPARATOR = ':'
const SECONDS_PER_DAY = 86_400
const SECONDS_PER_CLOCK_PART = 60
const BYTES_PER_KB = 1024
const WORD_SEPARATOR = ' '
const OPTION_PREFIX = '-'

// One process's line of the snapshot: its own CPU time, resident set and state.
interface ProcessListing extends StatedProcess {
	parent: number
	// The executable, which names the app the process belongs to.
	command: string
	cpu_ms: number
	rss_bytes: number
}

// `ps`'s `time`, `[DD-][HH:]MM:SS[.ss]`, in milliseconds.
function cpu_ms_of(text: string): number {
	const [days, clock = ''] = text.includes(DAY_SEPARATOR) ? text.split(DAY_SEPARATOR) : ['0', text]
	const seconds = clock
		.split(CLOCK_SEPARATOR)
		.reduce((sum, part) => sum * SECONDS_PER_CLOCK_PART + Number(part), 0)

	return (Number(days) * SECONDS_PER_DAY + seconds) * MS_PER_SECOND
}

// A word that opens an argument of its own: an option or another absolute path.
function opens_argument(word: string): boolean {
	return word.startsWith(path.sep) || word.startsWith(OPTION_PREFIX)
}

// The absolute path's possible ends, shortest first: the first word, then each later word joined on.
function path_candidates(first: string, words: Array<string>): Array<string> {
	return [
		first,
		...words.map((_, index) => [first, ...words.slice(0, index + 1)].join(WORD_SEPARATOR)),
	]
}

/** The executable a command line runs: its first word, or an absolute path with its spaces kept. */
function executable_of(command: string): string {
	const [first = '', ...rest] = command.split(WORD_SEPARATOR)

	if (!first.startsWith(path.sep)) return first

	const opened = rest.findIndex((word) => opens_argument(word))
	const words = opened === -1 ? rest : rest.slice(0, opened)
	const existing = path_candidates(first, words).find((candidate) => existsSync(candidate))

	if (existing !== undefined) return existing

	const last_directory = words.findLastIndex((word) => word.includes(path.sep))

	return [first, ...words.slice(0, last_directory + 1)].join(WORD_SEPARATOR)
}

function listing_of(row: ProcessRow): [number, ProcessListing] | undefined {
	const { pid, parent, time, rss_kb, stat, command } = row
	const cpu_ms = cpu_ms_of(time)

	if (Number.isNaN(cpu_ms)) return undefined

	const listing = { parent, command: executable_of(command), cpu_ms, stat }

	return [pid, { ...listing, rss_bytes: rss_kb * BYTES_PER_KB }]
}

/** Each row of the snapshot as its listing, by pid; a row whose CPU time does not read is left out. */
function listings_of(table: ProcessTable): Map<number, ProcessListing> {
	const listings = table.map((row) => listing_of(row))

	return new Map(listings.filter((listing) => listing !== undefined))
}

const run_board_usage_listing = { executable_of, listings_of }

export { run_board_usage_listing }
export type { ProcessListing }
