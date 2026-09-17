import { describe, expect, it } from 'vitest'
import { DECISION_FLAG, epic_cli, REMOVE_FLAG } from './epic-cli'

// `--remove <E> <M> <N> …`'s argument rules (joshuafolkken/kit#1712). Kept out of `epic-cli.test.ts`
// for the reason `--add`'s were: that file is at its line ceiling, and each form's rules read as one
// suite rather than as an appendix to another's.

const EPIC = '900'
const RECORD_PATH = 'records/why.md'

function parse(...argv: Array<string>): ReturnType<typeof epic_cli.parse_remove_arguments> {
	return epic_cli.parse_remove_arguments([REMOVE_FLAG, ...argv])
}

describe('is_removal', () => {
	it('is true only when the flag is present', () => {
		expect(epic_cli.is_removal([REMOVE_FLAG, EPIC, '101', '102'])).toBe(true)
		expect(epic_cli.is_removal(['--add', EPIC, '101'])).toBe(false)
	})
})

describe('parse_remove_arguments', () => {
	it('reads the epic and the path', () => {
		expect(parse(EPIC, '101', '102')).toStrictEqual({
			epic_number: 900,
			path: [101, 102],
			decision_path: undefined,
		})
	})

	it('keeps a longer path as written, so each consecutive pair is one order', () => {
		expect(parse(EPIC, '101', '102', '103')?.path).toStrictEqual([101, 102, 103])
	})

	it('refuses a path of one issue, which names no order', () => {
		expect(parse(EPIC, '101')).toBeUndefined()
	})

	it('refuses an unparsable member rather than skipping it and shifting every pair after it', () => {
		expect(parse(EPIC, '101', 'x', '103')).toBeUndefined()
	})

	it('refuses a flag it does not know, for the reason `--add` does', () => {
		expect(parse(EPIC, '101', '102', '--before', '103')).toBeUndefined()
	})

	it('reads the decision file path without taking it for an issue number', () => {
		const parsed = parse(EPIC, '101', '102', DECISION_FLAG, RECORD_PATH)

		expect(parsed?.path).toStrictEqual([101, 102])
		expect(parsed?.decision_path).toBe(RECORD_PATH)
	})

	it('refuses a decision flag whose value a shell ate', () => {
		expect(parse(EPIC, '101', '102', DECISION_FLAG)).toBeUndefined()
	})
})
