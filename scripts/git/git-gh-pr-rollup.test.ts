import { describe, expect, it } from 'vitest'
import { check_runs_pages, status_pages } from './git-gh-pr-fixture'
import {
	git_gh_pr_rollup,
	NOT_A_CHECK_RUNS_LISTING,
	NOT_A_STATUS_LISTING,
	STATUS_CONTEXT_TYPE_NAME,
} from './git-gh-pr-rollup'
import { parse_rollup_checks } from './git-pr-checks-parse'

// `gh` merged check runs and status contexts into one `statusCheckRollup`; REST serves them from two
// endpoints with two different element shapes. These assertions are about the merge — and above all
// about the marker the parser tells the two apart by (joshuafolkken/kit#1028).

const SONAR_QUBE = 'SonarQube'
const CODE_RABBIT = 'CodeRabbit'
const E2E = 'E2E'

const PASSING_RUN = { name: SONAR_QUBE, status: 'completed', conclusion: 'success' }
const PASSING_CONTEXT = { context: CODE_RABBIT, state: 'success' }

function merge(check_runs_json: string, status_json: string): Array<Record<string, unknown>> {
	return git_gh_pr_rollup.to_status_check_rollup({ check_runs_json, status_json })
}

function as_snapshot_json(items: ReadonlyArray<object>): string {
	return JSON.stringify({ statusCheckRollup: items })
}

// Read through a variable key: every element is a pass-through bag, so a literal member access is
// rejected as coming from an index signature.
function field(item: Record<string, unknown> | undefined, key: string): unknown {
	return item?.[key]
}

describe('to_status_check_rollup', () => {
	it('merges both endpoints into one array', () => {
		const merged = merge(check_runs_pages([PASSING_RUN]), status_pages([PASSING_CONTEXT]))

		expect(merged).toHaveLength(2)
	})

	it('answers an empty rollup when neither endpoint reported anything', () => {
		expect(merge(check_runs_pages([]), status_pages([]))).toStrictEqual([])
	})

	// The check runs first, then the status contexts — the order `gh` answered in.
	it('puts the check runs before the status contexts', () => {
		const merged = merge(check_runs_pages([PASSING_RUN]), status_pages([PASSING_CONTEXT]))

		expect(field(merged[0], 'name')).toBe(SONAR_QUBE)
		expect(field(merged[1], 'context')).toBe(CODE_RABBIT)
	})
})

// Without the marker `parse_rollup_status` takes the default branch, finds no `status`, and reports
// every status context as `pending` — a merge gate that never opens rather than one that opens
// wrongly, but wrong either way.
describe('to_status_check_rollup — the __typename marker', () => {
	it('marks every status context as a StatusContext', () => {
		const merged = merge(check_runs_pages([]), status_pages([PASSING_CONTEXT]))

		expect(field(merged[0], '__typename')).toBe(STATUS_CONTEXT_TYPE_NAME)
	})

	// The parser's default branch *is* the check run, so a marker here would be wrong rather than
	// merely redundant.
	it('leaves check runs unmarked', () => {
		const merged = merge(check_runs_pages([PASSING_RUN]), status_pages([]))

		expect(merged[0]).not.toHaveProperty('__typename')
	})

	// The end the marker exists for: the parser has to read a passing status context as `pass`.
	it('lets the parser read a passing status context as pass', () => {
		const merged = merge(check_runs_pages([]), status_pages([PASSING_CONTEXT]))

		expect(parse_rollup_checks(as_snapshot_json(merged))).toStrictEqual([
			{ name: CODE_RABBIT, status: 'pass' },
		])
	})

	it('reads a failing status context as fail rather than pending', () => {
		const merged = merge(check_runs_pages([]), status_pages([{ context: E2E, state: 'failure' }]))

		expect(parse_rollup_checks(as_snapshot_json(merged))).toStrictEqual([
			{ name: E2E, status: 'fail' },
		])
	})

	// REST spells the values in lower case where `gh` sent them upper-cased. The parser lower-cases
	// before comparing, so both arrive at the same verdict — pinned because nothing else would notice
	// if that stopped being true.
	it('reads a lower-case check run conclusion as pass', () => {
		const merged = merge(check_runs_pages([PASSING_RUN]), status_pages([]))

		expect(parse_rollup_checks(as_snapshot_json(merged))).toStrictEqual([
			{ name: SONAR_QUBE, status: 'pass' },
		])
	})
})

// A repository with more checks than one page holds is the case this exists for: without the
// concatenation the merge gate would judge a pull request on whichever checks happened to fit.
describe('to_status_check_rollup — paging', () => {
	it('concatenates the check runs across pages', () => {
		const merged = merge(
			check_runs_pages([PASSING_RUN], [{ name: E2E, status: 'in_progress' }]),
			status_pages([]),
		)

		expect(merged.map((item) => field(item, 'name'))).toStrictEqual([SONAR_QUBE, E2E])
	})

	it('concatenates the status contexts across pages', () => {
		const merged = merge(
			check_runs_pages([]),
			status_pages([PASSING_CONTEXT], [{ context: E2E, state: 'pending' }]),
		)

		expect(merged.map((item) => field(item, 'context'))).toStrictEqual([CODE_RABBIT, E2E])
	})

	// A page object that names no listing is rejected rather than read as an empty one: GitHub always
	// sends the key, and answering `[]` would reach `git-pr-followup.ts` as "this branch has no
	// checks".
	it('rejects a page carrying no listing at all', () => {
		expect(() => merge(JSON.stringify([{}]), status_pages([]))).toThrow()
	})
})

// An unreadable answer must not arrive as an empty rollup: that reads as "this pull request has no
// checks", which `git-pr-followup.ts` acts on rather than treats as a failure (joshuafolkken/kit#973).
describe('to_status_check_rollup — an unreadable listing throws', () => {
	it('throws when the check run response is not a listing of pages', () => {
		expect(() => merge('{"message":"API rate limit exceeded"}', status_pages([]))).toThrow(
			NOT_A_CHECK_RUNS_LISTING,
		)
	})

	it('throws when the status response is not a listing of pages', () => {
		expect(() => merge(check_runs_pages([]), 'not json')).toThrow(NOT_A_STATUS_LISTING)
	})
})
