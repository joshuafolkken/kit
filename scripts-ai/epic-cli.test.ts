import { describe, expect, it } from 'vitest'
import { epic_cli } from './epic-cli'

const PROMOTE = '--promote'
const EPIC = '858'
const CHILD = '101'
const RATIONALE_FILE_FLAG = '--rationale-file'
const ORIGIN_FLAG_NAME = '--origin'
const RATIONALE_PATH = 'reasons.md'

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
		const parsed = epic_cli.parse_create_arguments([TITLE, '101', RATIONALE_FILE_FLAG, '102.txt'])

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

describe('epic_cli.is_promotion', () => {
	it('recognizes the promotion flag', () => {
		expect(epic_cli.is_promotion([PROMOTE, EPIC, CHILD])).toBe(true)
	})

	it('treats an invocation without it as a creation', () => {
		expect(epic_cli.is_promotion(['A title', '101'])).toBe(false)
	})
})

describe('epic_cli.parse_promote_arguments', () => {
	it('takes the epic first and the children after it', () => {
		const parsed = epic_cli.parse_promote_arguments([PROMOTE, EPIC, CHILD, '102'])

		expect(parsed?.epic_number).toBe(858)
		expect(parsed?.children).toEqual([101, 102])
	})

	// Under `--ordered` this would ask GitHub to make the epic block itself.
	it('drops the epic from its own child list', () => {
		const parsed = epic_cli.parse_promote_arguments([PROMOTE, EPIC, EPIC, CHILD])

		expect(parsed?.children).toEqual([101])
	})

	it('refuses a promotion with no children left', () => {
		expect(epic_cli.parse_promote_arguments([PROMOTE, EPIC])).toBeUndefined()
		expect(epic_cli.parse_promote_arguments([PROMOTE, EPIC, EPIC])).toBeUndefined()
	})

	it('refuses a first argument that is not an issue number', () => {
		expect(epic_cli.parse_promote_arguments([PROMOTE, 'A title', CHILD])).toBeUndefined()
	})

	it('accepts the ordering flag with the same meaning as a creation', () => {
		const parsed = epic_cli.parse_promote_arguments([PROMOTE, EPIC, CHILD, '--ordered'])

		expect(parsed?.is_ordered).toBe(true)
	})
})

describe('epic_cli.parse_promote_arguments — the flags', () => {
	it('accepts the rationale and origin flags without reading them as children', () => {
		const parsed = epic_cli.parse_promote_arguments([
			PROMOTE,
			EPIC,
			CHILD,
			RATIONALE_FILE_FLAG,
			RATIONALE_PATH,
			ORIGIN_FLAG_NAME,
			ORIGIN_REFERENCE,
		])

		expect(parsed?.rationale_path).toBe(RATIONALE_PATH)
		expect(parsed?.origin).toBe(ORIGIN_REFERENCE)
		expect(parsed?.children).toEqual([101])
	})
})
