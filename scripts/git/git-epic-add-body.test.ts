import { describe, expect, it } from 'vitest'
import { git_epic_add_body, type RewriteInput, type RewriteOutcome } from './git-epic-add-body'
import { git_epic_parse } from './git-epic-parse'

const DEPENDENCIES_HEADING = '## Dependencies'
const PROGRESS_HEADING = '## Progress'
const DECISIONS_HEADING = '## Decisions'
const STRAY_DECLARATION_MESSAGE = 'outside the `Dependencies` section'
const MISSING_ROW_MESSAGE = 'would not track #894'
const SECOND_CHAIN = '#101 -> #102'
const BLANK = ''
const ORDERED_CHAIN = '#890 -> #891 -> #892'
const UNORDERED_LITERAL = 'None — the children are independent; any execution order works.'

const ROW_890 = '- [ ] #890'
const ROW_891 = '- [ ] #891'
const ROW_892 = '- [ ] #892'
const ROW_101 = '- [ ] #101'

const ORDERED_BODY = [
	DEPENDENCIES_HEADING,
	BLANK,
	ORDERED_CHAIN,
	BLANK,
	PROGRESS_HEADING,
	BLANK,
	ROW_890,
	ROW_891,
	ROW_892,
	BLANK,
].join('\n')

const UNORDERED_BODY = [
	DEPENDENCIES_HEADING,
	BLANK,
	UNORDERED_LITERAL,
	BLANK,
	PROGRESS_HEADING,
	BLANK,
	ROW_101,
	'- [ ] #102',
	BLANK,
].join('\n')

const APPENDED_CHAINS = [[890, 891, 892, 894]]

function rewrite(overrides: Partial<RewriteInput>): RewriteOutcome {
	return git_epic_add_body.rewrite_body({
		body: ORDERED_BODY,
		placed: [894],
		chains_after: APPENDED_CHAINS,
		...overrides,
	})
}

function body_of(outcome: RewriteOutcome): string {
	if ('error' in outcome) throw new Error(outcome.error)

	return outcome.body
}

function error_of(outcome: RewriteOutcome): string {
	if ('body' in outcome) throw new Error('expected a refusal')

	return outcome.error
}

// A body carrying a declaration-shaped line outside the `Dependencies` section, which the rewrite
// refuses rather than editing.
function stray_error(stray_line: string): string {
	const body = [
		DEPENDENCIES_HEADING,
		BLANK,
		ORDERED_CHAIN,
		BLANK,
		'## Notes',
		BLANK,
		stray_line,
		BLANK,
		PROGRESS_HEADING,
		BLANK,
		ROW_890,
		ROW_891,
		ROW_892,
	].join('\n')

	return error_of(rewrite({ body, chains_after: [...APPENDED_CHAINS, [101, 102]] }))
}

describe('git_epic_add_body.rewrite_body — the task list', () => {
	it('adds the new row directly after the last existing one', () => {
		const body = body_of(rewrite({}))

		expect(body).toContain('- [ ] #892\n- [ ] #894')
	})

	it('leaves every existing child tracked', () => {
		const tracked = git_epic_parse.parse_task_list_issue_numbers(body_of(rewrite({})))

		expect(tracked).toStrictEqual([890, 891, 892, 894])
	})

	it('keeps the trailing content of the body after the inserted row', () => {
		const body = body_of(rewrite({ body: `${ORDERED_BODY}\n## Notes\n\nkeep me\n` }))

		expect(body).toContain('## Notes')
		expect(body).toContain('keep me')
	})
})

describe('git_epic_add_body.rewrite_body — the declaration', () => {
	it('rewrites the arrow chain to the inserted order', () => {
		const body = body_of(rewrite({ chains_after: [[890, 894, 891, 892]] }))

		expect(body).toContain('#890 -> #894 -> #891 -> #892')
	})

	it('leaves no trace of the superseded chain', () => {
		const body = body_of(rewrite({ chains_after: [[890, 894, 891, 892]] }))

		expect(body).not.toContain(ORDERED_CHAIN)
	})

	it('leaves an unordered declaration untouched when no order was computed', () => {
		const body = body_of(
			rewrite({
				body: UNORDERED_BODY,
				placed: [103],
				chains_after: [],
			}),
		)

		expect(git_epic_parse.has_unordered_declaration(body)).toBe(true)
		expect(git_epic_parse.parse_task_list_issue_numbers(body)).toStrictEqual([101, 102, 103])
	})

	it('replaces the unordered literal when a position starts a chain', () => {
		const body = body_of(
			rewrite({
				body: UNORDERED_BODY,
				placed: [103],
				chains_after: [[103, 102]],
			}),
		)

		expect(body).toContain('#103 -> #102')
		expect(git_epic_parse.has_unordered_declaration(body)).toBe(false)
	})
})

describe('git_epic_add_body.rewrite_body — what it leaves alone', () => {
	it('never edits a declaration inside a fenced block', () => {
		const fenced = ['```md', '#1 -> #2', '```', BLANK, ORDERED_BODY].join('\n')

		expect(body_of(rewrite({ body: fenced }))).toContain('```md\n#1 -> #2\n```')
	})

	it('never rewrites a chain quoted in prose outside the Dependencies section', () => {
		const with_prose = [
			DEPENDENCIES_HEADING,
			BLANK,
			ORDERED_CHAIN,
			BLANK,
			'## Split rationale',
			BLANK,
			'#890 -> #891',
			BLANK,
			PROGRESS_HEADING,
			BLANK,
			ROW_890,
			ROW_891,
			ROW_892,
		].join('\n')
		const outcome = rewrite({
			body: with_prose,
			chains_after: [...APPENDED_CHAINS, [890, 891]],
		})

		expect(error_of(outcome)).toContain(STRAY_DECLARATION_MESSAGE)
	})
})

describe('git_epic_add_body.rewrite_body — several declaration lines', () => {
	it('replaces every declaration line inside the Dependencies section', () => {
		const two_chains = [
			DEPENDENCIES_HEADING,
			BLANK,
			ORDERED_CHAIN,
			SECOND_CHAIN,
			BLANK,
			PROGRESS_HEADING,
			BLANK,
			ROW_890,
			ROW_891,
			ROW_892,
		].join('\n')
		const body = body_of(
			rewrite({
				body: two_chains,
				chains_after: [...APPENDED_CHAINS, [101, 102]],
			}),
		)

		expect(git_epic_parse.parse_dependency_chains(body)).toStrictEqual([
			[890, 891, 892, 894],
			[101, 102],
		])
	})
})

describe('git_epic_add_body.rewrite_body — what it refuses to write', () => {
	it('refuses a body with no task-list row to add to', () => {
		const outcome = rewrite({
			body: `${DEPENDENCIES_HEADING}\n\n#1 -> #2\n`,
			chains_after: [[1, 2, 894]],
		})

		expect(error_of(outcome)).toContain(MISSING_ROW_MESSAGE)
	})

	it('refuses a body whose declaration cannot be found at all', () => {
		const outcome = rewrite({
			body: `${PROGRESS_HEADING}\n\n${ROW_101}\n`,
			placed: [102],
			chains_after: [],
		})

		expect(error_of(outcome)).toContain(
			'no unambiguous machine-readable `Dependencies` declaration',
		)
	})
})

describe('git_epic_add_body.rewrite_body — locating the section', () => {
	it('refuses a body with no Dependencies heading to rewrite', () => {
		const headless = [ORDERED_CHAIN, BLANK, PROGRESS_HEADING, BLANK, ROW_890].join('\n')
		const outcome = rewrite({ body: headless })

		expect(error_of(outcome)).toContain('Could not locate the `Dependencies` section')
	})

	it('needs no Dependencies heading when the batch stays unordered', () => {
		const headless = [UNORDERED_LITERAL, BLANK, PROGRESS_HEADING, BLANK, ROW_101].join('\n')
		const body = body_of(rewrite({ body: headless, placed: [103], chains_after: [] }))

		expect(git_epic_parse.parse_task_list_issue_numbers(body)).toStrictEqual([101, 103])
	})
})

// joshuafolkken/kit#1350: the decision record is folded into the body edit the insertion already
// makes, so it costs no round trip — and it goes in *before* the declaration work, which is what puts
// it under the same guards.
describe('git_epic_add_body.rewrite_body — the decision record', () => {
	const REASON_LINE = '- 理由: 主題が同じ'
	const RECORD = ['### Where #894 goes', BLANK, REASON_LINE].join('\n')
	const CHAIN_RECORD = ['### note', '#890 -> #894'].join('\n')

	it('writes the record and the declaration in one body', () => {
		const body = body_of(rewrite({ decision: RECORD }))

		expect(body).toContain(DECISIONS_HEADING)
		expect(body).toContain(REASON_LINE)
		expect(git_epic_parse.parse_dependency_chains(body)).toStrictEqual([[890, 891, 892, 894]])
	})

	it('still tracks the new child', () => {
		const body = body_of(rewrite({ decision: RECORD }))

		expect(git_epic_parse.parse_task_list_issue_numbers(body)).toStrictEqual([890, 891, 892, 894])
	})

	// The record reaches the stray-declaration guard because it is folded in first. Appended after the
	// rewrite it would be written unchecked, and `epic:next` would read the line as part of the order.
	it('refuses a record whose line is nothing but a chain', () => {
		const outcome = rewrite({ decision: CHAIN_RECORD })

		expect(error_of(outcome)).toContain(STRAY_DECLARATION_MESSAGE)
	})

	it('leaves the body exactly as it was when no record is given', () => {
		expect(body_of(rewrite({}))).toBe(body_of(rewrite({ decision: undefined })))
	})
})

// joshuafolkken/kit#1350: `find_section_range` now ends a section at the next heading of the same or a
// higher level, so a declaration beneath a `###` subheading inside `## Dependencies` is part of that
// section rather than a stray line outside it. Pinned because the rewrite's refusal depends on it.
describe('git_epic_add_body.rewrite_body — a subheading inside Dependencies', () => {
	const SUBHEADING = '### the declared order'
	const WITH_SUBHEADING = [
		DEPENDENCIES_HEADING,
		BLANK,
		SUBHEADING,
		ORDERED_CHAIN,
		BLANK,
		PROGRESS_HEADING,
		BLANK,
		ROW_890,
		ROW_891,
		ROW_892,
	].join('\n')

	it('rewrites the declaration rather than refusing it as stray', () => {
		const body = body_of(rewrite({ body: WITH_SUBHEADING }))

		expect(git_epic_parse.parse_dependency_chains(body)).toStrictEqual([[890, 891, 892, 894]])
		expect(body).toContain(SUBHEADING)
	})
})

// joshuafolkken/kit#1350: the refusal names the declaration it found, re-rendered from the numbers it
// parsed to rather than echoed back — the body is fetched from GitHub and may carry a caller's record
// file, so a raw line would put content this code never read into the console.
describe('git_epic_add_body.rewrite_body — the stray-declaration message', () => {
	it('names the chain as the parser read it, not as it was written', () => {
		const error = stray_error('-   #101   ->   #102')

		expect(error).toContain(SECOND_CHAIN)
		expect(error).toContain(STRAY_DECLARATION_MESSAGE)
	})

	it('names the unordered sentence for the branch that parses to no chain', () => {
		expect(stray_error(UNORDERED_LITERAL)).toContain(UNORDERED_LITERAL)
	})
})

// joshuafolkken/kit#1704: a positioned addition's row goes to the position rather than to the end of
// the list, so the task list and the declaration state one order. The round trip covers the added row
// too — before, only a moved row was checked, and an appended one passed every check while
// `epic:next` presented an order the epic did not declare.
describe('git_epic_add_body.rewrite_body — a positioned addition', () => {
	const BEFORE_891 = { kind: 'before', target: 891 } as const

	it('puts the added row at the position rather than at the end', () => {
		const body = body_of(rewrite({ position: BEFORE_891, chains_after: [[890, 894, 891, 892]] }))

		expect(git_epic_parse.parse_task_list_issue_numbers(body)).toStrictEqual([890, 894, 891, 892])
	})

	it('refuses when the position names a target the task list never tracks', () => {
		const outcome = rewrite({
			position: { kind: 'before', target: 999 },
			chains_after: [
				[890, 891, 892],
				[894, 999],
			],
		})

		expect(error_of(outcome)).toContain(MISSING_ROW_MESSAGE)
	})
})
