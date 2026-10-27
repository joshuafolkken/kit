import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { unit_durations } from './unit-durations'

// joshuafolkken/kit#4467: the per-file durations the CI unit shards are balanced by, read by the
// published `josh test:related` too (joshuafolkken/kit#5105).

const KEPT = 'kept.test.ts'

const directories: Array<string> = []

afterEach(() => {
	for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('unit_durations.parse — the record as read', () => {
	it('keeps the numeric entries and drops anything else', () => {
		expect(unit_durations.parse(`{"${KEPT}": 3, "bad": "x"}`)).toStrictEqual({ [KEPT]: 3 })
		expect(unit_durations.parse('[]')).toStrictEqual({})
		expect(unit_durations.parse('null')).toStrictEqual({})
	})
})

describe('unit_durations.read — a missing record', () => {
	it('answers an empty record', () => {
		const root = mkdtempSync(path.join(tmpdir(), 'unit-durations-'))

		directories.push(root)

		expect(unit_durations.read(root)).toStrictEqual({})
	})
})
