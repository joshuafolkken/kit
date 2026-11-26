import { describe, expect, it } from 'vitest'
import { run_board_seeded } from './run-board-seeded-fixture'

const { seeded } = run_board_seeded
const COUNT = 64

function sequence(seed: number): Array<number> {
	const random = seeded(seed)

	return Array.from({ length: COUNT }, () => random())
}

describe('run_board_seeded.seeded', () => {
	it('draws the same sequence for the same seed', () => {
		expect(sequence(42)).toStrictEqual(sequence(42))
	})

	it('draws a different sequence for a different seed', () => {
		expect(sequence(1)).not.toStrictEqual(sequence(2))
	})

	it('keeps every value in [0, 1)', () => {
		const values = sequence(7)

		expect(values.every((value) => value >= 0 && value < 1)).toBe(true)
	})
})
