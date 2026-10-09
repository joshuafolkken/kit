import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { metrics_logic, type Metrics } from './metrics-logic'
import { metrics_merge_driver } from './metrics-merge-driver'

// joshuafolkken/kit#3517: the driver git calls with `%O %A %B` — the merged file lands on ours and the
// exit code tells git whether the conflict is resolved.

const BASE: Metrics = {
	scripts: { files: 10, code_lines: 1000, comment_lines: 400, comment_ratio: 0.4 },
	rules: { files: 3, lines: 200 },
	guards: 5,
	ai_cost: { resident_bytes: 9000, on_demand_bytes: 300_000 },
}
const CONFLICT_EXIT_CODE = 1

const sides = { directory: '', base: '', ours: '', theirs: '' }

function write_side(file_path: string, guards: number): void {
	writeFileSync(file_path, metrics_logic.baseline_text({ ...BASE, guards }))
}

function arguments_list(): ReadonlyArray<string> {
	return [sides.base, sides.ours, sides.theirs]
}

describe('metrics_merge_driver.run — the merge git hands the driver', () => {
	beforeEach(() => {
		sides.directory = mkdtempSync(path.join(tmpdir(), 'metrics-merge-driver-'))
		sides.base = path.join(sides.directory, 'base.json')
		sides.ours = path.join(sides.directory, 'ours.json')
		sides.theirs = path.join(sides.directory, 'theirs.json')
	})

	afterEach(() => {
		rmSync(sides.directory, { recursive: true, force: true })
	})

	it('writes both sides added together over ours and exits 0', () => {
		write_side(sides.base, 5)
		write_side(sides.ours, 6)
		write_side(sides.theirs, 7)

		expect(metrics_merge_driver.run(arguments_list())).toBe(0)

		const merged: unknown = JSON.parse(readFileSync(sides.ours, 'utf8'))

		expect(merged).toStrictEqual({ ...BASE, guards: 8 })
	})

	it('leaves ours untouched and exits non-zero on a side it cannot read as a baseline', () => {
		write_side(sides.base, 5)
		writeFileSync(sides.ours, 'not json')
		write_side(sides.theirs, 7)

		expect(metrics_merge_driver.run(arguments_list())).toBe(CONFLICT_EXIT_CODE)
		expect(readFileSync(sides.ours, 'utf8')).toBe('not json')
	})
})
