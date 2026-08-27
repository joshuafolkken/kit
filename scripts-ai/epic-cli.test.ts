import { describe, expect, it } from 'vitest'
import { ADD_FLAG, AFTER_FLAG, BEFORE_FLAG, epic_cli, type CrossRepoAddTarget } from './epic-cli'

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

describe('epic_cli.is_addition', () => {
	it('recognizes an insertion', () => {
		expect(epic_cli.is_addition(['--add', '893', '894'])).toBe(true)
	})

	it('does not mistake a promotion or a creation for one', () => {
		expect(epic_cli.is_addition(['--promote', '893', '894'])).toBe(false)
		expect(epic_cli.is_addition([TITLE, '101'])).toBe(false)
	})
})

describe('epic_cli.parse_add_arguments', () => {
	it('reads the epic first and the children after it', () => {
		const parsed = epic_cli.parse_add_arguments(['--add', '893', '894', '895'])

		expect(parsed?.epic_number).toBe(893)
		expect(parsed?.children).toStrictEqual([894, 895])
		expect(parsed?.position).toBeUndefined()
	})

	it('reads a --before target without treating it as a child', () => {
		const parsed = epic_cli.parse_add_arguments(['--add', '893', '894', '--before', '891'])

		expect(parsed?.children).toStrictEqual([894])
		expect(parsed?.position).toStrictEqual({ kind: 'before', target: 891 })
	})

	it('reads an --after target', () => {
		const parsed = epic_cli.parse_add_arguments(['--add', '893', '894', '--after', '890'])

		expect(parsed?.position).toStrictEqual({ kind: 'after', target: 890 })
	})

	it('drops the epic when it is also listed as a child', () => {
		expect(epic_cli.parse_add_arguments(['--add', '893', '893', '894'])?.children).toStrictEqual([
			894,
		])
	})
})

describe('epic_cli.parse_add_arguments — what it refuses', () => {
	it('refuses both --before and --after in one invocation', () => {
		expect(
			epic_cli.parse_add_arguments(['--add', '893', '894', '--before', '891', '--after', '892']),
		).toBeUndefined()
	})

	it('refuses a position target that is not an issue number', () => {
		expect(
			epic_cli.parse_add_arguments(['--add', '893', '894', '--before', 'soon']),
		).toBeUndefined()
	})

	it('refuses an invocation with no child to add', () => {
		expect(epic_cli.parse_add_arguments(['--add', '893'])).toBeUndefined()
	})

	it('refuses an invocation with no epic number', () => {
		expect(epic_cli.parse_add_arguments(['--add'])).toBeUndefined()
	})
})

describe('epic_cli — the positioning flags stay scoped to --add', () => {
	it('does not swallow a creation child after an unknown --after flag', () => {
		const parsed = epic_cli.parse_create_arguments([TITLE, '101', '102', '--after', '103'])

		expect(parsed?.children).toStrictEqual([101, 102, 103])
	})

	it('does not swallow a promotion child after an unknown --before flag', () => {
		const parsed = epic_cli.parse_promote_arguments(['--promote', '893', '101', '--before', '102'])

		expect(parsed?.children).toStrictEqual([101, 102])
	})

	it('refuses a repeated --before, rather than silently taking the first', () => {
		const argv = ['--add', '893', '894', '--before', '891', '--before', '892']

		expect(epic_cli.parse_add_arguments(argv)).toBeUndefined()
	})

	it('refuses a repeated --after', () => {
		const argv = ['--add', '893', '894', '--after', '891', '--after', '892']

		expect(epic_cli.parse_add_arguments(argv)).toBeUndefined()
	})
})

describe('epic_cli.parse_add_arguments — an unknown flag', () => {
	it('refuses a misspelled positioning flag rather than appending to the end', () => {
		const mistyped = BEFORE_FLAG.slice(0, -1)

		expect(epic_cli.parse_add_arguments(['--add', '893', '894', mistyped, '891'])).toBeUndefined()
	})

	it('refuses a flag that means nothing to an insertion', () => {
		expect(epic_cli.parse_add_arguments(['--add', '893', '894', '--ordered'])).toBeUndefined()
	})
})

// joshuafolkken/kit#985: `into owner/repo#N` is a legal thing for a person to type, and this
// command cannot serve it — it reads and writes issues in the repository it runs from. Refused with
// the usage line it reads as "that form does not exist"; what it means is "run it in the other
// checkout", and only naming that keeps the run one command away from continuing.
const CROSS_REPO_REPO = 'joshuafolkken/kit'
const CROSS_REPO_EPIC = 909
const CROSS_REPO_TARGET = `${CROSS_REPO_REPO}#${String(CROSS_REPO_EPIC)}`
const CROSS_REPO_CHILD = '985'
const CROSS_REPO_ARGV: ReadonlyArray<string> = [ADD_FLAG, CROSS_REPO_TARGET, CROSS_REPO_CHILD]

const NO_TARGET_MESSAGE = 'expected a cross-repository target'

function cross_repo_target(argv: ReadonlyArray<string> = CROSS_REPO_ARGV): CrossRepoAddTarget {
	const found = epic_cli.find_cross_repo_add_target(argv)

	if (found === undefined) throw new Error(NO_TARGET_MESSAGE)

	return found
}

function cross_repo_refusal(argv: ReadonlyArray<string>): string {
	return epic_cli.format_cross_repo_refusal(cross_repo_target(argv))
}

describe('epic_cli.find_cross_repo_add_target', () => {
	it('reads a cross-repository epic target', () => {
		expect(epic_cli.find_cross_repo_add_target(CROSS_REPO_ARGV)?.epic).toStrictEqual({
			repo: CROSS_REPO_REPO,
			number: CROSS_REPO_EPIC,
		})
	})

	it.each([
		[[ADD_FLAG, '909', CROSS_REPO_CHILD]],
		[[ADD_FLAG]],
		[[ADD_FLAG, 'not-a-reference', CROSS_REPO_CHILD]],
		// A URL spells the same thing differently, and this refusal is about the shorthand a person
		// types after `into`. Left unmatched it falls through to the usage line, which is the
		// pre-existing behavior rather than a new silent one.
		[[ADD_FLAG, `https://github.com/${CROSS_REPO_REPO}/issues/909`, CROSS_REPO_CHILD]],
		// Wrong in some other way as well. The repository is not the whole problem, so the usage line
		// is the honest answer — a suggestion built from these would drop a mistyped positioning
		// flag's target into the children, the hazard `ADD_KNOWN_FLAGS` exists to prevent.
		[[ADD_FLAG, CROSS_REPO_TARGET, CROSS_REPO_CHILD, BEFORE_FLAG.slice(0, -1), '970']],
		[[ADD_FLAG, CROSS_REPO_TARGET]],
		[[ADD_FLAG, CROSS_REPO_TARGET, CROSS_REPO_CHILD, BEFORE_FLAG, 'not-a-number']],
		[[ADD_FLAG, CROSS_REPO_TARGET, CROSS_REPO_CHILD, BEFORE_FLAG, '10', AFTER_FLAG, '20']],
	])('answers nothing for %j', (argv) => {
		expect(epic_cli.find_cross_repo_add_target(argv)).toBeUndefined()
	})

	it('ignores a cross-repository reference in a later position', () => {
		expect(
			epic_cli.find_cross_repo_add_target([ADD_FLAG, '909', `${CROSS_REPO_REPO}#985`]),
		).toBeUndefined()
	})
})

describe('epic_cli.format_cross_repo_refusal', () => {
	it('names the command to run in the other checkout', () => {
		expect(cross_repo_refusal(CROSS_REPO_ARGV)).toContain('pnpm josh epic --add 909 985')
	})

	// The checkout is the part a run cannot guess, and `josh doctor` is what prints it.
	it('says where to find that checkout', () => {
		expect(cross_repo_refusal(CROSS_REPO_ARGV)).toContain('pnpm josh doctor')
	})

	// Dropping the position silently would lose where the person asked the child to go — the one
	// piece of the instruction that is not recoverable from the epic itself.
	it('carries the positioning flag into the suggestion', () => {
		const argv = [...CROSS_REPO_ARGV, AFTER_FLAG, '970']

		expect(cross_repo_refusal(argv)).toContain('pnpm josh epic --add 909 985 --after 970')
	})

	it('suggests no position when none was given', () => {
		const suggestion = cross_repo_refusal(CROSS_REPO_ARGV)

		expect(suggestion).not.toContain(AFTER_FLAG)
		expect(suggestion).not.toContain(BEFORE_FLAG)
	})
})

// joshuafolkken/kit#985: `into owner/repo#N` is how the suffix is documented, so the qualified form
// naming *this* repository has to work rather than being refused and pointed at the checkout the run
// is already standing in.
describe('epic_cli.resolve_local_add', () => {
	it('resolves a reference to the current repository as an ordinary insertion', () => {
		expect(epic_cli.resolve_local_add(cross_repo_target(), CROSS_REPO_REPO)?.epic_number).toBe(
			CROSS_REPO_EPIC,
		)
	})

	// Refusing costs one command; guessing wrong writes into another repository's epic. An unreadable
	// current repository therefore resolves the same way a different one does.
	it.each([['joshuafolkken/app-kit'], [undefined]])('refuses %j', (current) => {
		expect(epic_cli.resolve_local_add(cross_repo_target(), current)).toBeUndefined()
	})
})
