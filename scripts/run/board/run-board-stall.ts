import { PerformanceObserver } from 'node:perf_hooks'
import type { StallStage } from './run-board-state'

// `josh run:board --timing` (joshuafolkken/kit#8148): the main thread's stalls on a live board. A probe
// due every `PROBE_MS` that runs `STALL_MS` or more late found the thread held; the stall is named by
// the loop's stage that held most of the probe's gap, and by the time a GC ran within that gap.

const PROBE_MS = 50
const STALL_MS = 200
// How long a GC is kept to meet a stall its probe notices after it.
const GC_KEEP_MS = 5000
// The latest stalls a GC reported after their probe can still fall within.
const RECENT_STALLS = 2
const LISTED_STALLS = 10
const FIRST_STAGE: StallStage = 'redraw'

interface Span {
	start: number
	end: number
}

interface Stall {
	ms: number
	stage: StallStage
	gc_ms: number
	span: Span
}

interface StageMark {
	stage: StallStage
	at: number
}

// The clock, the probe's timer and the GC observer — the process's own outside tests.
interface StallProbes {
	now: () => number
	every: (ms: number, probe: () => void) => () => void
	observe_gc: (seen: (gc: Span) => void) => () => void
}

interface StallWatch {
	enter: (stage: StallStage) => void
	stalls: () => ReadonlyArray<Stall>
	stop: () => void
}

// The marks are those since the last probe, the GCs those of the last `GC_KEEP_MS`.
interface Watching {
	now: () => number
	stage: StallStage
	marks: Array<StageMark>
	gcs: Array<Span>
	stalls: Array<Stall>
	last: number
}

function overlap(first: Span, second: Span): number {
	return Math.max(0, Math.min(first.end, second.end) - Math.max(first.start, second.start))
}

// Each stage's share of `span`: a mark holds until the next.
function shares(marks: ReadonlyArray<StageMark>, span: Span): Map<StallStage, number> {
	const held = new Map<StallStage, number>()

	for (const [index, mark] of marks.entries()) {
		const share = overlap({ start: mark.at, end: marks[index + 1]?.at ?? span.end }, span)

		held.set(mark.stage, (held.get(mark.stage) ?? 0) + share)
	}

	return held
}

function dominant(watching: Watching, span: Span): StallStage {
	let top: [StallStage, number] = [watching.stage, -1]

	for (const entry of shares(watching.marks, span)) if (entry[1] > top[1]) top = entry

	return top[0]
}

function gc_within(gcs: ReadonlyArray<Span>, span: Span): number {
	return gcs.reduce((sum, gc) => sum + overlap(gc, span), 0)
}

function forget(watching: Watching, now: number): void {
	watching.marks = [{ stage: watching.stage, at: now }]
	watching.gcs = watching.gcs.filter((gc) => gc.end >= now - GC_KEEP_MS)
	watching.last = now
}

function probe(watching: Watching): void {
	const now = watching.now()
	const span = { start: watching.last, end: now }
	const ms = now - watching.last - PROBE_MS

	if (ms >= STALL_MS) {
		const stage = dominant(watching, span)

		watching.stalls.push({ ms, stage, gc_ms: gc_within(watching.gcs, span), span })
	}

	forget(watching, now)
}

// A GC reported after the probe that noticed its stall is added to that stall.
function seen_gc(watching: Watching, gc: Span): void {
	const recent = watching.stalls.slice(-RECENT_STALLS)

	watching.gcs.push(gc)
	for (const stall of recent) stall.gc_ms += overlap(gc, stall.span)
}

function entered(watching: Watching, stage: StallStage): void {
	watching.stage = stage
	watching.marks.push({ stage, at: watching.now() })
}

// Nothing seen yet, the loop taken to start on its first redraw.
function started(now: () => number): Watching {
	const last = now()

	return {
		now,
		stage: FIRST_STAGE,
		marks: [{ stage: FIRST_STAGE, at: last }],
		gcs: [],
		stalls: [],
		last,
	}
}

// Watches from here until `stop`.
function watch(probes: StallProbes): StallWatch {
	const watching = started(probes.now)
	const stop_probe = probes.every(PROBE_MS, () => {
		probe(watching)
	})
	const stop_gc = probes.observe_gc((gc) => {
		seen_gc(watching, gc)
	})

	return {
		enter: (stage) => {
			entered(watching, stage)
		},
		stalls: () => watching.stalls,
		stop: () => {
			stop_probe()
			stop_gc()
		},
	}
}

function stall_row(stall: Stall, index: number): [string, string] {
	const gc = stall.gc_ms > 0 ? `gc ${stall.gc_ms.toFixed(1)}` : 'no gc'

	return [`stall ${String(index + 1)}`, `${stall.ms.toFixed(1)} ${stall.stage} · ${gc}`]
}

// How many stalls, then the longest each with its stage and GC.
function rows(stalls: ReadonlyArray<Stall>): Array<[string, string]> {
	const longest = stalls.toSorted((first, second) => second.ms - first.ms).slice(0, LISTED_STALLS)
	const count: [string, string] = ['stalls', `n ${String(stalls.length)} over ${String(STALL_MS)}`]

	return [count, ...longest.map((stall, index) => stall_row(stall, index))]
}

function every(ms: number, run: () => void): () => void {
	const timer = setInterval(run, ms)

	timer.unref()

	return () => {
		clearInterval(timer)
	}
}

function observe_gc(seen: (gc: Span) => void): () => void {
	const observer = new PerformanceObserver((list) => {
		for (const entry of list.getEntries()) {
			seen({ start: entry.startTime, end: entry.startTime + entry.duration })
		}
	})

	observer.observe({ entryTypes: ['gc'] })

	return () => {
		observer.disconnect()
	}
}

const PROCESS_PROBES: StallProbes = {
	now: performance.now.bind(performance),
	every,
	observe_gc,
}

const run_board_stall = { PROBE_MS, PROCESS_PROBES, STALL_MS, rows, watch }

export { run_board_stall }
export type { Stall, StallProbes, StallWatch }
