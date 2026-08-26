import { describe, expect, it } from 'vitest'
import { git_epic_add_body, type RewriteInput, type RewriteOutcome } from './git-epic-add-body'
import { git_epic_parse } from './git-epic-parse'

const DEPENDENCIES_HEADING = '## Dependencies'
const PROGRESS_HEADING = '## Progress'
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
		additions: [894],
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
				additions: [103],
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
				additions: [103],
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

		expect(error_of(outcome)).toContain('outside the `Dependencies` section')
	})
})

describe('git_epic_add_body.rewrite_body — several declaration lines', () => {
	it('replaces every declaration line inside the Dependencies section', () => {
		const two_chains = [
			DEPENDENCIES_HEADING,
			BLANK,
			ORDERED_CHAIN,
			'#101 -> #102',
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

		expect(error_of(outcome)).toContain('would not track #894')
	})

	it('refuses a body whose declaration cannot be found at all', () => {
		const outcome = rewrite({
			body: `${PROGRESS_HEADING}\n\n${ROW_101}\n`,
			additions: [102],
			chains_after: [],
		})

		expect(error_of(outcome)).toContain('no machine-readable `Dependencies` declaration')
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
		const body = body_of(rewrite({ body: headless, additions: [103], chains_after: [] }))

		expect(git_epic_parse.parse_task_list_issue_numbers(body)).toStrictEqual([101, 103])
	})
})
