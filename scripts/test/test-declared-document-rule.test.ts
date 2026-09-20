import { read_repo_file } from '#scripts/document/ai-document-fixture'
import { describe, expect, it } from 'vitest'
import { test_declared_logic } from './test-declared-logic'

// joshuafolkken/kit#2118: the exempt enumeration `pnpm josh test:declared` uses is documented in
// `CLAUDE.md` as the mechanically-exempt paths, and the two can drift independently — the command can
// stop being named, and the list can diverge from the constants. A reader following a stale list would
// declare a change exempt that the command still refuses, so the list in the prose has to be *the same
// list* the code uses, the same guard `review-level-document-rule.test.ts` puts on the inert set.

const CLAUDE = 'CLAUDE.md'
const COMMAND = 'pnpm josh test:declared'
// The bounded region: the code-spans between this marker's parenthesis and its close. Taking the whole
// line would sweep up `*.test.ts`, the command and the pointer that sit beside it.
const MARKER = 'mechanically exempt ('
const CODE_SPAN = /`([^`]+)`/gu

function listed_exempt_paths(): Array<string> {
	const content = read_repo_file(CLAUDE)
	const open = content.indexOf(MARKER) + MARKER.length - 1
	const scope = content.slice(open + 1, content.indexOf(')', open))
	const listed: Array<string> = []

	for (const match of scope.matchAll(CODE_SPAN)) {
		if (match[1] !== undefined) listed.push(match[1])
	}

	return listed.toSorted((left, right) => left.localeCompare(right))
}

function code_exempt_paths(): Array<string> {
	return [
		...test_declared_logic.EXEMPT_PATHS,
		...test_declared_logic.EXEMPT_PREFIXES.map((prefix) => `${prefix}**`),
		...test_declared_logic.EXEMPT_SUFFIXES.map((suffix) => `*${suffix}`),
	].toSorted((left, right) => left.localeCompare(right))
}

describe('the test-declared rule is routed to the command in CLAUDE.md', () => {
	it('names the command', () => {
		expect(read_repo_file(CLAUDE)).toContain(COMMAND)
	})

	it('says a runtime change with no test is refused on required', () => {
		expect(read_repo_file(CLAUDE)).toContain('refused at `pnpm josh git -y` on `required`')
	})
})

describe('the documented exempt set is the one the command uses', () => {
	it('states an exempt list at all', () => {
		expect(listed_exempt_paths().length).toBeGreaterThan(0)
	})

	it('lists exactly what the command treats as exempt', () => {
		expect(listed_exempt_paths()).toStrictEqual(code_exempt_paths())
	})
})
