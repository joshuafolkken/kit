import { describe, expect, it } from 'vitest'
import { EPIC_FIXTURE_REPO, git_epic_add_fixture } from './git-epic-add-fixture'
import { git_epic_add_plan, type PlanInput, type PlanOutcome } from './git-epic-add-plan'
import { git_epic_parse, UNORDERED_DEPENDENCIES } from './git-epic-parse'

const { child, plan_of } = git_epic_add_fixture

// joshuafolkken/kit#1253: `josh epic --add <E> <N>` with no position appended `#N` to the last
// declared chain, so an unrelated child came out blocked by whatever issue sat at that chain's tail.
// The epic it happened on twice mixes ordered and unordered children — five chains, most children in
// none of them — which joshuafolkken/kit#949 established as a legitimate state, so this is the normal
// shape rather than an edge case. These cases are the mixed epic, since the module-level cases in
// `git-epic-chains.test.ts` cannot show the relations the command would have recorded.

const REPO = EPIC_FIXTURE_REPO
const EPIC_NUMBER = 1153
const ADDED = 1251
const UNORDERED_TARGET = 1230
const FIRST_CHAIN = '#1173 -> #1228'
const SECOND_CHAIN = '#1242 -> #1246'
const DEPENDENCIES_HEADING = '## Dependencies'
const PROGRESS_HEADING = '## Progress'
const ROW_1173 = '- [ ] #1173'
const ROW_1228 = '- [ ] #1228'
const BLANK = ''
const FIRST_RATIONALE = 'Rationale: #1228 needs the measurement from #1173.'
const SECOND_RATIONALE = 'Rationale: #1246 reads what #1242 writes.'

// Two declared chains — each documented by the rationale line under it, as the issue template
// prescribes — and #1230 tracked by the epic but named in neither.
const DECLARATION_BLOCK = [FIRST_CHAIN, FIRST_RATIONALE, SECOND_CHAIN, SECOND_RATIONALE].join('\n')

const MIXED_BODY = [
	DEPENDENCIES_HEADING,
	BLANK,
	DECLARATION_BLOCK,
	BLANK,
	PROGRESS_HEADING,
	BLANK,
	ROW_1173,
	ROW_1228,
	'- [ ] #1242',
	'- [ ] #1246',
	`- [ ] #${String(UNORDERED_TARGET)}`,
	BLANK,
].join('\n')

const NO_CHAIN_BODY = [
	DEPENDENCIES_HEADING,
	BLANK,
	UNORDERED_DEPENDENCIES,
	BLANK,
	PROGRESS_HEADING,
	BLANK,
	ROW_1173,
	ROW_1228,
	BLANK,
].join('\n')

// The relations the mixed epic actually carries, so nothing is left for the repair path to record.
const MIXED_CHILDREN = [
	child(1173),
	child(1228, [1173]),
	child(1242),
	child(1246, [1242]),
	child(UNORDERED_TARGET),
]

function plan(overrides: Partial<PlanInput>): PlanOutcome {
	return git_epic_add_plan.build_plan({
		epic_number: EPIC_NUMBER,
		repo: REPO,
		body: MIXED_BODY,
		labels: ['epic'],
		children: [ADDED],
		recorded: MIXED_CHILDREN,
		...overrides,
	})
}

describe('josh epic --add — no position, into an epic that declares chains', () => {
	it('records no blocked-by relation', () => {
		const added = plan_of(plan({}))

		expect(added.added).toStrictEqual([])
		expect(added.removed).toStrictEqual([])
	})

	it('leaves the declared chains exactly as they were', () => {
		const before = git_epic_parse.parse_dependency_chains(MIXED_BODY)
		const after = git_epic_parse.parse_dependency_chains(plan_of(plan({})).body)

		expect(after).toStrictEqual(before)
	})

	it('does not extend the last chain with the new child', () => {
		const { body } = plan_of(plan({}))

		expect(body).toContain(FIRST_CHAIN)
		expect(body).toContain(SECOND_CHAIN)
		expect(body).not.toContain(`${SECOND_CHAIN} -> #${String(ADDED)}`)
	})

	// The section is left as text, so each rationale line stays under the chain it documents. Written
	// out again, the chains would be collected at the first one's index and the rationale lines pushed
	// below both of them.
	it('leaves the declaration section byte-identical', () => {
		expect(plan_of(plan({})).body).toContain(DECLARATION_BLOCK)
	})

	it('still tracks the new child in the task list', () => {
		const tracked = git_epic_parse.parse_task_list_issue_numbers(plan_of(plan({})).body)

		expect(tracked).toContain(ADDED)
	})
})

describe('josh epic --add — a position still declares an order', () => {
	it('extends the chain the target sits in', () => {
		const positioned = plan_of(plan({ position: { kind: 'after', target: 1228 } }))

		expect(positioned.body).toContain(`${FIRST_CHAIN} -> #${String(ADDED)}`)
		expect(positioned.added).toStrictEqual([{ blocker: 1228, blocked: ADDED }])
	})

	it('declares a new chain for a target no chain names', () => {
		const positioned = plan_of(plan({ position: { kind: 'before', target: UNORDERED_TARGET } }))

		expect(positioned.body).toContain(`#${String(ADDED)} -> #${String(UNORDERED_TARGET)}`)
		expect(positioned.added).toStrictEqual([{ blocker: ADDED, blocked: UNORDERED_TARGET }])
	})
})

describe('josh epic --add — no position, into an epic that declares no chain', () => {
	it('stays unordered and records nothing', () => {
		const added = plan_of(plan({ body: NO_CHAIN_BODY, recorded: [child(1173), child(1228)] }))

		expect(git_epic_parse.has_unordered_declaration(added.body)).toBe(true)
		expect(added.added).toStrictEqual([])
		expect(added.removed).toStrictEqual([])
	})
})
