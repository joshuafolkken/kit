import { describe, expect, it } from 'vitest'
import { time_format } from './time-format'
import type { PullFile } from './time-pull-files'
import { time_rework, type DiffFacts, type ReworkTotals } from './time-rework'
import { time_span_fixture } from './time-span-fixture'
import { time_spans, type Span } from './time-spans'

// Reconciling a run's edits against its merged diff, and the size of that diff
// (joshuafolkken/kit#1387).
//
// The subject is run #1379, where `scripts/verification-gate.ts` was edited twice and appears nowhere
// in the merged diff — a mid-implementation change of approach that no scope of `josh time` could see.

const { edit_span, span } = time_span_fixture

const DROPPED_PATH = 'scripts/verification-gate.ts'
const KEPT_PATH = 'scripts/time/time-report.ts'
// A path no repository could hold, so an edit naming it can never appear in any diff. Written as a
// home-relative scratch directory rather than under a publicly writable one, which the lint rules flag
// on sight and which says nothing extra here.
const OUTSIDE_PATH = '/Users/someone/scratch/scan.ts'
const NAKED_ROOT = '/Users/someone/Development/kit'
const ROOT = `${NAKED_ROOT}/`
const ADDITIONS = 254
const DELETIONS = 40
const KEPT_EDITS = 3
const DROPPED_EDITS = 2

function file(path: string, additions = ADDITIONS, deletions = DELETIONS): PullFile {
	return { path, additions, deletions }
}

function diff(files: ReadonlyArray<PullFile>): DiffFacts {
	return { files, state: time_rework.DIFF_READ, root: ROOT }
}

// A merged pull request whose file listing could not be read — the state that withholds rather than the
// one that says there was never a diff.
function refused(): DiffFacts {
	return { files: [], state: time_rework.DIFF_REFUSED, root: ROOT }
}

// The merged diff every case shares: one file, which is the file the run kept.
const KEPT_DIFF = diff([file(KEPT_PATH)])

function totals_of(spans: ReadonlyArray<Span>, facts: DiffFacts = KEPT_DIFF): ReworkTotals {
	return time_rework.build_rework(spans, facts)
}

// The edits run #1379 made, as the transcript recorded them: absolute paths, the kept file touched
// several times, the abandoned one twice.
function run_spans(): Array<Span> {
	const dropped = Array.from({ length: DROPPED_EDITS }, () =>
		edit_span('Edit', `${ROOT}${DROPPED_PATH}`),
	)
	const kept = Array.from({ length: KEPT_EDITS }, () => edit_span('Edit', `${ROOT}${KEPT_PATH}`))

	return [...dropped, ...kept]
}

function line_of(lines: ReadonlyArray<string>, needle: string): string {
	return lines.find((line) => line.includes(needle)) ?? ''
}

function unread_lines(): Array<string> {
	return time_rework.rework_lines(totals_of(run_spans(), refused()))
}

describe('time_rework.build_rework — the edits that never landed', () => {
	it('names the file that was edited and is absent from the merged diff', () => {
		const dropped = totals_of(run_spans()).files.filter(
			(one) => one.presence === time_rework.DROPPED,
		)

		expect(dropped).toEqual([
			{ path: DROPPED_PATH, edit_count: DROPPED_EDITS, presence: time_rework.DROPPED },
		])
	})

	it('reports the edit count of a file that did land', () => {
		const kept = totals_of(run_spans()).files.find((one) => one.path === KEPT_PATH)

		expect(kept).toEqual({
			path: KEPT_PATH,
			edit_count: KEPT_EDITS,
			presence: time_rework.IN_DIFF,
		})
	})

	it('orders the file that never landed first, ahead of one edited more often', () => {
		const totals = totals_of(run_spans())

		expect(totals.files[0]?.path).toBe(DROPPED_PATH)
		expect(totals.dropped_count).toBe(1)
	})
})

describe('time_rework.build_rework — how a path is spelled', () => {
	it('prints the repository-relative spelling for a file that landed', () => {
		const totals = totals_of([edit_span('Write', `${ROOT}${KEPT_PATH}`)])

		expect(totals.files[0]?.path).toBe(KEPT_PATH)
	})

	it('strips the work-tree root from a dropped path', () => {
		expect(totals_of(run_spans()).files[0]?.path).toBe(DROPPED_PATH)
	})

	it('refuses a basename collision — a nested file is not the diff’s root file', () => {
		const nested = 'docs/README.md'
		const totals = totals_of([edit_span('Edit', `${ROOT}${nested}`)], diff([file('README.md')]))

		expect(totals.files[0]).toEqual({ path: nested, edit_count: 1, presence: time_rework.DROPPED })
	})

	it('accepts a root without a trailing separator', () => {
		const facts = { files: [file(KEPT_PATH)], state: time_rework.DIFF_READ, root: NAKED_ROOT }
		const totals = totals_of([edit_span('Edit', `${ROOT}${KEPT_PATH}`)], facts)

		expect(totals.files[0]?.presence).toBe(time_rework.IN_DIFF)
	})
})

describe('time_rework.build_rework — an edit outside the work tree', () => {
	it('counts it apart rather than calling it work that was thrown away', () => {
		const totals = totals_of([edit_span('Edit', OUTSIDE_PATH)])

		expect(totals.outside_file_count).toBe(1)
		expect(totals.dropped_count).toBe(0)
		expect(totals.files).toEqual([])
	})

	it('prints the count without the local absolute path', () => {
		const totals = totals_of([edit_span('Edit', OUTSIDE_PATH)])
		const lines = time_rework.rework_lines(totals)

		expect(line_of(lines, time_rework.OUTSIDE_LABEL)).toContain(time_rework.OUTSIDE_SUFFIX)
		expect(line_of(lines, OUTSIDE_PATH)).toBe('')
	})

	it('prints no row at all where every edit was inside the tree', () => {
		const lines = time_rework.rework_lines(totals_of(run_spans()))

		expect(line_of(lines, time_rework.OUTSIDE_LABEL)).toBe('')
	})
})

describe('time_rework.build_rework — what counts as an edit', () => {
	it('counts a Write as an edit and a Read as none', () => {
		const spans = [edit_span('Write', `${ROOT}${KEPT_PATH}`), edit_span('Read', `${ROOT}a.ts`)]

		expect(totals_of(spans).files).toHaveLength(1)
	})

	it('counts a continuation’s duration but not a second edit', () => {
		const head = edit_span('Edit', `${ROOT}${KEPT_PATH}`)
		const totals = totals_of([head, { ...head, is_continuation: true }])

		expect(totals.files[0]?.edit_count).toBe(1)
	})
})

describe('time_rework.build_rework — the change size', () => {
	it('totals the files, the additions and the deletions of the merged diff', () => {
		const files = [file(KEPT_PATH, ADDITIONS, DELETIONS), file(DROPPED_PATH, 1, 2)]

		expect(totals_of([], diff(files)).size).toEqual({
			changed_file_count: 2,
			additions: ADDITIONS + 1,
			deletions: DELETIONS + 2,
		})
	})
})

describe('time_rework.build_rework — what is withheld', () => {
	it('marks every file unknown when the merged diff was not read', () => {
		const totals = totals_of(run_spans(), refused())

		expect(totals.files.every((one) => one.presence === time_rework.UNKNOWN)).toBe(true)
		expect(totals.state).toBe(time_rework.DIFF_REFUSED)
	})

	it('does not count an unreconciled file as dropped', () => {
		expect(totals_of(run_spans(), refused()).dropped_count).toBe(0)
	})

	it('says no transcript was read rather than that no file was edited', () => {
		expect(totals_of([]).is_measured).toBe(false)
		expect(totals_of([span(time_spans.MODEL_CATEGORY)]).is_measured).toBe(true)
	})
})

describe('time_rework.rework_lines — a measured run', () => {
	it('prints the size rows and the file that never landed', () => {
		const lines = time_rework.rework_lines(totals_of(run_spans()))

		expect(line_of(lines, time_rework.FILES_LABEL)).toContain('1')
		expect(line_of(lines, time_rework.ADDITIONS_LABEL)).toContain(String(ADDITIONS))
		expect(line_of(lines, time_rework.DELETIONS_LABEL)).toContain(String(DELETIONS))
		expect(line_of(lines, DROPPED_PATH)).toContain(time_rework.DROPPED_SUFFIX)
	})

	it('caps the file table and says how many rows it withheld', () => {
		const count = time_format.MAX_ROWS + 2
		const spans = Array.from({ length: count }, (_unused, index) =>
			edit_span('Edit', `${ROOT}scripts/file-${String(index)}.ts`),
		)
		const lines = time_rework.rework_lines(totals_of(spans))

		expect(lines.filter((line) => line.includes('scripts/file-'))).toHaveLength(
			time_format.MAX_ROWS,
		)
		expect(line_of(lines, 'and 2 more')).not.toBe('')
	})
})

describe('time_rework.rework_lines — what it withholds', () => {
	it('says the change size could not be measured rather than printing zeros', () => {
		const lines = unread_lines()

		for (const label of [
			time_rework.FILES_LABEL,
			time_rework.ADDITIONS_LABEL,
			time_rework.DELETIONS_LABEL,
			time_rework.DROPPED_LABEL,
		]) {
			expect(line_of(lines, label)).toContain(time_format.NOT_MEASURED)
		}
	})

	it('says a row was not reconciled rather than that it never landed', () => {
		expect(line_of(unread_lines(), DROPPED_PATH)).toContain(time_rework.UNKNOWN_SUFFIX)
	})

	it('withholds the file table when no span was read', () => {
		const lines = time_rework.rework_lines(totals_of([]))

		expect(line_of(lines, time_rework.EDITED_LABEL)).toContain(time_format.NOT_MEASURED)
	})

	it('says a read transcript made no edit rather than printing an empty table', () => {
		const lines = time_rework.rework_lines(totals_of([span(time_spans.MODEL_CATEGORY)]))

		expect(line_of(lines, time_rework.EDITED_LABEL)).toContain(time_rework.NO_EDITS)
	})

	it('prints no block at all for a scope that never had a pull request', () => {
		const totals = totals_of(run_spans(), time_rework.NO_DIFF)

		expect(time_rework.rework_lines(totals)).toEqual([])
	})
})
