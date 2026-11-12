import { temporary_directory } from '#tools/test/temporary-directory'
import { describe, expect, it } from 'vitest'
import { unit_durations } from './unit-durations'

// joshuafolkken/kit#4467: the per-file durations the CI unit shards are balanced by, read by the
// published `josh test:related` too (joshuafolkken/kit#5105).

const KEPT = 'kept.test.ts'

const make_directory = temporary_directory()

describe('unit_durations.parse — the record as read', () => {
	it('keeps the numeric entries and drops anything else', () => {
		expect(unit_durations.parse(`{"${KEPT}": 3, "bad": "x"}`)).toStrictEqual({ [KEPT]: 3 })
		expect(unit_durations.parse('[]')).toStrictEqual({})
		expect(unit_durations.parse('null')).toStrictEqual({})
	})
})

describe('unit_durations.read — a missing record', () => {
	it('answers an empty record', () => {
		const root = make_directory('unit-durations-')

		expect(unit_durations.read(root)).toStrictEqual({})
	})
})
