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
// pass the IDE's load off as the gate's own checks — and a server the IDE starts on a plain `node`
// runtime is known only by its `.vscode/extensions/` path. `claude` is the executable or its package,
// never a `.claude/` path a session's Bash-tool shell or hook script runs through. `pnpm` is the
// command, never the `.pnpm/` store a resolved binary's path runs through.
//
// **`%cpu` is the share of one core**, so 300 is three cores busy; it is `ps`'s decaying average,
// which is what a one-minute sample beside the one-minute load average wants.

const PS_ARGUMENTS = ['-A', '-o', 'rss=,%cpu=,args=']
// `ps` prints `%cpu` with the locale's decimal separator, and a `0,7` would parse as NaN.
const PS_ENVIRONMENT = { LC_ALL: 'C' }
const FIELD_SEPARATOR = /\s+/u
const KB_PER_MB = 1024
// Enough to name what dominates and the runner-up behind it, short enough for one ledger line a minute.
const TOP_KINDS = 5
const OTHER_KIND = 'other'
// The apps a person keeps open beside a run, matched as command-line substrings: every Chrome and VS Code
// helper runs out of its `.app` bundle, so the bundle name catches them all — and only them: Playwright's
// `Google Chrome for Testing.app` is not the person's browser.
const RESIDENT_APPS: ReadonlyArray<string> = ['Google Chrome.app', 'Visual Studio Code.app']

const KIND_PATTERNS: ReadonlyArray<readonly [string, RegExp]> = [
	['vscode', /Visual Studio Code|Code Helper|\.vscode\/extensions\//u],
	['vitest', /vitest/u],
	['eslint', /eslint/u],
	['tsc', /\btsc\b|svelte-check|typescript/u],
	['cspell', /cspell/u],
	['prettier', /prettier/u],
	['playwright', /playwright/u],
	['chrome', /Google Chrome/u],
	['chromium', /chromium|headless_shell/iu],
	['claude', /(?:^|\/)claude(?:\s|$)|@anthropic-ai\/claude-code\//u],
	['josh', /josh\.ts|\btsx\b|(?<!\.)\bpnpm\b/u],
	['node', /\bnode\b/u],
]

interface ProcessKind {
	kind: string
	cpu_percent: number
	rss_mb: number
	count: number
}

interface ProcessSnapshot {
	processes: Array<ProcessKind>
	resident_mb?: number | undefined
}

interface LineReading {
	command_line: string
	cpu_percent: number
	rss_mb: number
}

function kind_of(command_line: string): string {
	return KIND_PATTERNS.find(([, pattern]) => pattern.test(command_line))?.[0] ?? OTHER_KIND
}

// One line of `ps`'s listing as its command line and readings; a header or a cut-short line reads as nothing.
function line_of(line: string): LineReading | undefined {
	const [rss, cpu, ...command] = line.trim().split(FIELD_SEPARATOR)
	const reading = { cpu_percent: Number(cpu), rss_mb: Number(rss) / KB_PER_MB }

	if (command.length === 0 || Number.isNaN(reading.cpu_percent + reading.rss_mb)) return undefined

	return { command_line: command.join(' '), ...reading }
}

function process_of(line: string): Omit<ProcessKind, 'count'> | undefined {
	const reading = line_of(line)

	if (reading === undefined) return undefined

	return {
		kind: kind_of(reading.command_line),
		cpu_percent: reading.cpu_percent,
		rss_mb: reading.rss_mb,
	}
}

function is_resident(
	reading: LineReading | undefined,
	names: ReadonlyArray<string>,
): reading is LineReading {
	return reading !== undefined && names.some((name) => reading.command_line.includes(name))
}

// The resident size of every process a resident app runs, summed, so `lane:stats` can set a day the apps
// were closed beside a day they were not (joshuafolkken/kit#5658); `undefined` with no names to match.
function resident_mb(listing: string, names: ReadonlyArray<string>): number | undefined {
	if (names.length === 0) return undefined

	const readings = listing.split('\n').map((line) => line_of(line))
	const resident = readings.filter((reading) => is_resident(reading, names))

	return Math.round(resident.reduce((total, reading) => total + reading.rss_mb, 0))
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
async function read(
	names: ReadonlyArray<string> = RESIDENT_APPS,
): Promise<ProcessSnapshot | undefined> {
	try {
		const { stdout } = await execa('ps', PS_ARGUMENTS, {
			env: PS_ENVIRONMENT,
			timeout: PROBE_TIMEOUT_MS,
		})

		return { processes: summarize(stdout), resident_mb: resident_mb(stdout, names) }
	} catch {
		return undefined
	}
}

const lane_process_load = {
	RESIDENT_APPS,
	TOP_KINDS,
	kind_of,
	read,
	resident_mb,
	summarize,
}

export type { ProcessKind, ProcessSnapshot }
export { lane_process_load }
