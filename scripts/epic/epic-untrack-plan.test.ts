import { describe, expect, it } from 'vitest'
import { epic_add_fixture, EPIC_FIXTURE_REPO } from './epic-add-fixture'
import { epic_parse, UNORDERED_DEPENDENCIES } from './epic-parse'
import type { EpicReading } from './epic-read'
import { epic_untrack_plan } from './epic-untrack-plan'
import { epic_validate } from './epic-validate'

const { body_of, child } = epic_add_fixture
const EPIC = 900
const CHILDREN = [101, 102, 103, 104, 105]
const CHAIN = '#101 -> #102 -> #103 -> #104 -> #105'
const CHECKED_FIRST = '- [x] #101'

function reading(body: string = body_of([CHAIN], CHILDREN)): EpicReading {
	return {
		subject: { number: EPIC, labels: ['epic'], body },
		repo: EPIC_FIXTURE_REPO,
		recorded: [
			child(101),
			child(102, [101]),
			child(103, [102]),
			child(104, [103]),
			child(105, [104]),
		],
	}
}

function plan(
	source: EpicReading,
	children: ReadonlyArray<number>,
): { body: string; removed: ReadonlyArray<{ blocker: number; blocked: number }> } {
	const result = epic_untrack_plan.build_plan(source, children)
	if ('error' in result) throw new Error(result.error)

	return result.plan
}

describe('epic child removal plans', () => {
	it('removes rows and connected orders without reconnecting retained children (ac-127d6f5c)', () => {
		const result = plan(reading(), [102, 104])

		expect(epic_parse.parse_task_list_issue_numbers(result.body)).toStrictEqual([101, 103, 105])
		expect(epic_parse.parse_dependency_links(result.body)).toStrictEqual([])
		expect(result.removed).toHaveLength(4)
		expect(result.body).toContain(UNORDERED_DEPENDENCIES)
		const checked = epic_validate.validate_epic({ ...reading().subject, body: result.body })

		expect(epic_validate.is_epic_valid(checked)).toBe(true)
	})
})

describe('epic child removal preserves unrelated text', () => {
	it('retains unrelated orders and drops undeclared native connections too', () => {
		const source = reading(body_of(['#103 -> #104 -> #105'], CHILDREN))
		const result = plan(source, [102])

		expect(epic_parse.parse_dependency_chains(result.body)).toStrictEqual([[103, 104, 105]])
		expect(result.removed).toStrictEqual([
			{ blocker: 101, blocked: 102 },
			{ blocker: 102, blocked: 103 },
		])
	})

	it('preserves prose, fenced examples, checked rows and duplicate row removal', () => {
		const suffix = '\n## Notes\nWhy #102 moved.\n```md\n- [ ] #102\n```\n'
		const source = reading(
			body_of([UNORDERED_DEPENDENCIES], CHILDREN)
				.replace('- [ ] #101', () => CHECKED_FIRST)
				.replace('- [ ] #102', '- [x] #102\n- [ ] #102') + suffix,
		)
		const result = plan(source, [102])

		expect(result.body).toContain(CHECKED_FIRST)
		expect(result.body).toContain(suffix)
		expect(epic_parse.parse_task_list_issue_numbers(result.body)).not.toContain(102)
	})
})

describe('epic child removal validation', () => {
	it('preserves an initial absent child body with a list declaration (ac-40c52b68)', () => {
		const source = reading(body_of([`- ${UNORDERED_DEPENDENCIES}`], [101, 103]))

		expect(plan(source, [102]).body).toBe(source.subject.body)
	})

	it('repeating an absent child leaves the body identical', () => {
		const first = plan(reading(), [102])
		const second = plan(
			{
				...reading(first.body),
				recorded: [child(101), child(103), child(104, [103]), child(105, [104])],
			},
			[102],
		)

		expect(second).toStrictEqual({ body: first.body, removed: [] })
	})

	it('refuses removing every child, malformed declarations and non-epics', () => {
		expect(epic_untrack_plan.build_plan(reading(), CHILDREN)).toHaveProperty('error')
		const malformed = reading(body_of(['Unknown'], CHILDREN))

		expect(epic_untrack_plan.build_plan(malformed, [102])).toHaveProperty('error')
		const source = reading()

		expect(
			epic_untrack_plan.build_plan(
				{ ...source, subject: { ...source.subject, labels: [] } },
				[102],
			),
		).toHaveProperty('error')
	})
})
