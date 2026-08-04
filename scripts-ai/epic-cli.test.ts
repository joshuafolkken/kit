import { describe, expect, it } from 'vitest'
import { epic_cli } from './epic-cli'

const TITLE = 'Epic: split the parser work'
const ORIGIN_REFERENCE = 'joshuafolkken/app-kit#144'

describe('epic_cli.parse_create_arguments — title and children', () => {
	it('reads the title and the child issue numbers', () => {
		const parsed = epic_cli.parse_create_arguments([TITLE, '101', '102'])

		expect(parsed?.title).toBe(TITLE)
		expect(parsed?.children).toStrictEqual([101, 102])
	})

	it('rejects an invocation with no child issue numbers', () => {
		expect(epic_cli.parse_create_arguments([TITLE])).toBeUndefined()
	})

	it('rejects an invocation with no title', () => {
		expect(epic_cli.parse_create_arguments([])).toBeUndefined()
	})

	it('ignores arguments that are not positive issue numbers', () => {
		expect(epic_cli.parse_create_arguments([TITLE, '0', 'abc'])).toBeUndefined()
	})

	// A repeated number would render a duplicate task-list row, and with `--ordered` would ask
	// GitHub to make an issue block itself.
	it('drops a repeated child issue number', () => {
		expect(epic_cli.parse_create_arguments([TITLE, '101', '102', '101'])?.children).toStrictEqual([
			101, 102,
		])
	})
})

describe('epic_cli.parse_create_arguments — flags', () => {
	it('treats the batch as unordered unless the flag is given', () => {
		expect(epic_cli.parse_create_arguments([TITLE, '101', '102'])?.is_ordered).toBe(false)
	})

	it('declares the argument order as the dependency order when asked', () => {
		expect(epic_cli.parse_create_arguments([TITLE, '101', '102', '--ordered'])?.is_ordered).toBe(
			true,
		)
	})

	it('keeps the child order as typed, since it is the dependency order', () => {
		expect(
			epic_cli.parse_create_arguments([TITLE, '103', '101', '102', '--ordered'])?.children,
		).toStrictEqual([103, 101, 102])
	})

	// The flag value is a path, not a child issue, so it must not be swept into the number list.
	it('does not mistake a flag value for a child issue number', () => {
		const parsed = epic_cli.parse_create_arguments([TITLE, '101', '--rationale-file', '102.txt'])

		expect(parsed?.children).toStrictEqual([101])
		expect(parsed?.rationale_path).toBe('102.txt')
	})

	it('reads the origin backlink when supplied', () => {
		const parsed = epic_cli.parse_create_arguments([TITLE, '101', '--origin', ORIGIN_REFERENCE])

		expect(parsed?.origin).toBe(ORIGIN_REFERENCE)
		expect(parsed?.children).toStrictEqual([101])
	})
})

describe('epic_cli.parse_check_argument', () => {
	it('reads the epic issue number', () => {
		expect(epic_cli.parse_check_argument(['700'])).toBe(700)
	})

	it('rejects a missing number', () => {
		expect(epic_cli.parse_check_argument([])).toBeUndefined()
	})

	it('rejects a non-numeric argument', () => {
		expect(epic_cli.parse_check_argument(['seven-hundred'])).toBeUndefined()
	})
})

describe('epic_cli.read_rationale', () => {
	// An omitted rationale is legitimate — the body builder substitutes a visible placeholder — so
	// this must not throw the way a missing file would.
	it('returns an empty rationale when no path was given', () => {
		expect(epic_cli.read_rationale(undefined)).toBe('')
	})
})
