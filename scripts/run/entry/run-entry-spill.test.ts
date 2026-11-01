import { readFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import { capped_print_part } from '#scripts/document/capped-print-part'
import { lane_child_marker } from '#scripts/lane/lane-child-marker'
import { run_prep, type PrepParts } from '#scripts/run/run-prep'
import { run_step_section_once } from '#scripts/run/run-step-section-once'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_entry_spill } from './run-entry-spill'

// The cap `.claude/settings.json` declares for this checkout — the figure the issue measured against.
const BASH_CAP_BYTES = 8000
const LARGE_BODY = '本文'.repeat(3000)
const LARGE_PROBLEMS = Array.from(
	{ length: 500 },
	(_, index) => `criterion ${String(index)} pending`,
)
const ENTRY_LINE = 'entry #5213 — hold: hold · cost: skipped · verdict: implement'
const SPILL_FILE_PATTERN = /written to (?<file>\S+);/u
const root = process.cwd()
const written: Array<string> = []

function parts_with(overrides: Partial<PrepParts>): PrepParts {
	return {
		issue_number: '5213',
		content_body: 'title: short',
		state: undefined,
		state_failure: 'state unread',
		latest_scope: 'skip',
		latest_reason: 'nothing owed',
		locations: 'none',
		has_changes: false,
		ship_problems: [],
		...overrides,
	}
}

function compose(report: string): string {
	return `${ENTRY_LINE}\n\n${report}`
}

function byte_length(text: string): number {
	return Buffer.byteLength(text, 'utf8')
}

// The file a report names, recorded so the test removes its directory afterwards.
function spill_file(report: string): string {
	const file = SPILL_FILE_PATTERN.exec(report)?.groups?.['file'] ?? ''

	if (file !== '') written.push(path.dirname(file))

	return file
}

// The bundle's own cases run as a lane child, where no watcher section shares the result.
beforeEach(() => {
	vi.spyOn(lane_child_marker, 'is_child_of').mockReturnValue(true)
	vi.spyOn(run_step_section_once, 'is_recorded').mockReturnValue(false)
})

afterEach(() => {
	for (const directory of written.splice(0)) rmSync(directory, { recursive: true, force: true })
	vi.restoreAllMocks()
})

// joshuafolkken/kit#5696: outside a lane child `run:entry` also prints the progress watcher's section.
describe('run_entry_spill.report_budget — the sections printed after the bundle', () => {
	it('leaves less outside a lane child than inside one', () => {
		const inside = run_entry_spill.report_budget(root)

		vi.mocked(lane_child_marker.is_child_of).mockReturnValue(false)

		expect(run_entry_spill.report_budget(root)).toBeLessThan(inside)
	})

	it('counts no watcher section once this session printed it', () => {
		const inside = run_entry_spill.report_budget(root)

		vi.mocked(lane_child_marker.is_child_of).mockReturnValue(false)
		vi.mocked(run_step_section_once.is_recorded).mockReturnValue(true)

		expect(run_entry_spill.report_budget(root)).toBe(inside)
	})
})

describe('run_entry_spill.fit — a bundle under the budget', () => {
	it('returns the bundle whole and names no file when it fits', () => {
		const parts = parts_with({})
		const report = run_entry_spill.fit(parts, compose, root)

		expect(report).toBe(run_prep.format_report(parts))
		expect(spill_file(report)).toBe('')
	})
})

describe('run_entry_spill.fit — a large issue bundle', () => {
	it('keeps the composite under the Bash cap, naming the file on one line', () => {
		const report = run_entry_spill.fit(parts_with({ content_body: LARGE_BODY }), compose, root)
		const file = spill_file(report)

		expect(byte_length(compose(report))).toBeLessThanOrEqual(run_entry_spill.report_budget(root))
		expect(run_entry_spill.report_budget(root)).toBeLessThan(BASH_CAP_BYTES)
		expect(report.split('\n').filter((line) => line.includes(file))).toHaveLength(1)
		expect(report).toContain(run_prep.SHIP_HEADER)
		expect(report).not.toContain(LARGE_BODY)
	})

	it('writes the whole bundle, the issue body included, to the named file', () => {
		const parts = parts_with({ content_body: LARGE_BODY })
		const file = spill_file(run_entry_spill.fit(parts, compose, root))

		expect(readFileSync(file, 'utf8')).toBe(run_prep.format_report(parts))
	})

	// The investigation guard exempts this shape, so reading the bundle costs no subject read.
	it('writes it as a capped_print part, the shape the investigation guard exempts', () => {
		const file = spill_file(
			run_entry_spill.fit(parts_with({ content_body: LARGE_BODY }), compose, root),
		)

		expect(capped_print_part.is_part_file(file)).toBe(true)
	})

	it('keeps only the summary and the path when the short sections alone overflow', () => {
		const parts = parts_with({ content_body: LARGE_BODY, ship_problems: LARGE_PROBLEMS })
		const report = run_entry_spill.fit(parts, compose, root)

		expect(byte_length(compose(report))).toBeLessThanOrEqual(run_entry_spill.report_budget(root))
		expect(report.startsWith(run_prep.summary(parts))).toBe(true)
		expect(report).not.toContain(run_prep.SHIP_HEADER)
		expect(spill_file(report)).not.toBe('')
	})
})
