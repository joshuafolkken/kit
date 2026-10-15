import { PROBE_TIMEOUT_MS } from '#scripts/lib/timeouts'
import { execa } from 'execa'

// What the machine's load is made of at one instant: every process grouped by the kind of tool it
// runs, the heaviest kinds kept with their CPU and resident size, for a `load` sample to carry.
//
// **Why a load sample needs it.** The gate's static checks and unit suite are on the core budget's
// ledger, so the load the ledger does not explain comes from somewhere else — review subagents, the
// sessions themselves, a hook's unit run, an IDE — and a load average alone cannot say which.
// joshuafolkken/kit#3874 measured load 93 with 1.6 lanes working and nothing on record to explain it.
//
// **The kind is read from the command line, not the executable name.** Every tool here is a `node`
// process, so the name says nothing; the first pattern a command line matches names its kind, in the
// order below, so `pnpm exec vitest` is `vitest` rather than `josh`. The IDE comes first: its language
// servers run out of a `typescript` or `eslint` directory, and read as `tsc` or `eslint` they would
// pass the IDE's load off as the gate's own checks. `pnpm` is the command, never the `.pnpm/` store a
// resolved binary's path runs through.
//
// **`%cpu` is the share of one core**, so 300 is three cores busy; it is `ps`'s decaying average,
// which is what a one-minute sample beside the one-minute load average wants.

const PS_ARGUMENTS = ['-A', '-o', 'rss=,%cpu=,args=']
const FIELD_SEPARATOR = /\s+/u
const KB_PER_MB = 1024
// Enough to name what dominates and the runner-up behind it, short enough for one ledger line a minute.
const TOP_KINDS = 5
const OTHER_KIND = 'other'

const KIND_PATTERNS: ReadonlyArray<readonly [string, RegExp]> = [
	['vscode', /Visual Studio Code|Code Helper/u],
	['vitest', /vitest/u],
	['eslint', /eslint/u],
	['tsc', /\btsc\b|svelte-check|typescript/u],
	['cspell', /cspell/u],
	['prettier', /prettier/u],
	['playwright', /playwright/u],
	['chrome', /Google Chrome/u],
	['chromium', /chromium|headless_shell/iu],
	['claude', /claude/u],
	['josh', /josh\.ts|\btsx\b|(?<!\.)\bpnpm\b/u],
	['node', /\bnode\b/u],
]

interface ProcessKind {
	kind: string
	cpu_percent: number
	rss_mb: number
	count: number
}

function kind_of(command_line: string): string {
	return KIND_PATTERNS.find(([, pattern]) => pattern.test(command_line))?.[0] ?? OTHER_KIND
}

// One line of `ps`'s listing as its kind and readings; a header or a cut-short line reads as nothing.
function process_of(line: string): Omit<ProcessKind, 'count'> | undefined {
	const [rss, cpu, ...command] = line.trim().split(FIELD_SEPARATOR)
	const reading = { cpu_percent: Number(cpu), rss_mb: Number(rss) / KB_PER_MB }

	if (command.length === 0 || Number.isNaN(reading.cpu_percent + reading.rss_mb)) return undefined

	return { kind: kind_of(command.join(' ')), ...reading }
}

function add_line(totals: Map<string, ProcessKind>, line: string): void {
	const reading = process_of(line)

	if (reading === undefined) return

	const { kind } = reading
	const total = totals.get(kind) ?? { kind, cpu_percent: 0, rss_mb: 0, count: 0 }

	total.cpu_percent += reading.cpu_percent
	total.rss_mb += reading.rss_mb
	total.count += 1
	totals.set(kind, total)
}

function rounded(total: ProcessKind): ProcessKind {
	return { ...total, cpu_percent: Math.round(total.cpu_percent), rss_mb: Math.round(total.rss_mb) }
}

// The heaviest kinds first: by CPU, the load average's own measure, then by memory for idle kinds.
function by_weight(left: ProcessKind, right: ProcessKind): number {
	return right.cpu_percent - left.cpu_percent || right.rss_mb - left.rss_mb
}

function summarize(listing: string): Array<ProcessKind> {
	const totals = new Map<string, ProcessKind>()

	for (const line of listing.split('\n')) add_line(totals, line)

	return [...totals.values()]
		.map((total) => rounded(total))
		.toSorted(by_weight)
		.slice(0, TOP_KINDS)
}

// `undefined` where `ps` did not answer, so the sample records no breakdown rather than an empty one.
async function read(): Promise<Array<ProcessKind> | undefined> {
	try {
		const { stdout } = await execa('ps', PS_ARGUMENTS, { timeout: PROBE_TIMEOUT_MS })

		return summarize(stdout)
	} catch {
		return undefined
	}
}

const lane_process_load = {
	TOP_KINDS,
	kind_of,
	read,
	summarize,
}

export type { ProcessKind }
export { lane_process_load }
