import { PerformanceObserver } from 'node:perf_hooks'
import { lane_stats } from '#scripts/lane/lane-stats'
import type { StallStage } from './run-board-state'

// `josh run:board --timing` (joshuafolkken/kit#8148): the main thread's stalls on a live board. A probe
// due every `PROBE_MS` that runs `STALL_MS` or more late found the thread held; the stall is named by
// the loop's stage that held most of the probe's gap, and by the time a GC ran within that gap.
// joshuafolkken/kit#8825: each stall is said with when it began, counted from when the watch started, and
// every probe's lateness is kept as the loop's wake lag — how far past its time a timer due on it ran.

const PROBE_MS = 50
const STALL_MS = 200
// A wake later than this is counted apart: it holds a typing beat back by a whole probe period.
const LATE_MS = 50
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
	// When the stall began, in ms from when the watch started.
	at_ms: number
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
	lags: () => ReadonlyArray<number>
	rows: () => Array<[string, string]>
	stop: () => void
}

// The marks are those since the last probe, the GCs those of the last `GC_KEEP_MS`; `lags` every probe's
// lateness, and `origin` when the watch started.
interface Watching {
	now: () => number
	stage: StallStage
	marks: Array<StageMark>
	gcs: Array<Span>
	stalls: Array<Stall>
	lags: Array<number>
	origin: number
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

	watching.lags.push(Math.max(0, ms))

	if (ms >= STALL_MS) {
		const stage = dominant(watching, span)
		const at_ms = span.start - watching.origin

		watching.stalls.push({ ms, stage, gc_ms: gc_within(watching.gcs, span), span, at_ms })
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
		lags: [],
		origin: last,
		last,
	}
}

// A loop, not `Math.max(...samples)`: a board left up for hours takes more samples than one call spreads.
function longest(samples: ReadonlyArray<number>): number {
	let max = 0

	for (const ms of samples) max = Math.max(max, ms)

	return max
}

function stall_row(stall: Stall, index: number): [string, string] {
	const gc = stall.gc_ms > 0 ? `gc ${stall.gc_ms.toFixed(1)}` : 'no gc'
	const at = `at ${Math.round(stall.at_ms).toString()}`

	return [`stall ${String(index + 1)}`, `${stall.ms.toFixed(1)} ${stall.stage} · ${gc} · ${at}`]
}

// How many stalls, then the longest each with its stage, GC and start.
function rows(stalls: ReadonlyArray<Stall>): Array<[string, string]> {
	const listed = stalls.toSorted((first, second) => second.ms - first.ms).slice(0, LISTED_STALLS)
	const count: [string, string] = ['stalls', `n ${String(stalls.length)} over ${String(STALL_MS)}`]

	return [count, ...listed.map((stall, index) => stall_row(stall, index))]
}

// The wake lag's longest and median, and how many wakes ran later than `LATE_MS`; none before a probe.
function lag_rows(lags: ReadonlyArray<number>): Array<[string, string]> {
	const median = lane_stats.median(lags)

	if (median === undefined) return []
	const late = lags.filter((ms) => ms > LATE_MS).length
	const counted = `n ${String(late)} over ${String(LATE_MS)} (n ${String(lags.length)})`

	return [
		['wake lag', `max ${longest(lags).toFixed(1)} · median ${median.toFixed(1)} · ${counted}`],
	]
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
		lags: () => watching.lags,
		rows: () => [...rows(watching.stalls), ...lag_rows(watching.lags)],
		stop: () => {
			stop_probe()
			stop_gc()
		},
	}
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

const run_board_stall = { LATE_MS, PROBE_MS, PROCESS_PROBES, STALL_MS, longest, watch }

export { run_board_stall }
export type { Stall, StallProbes, StallWatch }
