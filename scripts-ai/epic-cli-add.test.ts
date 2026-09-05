import { describe, expect, it } from 'vitest'
import {
	ADD_FLAG,
	AFTER_FLAG,
	BEFORE_FLAG,
	DECISION_FLAG,
	epic_cli,
	type CrossRepoAddTarget,
} from './epic-cli'

// The `--add` insertion's own argument rules: the cross-repository target it refuses with a command to
// retype (joshuafolkken/kit#985) and the decision record it carries (joshuafolkken/kit#1350). Split out
// of `epic-cli.test.ts` when that file reached the 300-line ceiling; the create/promote/positioning
// rules stay there.
// joshuafolkken/kit#985: `into owner/repo#N` is a legal thing for a person to type, and this
// command cannot serve it — it reads and writes issues in the repository it runs from. Refused with
// the usage line it reads as "that form does not exist"; what it means is "run it in the other
// checkout", and only naming that keeps the run one command away from continuing.
const CROSS_REPO_REPO = 'joshuafolkken/kit'
const OTHER_REPO = 'joshuafolkken/app-kit'
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
	it.each([[OTHER_REPO], [undefined]])('refuses %j', (current) => {
		expect(epic_cli.resolve_local_add(cross_repo_target(), current)).toBeUndefined()
	})
})

// joshuafolkken/kit#1350: `--decision-file` is the one text an insertion carries. Its value must not
// be read as a child issue number, and the flag must not fall through the unknown-flag refusal.
describe('epic_cli.parse_add_arguments — the decision file', () => {
	const DECISION_PATH = 'decision.md'

	it('reads the path and leaves the children alone', () => {
		const parsed = epic_cli.parse_add_arguments([
			ADD_FLAG,
			'893',
			'894',
			DECISION_FLAG,
			DECISION_PATH,
		])

		expect(parsed?.decision_path).toBe(DECISION_PATH)
		expect(parsed?.children).toStrictEqual([894])
	})

	// A path that happens to be a bare number would otherwise become an extra child, which is the
	// hazard `ADD_VALUE_FLAGS` exists to close.
	it('does not read a numeric path as a child', () => {
		const parsed = epic_cli.parse_add_arguments([ADD_FLAG, '893', '894', DECISION_FLAG, '42'])

		expect(parsed?.children).toStrictEqual([894])
		expect(parsed?.decision_path).toBe('42')
	})

	it('leaves the path undefined when the flag is absent', () => {
		expect(epic_cli.parse_add_arguments([ADD_FLAG, '893', '894'])?.decision_path).toBeUndefined()
	})

	it('reads no decision for an absent path', () => {
		expect(epic_cli.read_decision(undefined)).toBeUndefined()
	})
})

// joshuafolkken/kit#1350: the flag is passed precisely because the record has to exist, so a value the
// shell ate must refuse rather than read as "none was asked for" — otherwise the insertion lands, no
// record is written anywhere, and the command exits 0.
describe('epic_cli.parse_add_arguments — a decision file with no usable path', () => {
	it.each([
		[[ADD_FLAG, '893', '894', DECISION_FLAG]],
		[[ADD_FLAG, '893', '894', DECISION_FLAG, AFTER_FLAG, '891']],
		[[ADD_FLAG, '893', '894', DECISION_FLAG, 'a.md', DECISION_FLAG, 'b.md']],
	])('refuses the invocation %j', (argv) => {
		expect(epic_cli.parse_add_arguments(argv)).toBeUndefined()
	})
})

describe('epic_cli.format_cross_repo_refusal — the decision file', () => {
	it('names the flag instead of relaying a path the other checkout cannot read', () => {
		const refusal = cross_repo_refusal([...CROSS_REPO_ARGV, DECISION_FLAG, 'why.md'])

		expect(refusal).not.toContain('why.md')
		expect(refusal).toContain('The decision record is not carried over')
	})

	it('says nothing about the record when none was given', () => {
		expect(cross_repo_refusal(CROSS_REPO_ARGV)).not.toContain('decision record')
	})
})
