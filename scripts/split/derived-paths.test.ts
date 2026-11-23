import { command_reference_line_budget } from '#scripts/document/command-reference-line-budget'
import { command_usage } from '#scripts/josh/command-usage'
import { lane_plan_size, type Oversize, type PlanSignals } from '#scripts/lane/lane-plan-size'
import { describe, expect, it } from 'vitest'
import { derived_paths, type ReadText } from './derived-paths'

const { COMMAND_CATALOG_DOC } = command_reference_line_budget
const BACKLOG_PAGE = 'docs/josh-commands-backlog.md'
const DEFINITION = 'scripts/josh/josh-commands-fake.ts'
const EPIC_DEFINITION = 'scripts/josh/josh-commands-epic.ts'
const PLANNED_AT = '2026-11-23T00:00:00.000Z'
const DECLARED = '## 背景\n\n- 規模見積もり: 約 4 ファイル / 70 行（テスト含む）\n'
const QUIET: PlanSignals = {
	hunk_files: [],
	committed_files: [],
	lines_ratio: undefined,
	implement_rate: undefined,
	split_filed: false,
}

function reader(files: Record<string, string>): ReadText {
	return (path) => files[path]
}

describe('derived_paths.of', () => {
	// #8798 planned `josh-commands-epic.ts` and found `docs/josh-commands-backlog.md` only after review.
	it('derives the backlog reference page and the catalog from the epic command definitions', () => {
		const derived = derived_paths.of([EPIC_DEFINITION])

		expect(derived).toStrictEqual([BACKLOG_PAGE, COMMAND_CATALOG_DOC])
	})

	it('derives no reference page from a file whose commands no page renders', () => {
		const files = { [DEFINITION]: "const X = {\n\t'no:usage': {\n\t\tscript: 'x.ts',\n\t},\n}" }

		expect(derived_paths.of([DEFINITION], reader(files))).toStrictEqual([COMMAND_CATALOG_DOC])
	})

	it('does not repeat a derived page the plan already names', () => {
		const derived = derived_paths.of([EPIC_DEFINITION, BACKLOG_PAGE])

		expect(derived).toStrictEqual([COMMAND_CATALOG_DOC])
	})

	it('derives nothing from a file that is not a command definition', () => {
		const derived = derived_paths.of([
			'scripts/josh/josh-commands-epic.test.ts',
			'scripts/lane/lane-plan.ts',
		])

		expect(derived).toStrictEqual([])
	})
})

describe('derived_paths.command_names', () => {
	it('reads bare and quoted entry keys, not the fields two tabs in', () => {
		const text = "const X = {\n\tlint: {\n\t\tusage: {\n\t\t},\n\t},\n\t'run:observe': {\n\t},\n}"

		expect(derived_paths.command_names(text)).toStrictEqual(['lint', 'run:observe'])
	})
})

// Eight planned files pass a declaration of 4; the two the epic definitions derive take the plan past it.
describe('lane_plan_size.oversize with derived documents', () => {
	const issues = [{ number: 1, title: 'lane', createdAt: PLANNED_AT, labels: [], body: DECLARED }]

	function oversize_of(paths: ReadonlyArray<string>): Oversize | undefined {
		const plan = { issue: 1, paths: [...paths], planned_at: PLANNED_AT }

		return lane_plan_size.oversize(plan, issues, undefined, QUIET)
	}

	it('counts the documents a planned command definition derives', () => {
		const sources = Array.from({ length: 7 }, (_, index) => `scripts/lane/f-${String(index)}.ts`)

		expect(oversize_of(sources)).toBeUndefined()
		expect(oversize_of([...sources, EPIC_DEFINITION])).toMatchObject({
			reason: 'files',
			split_off: [BACKLOG_PAGE, COMMAND_CATALOG_DOC],
		})
	})
})

// The usage spans and the line budget read one page list (#8859).
describe('the command reference page list', () => {
	it('is the list the usage spans are written into', () => {
		expect(command_usage.USAGE_PAGES).toBe(command_reference_line_budget.COMMAND_REFERENCE_DOCS)
	})
})
