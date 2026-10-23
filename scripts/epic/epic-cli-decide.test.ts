import { describe, expect, it } from 'vitest'
import { DECISION_FLAG } from './epic-cli'
import { DECIDE_FLAG, epic_cli_decide } from './epic-cli-decide'

// `--decide <E> <N…> --decision-file <path|->`'s argument rules. The record is the whole point of the
// form, so every way of leaving it out is a refusal rather than a decision with nothing in it.

const EPIC = '900'
const RECORD_PATH = 'records/why.md'

function parse(...argv: Array<string>): ReturnType<typeof epic_cli_decide.parse_decide_arguments> {
	return epic_cli_decide.parse_decide_arguments([DECIDE_FLAG, ...argv])
}

describe('is_decision_entry', () => {
	it('is true only when the flag is present', () => {
		expect(epic_cli_decide.is_decision_entry([DECIDE_FLAG, EPIC, '101'])).toBe(true)
		expect(epic_cli_decide.is_decision_entry(['--add', EPIC, '101'])).toBe(false)
	})
})

describe('parse_decide_arguments', () => {
	it('reads the epic, the children and the record path', () => {
		expect(parse(EPIC, '101', '102', DECISION_FLAG, RECORD_PATH)).toStrictEqual({
			epic_number: 900,
			children: [101, 102],
			decision_path: RECORD_PATH,
		})
	})

	it('refuses a missing --decision-file', () => {
		expect(parse(EPIC, '101')).toBeUndefined()
	})

	it('refuses --decision-file with no value', () => {
		expect(parse(EPIC, '101', DECISION_FLAG)).toBeUndefined()
	})

	it('refuses an epic with no child', () => {
		expect(parse(EPIC, DECISION_FLAG, RECORD_PATH)).toBeUndefined()
	})

	it('refuses a flag it does not know', () => {
		expect(parse(EPIC, '101', '--ordered', DECISION_FLAG, RECORD_PATH)).toBeUndefined()
	})
})
