import { describe, expect, it } from 'vitest'
import { plan_consumers_section } from './plan-consumers-section'
import { plan_named_files } from './plan-named-files'

// joshuafolkken/kit#7726: the files a plan will edit, as `issue:plan` counts them against the estimate.

const EDITED = 'scripts/issue/issue-plan-cli.ts'
const FIXED = 'scripts/epic/epic-decide.ts'
const UNTOUCHED = 'scripts/lane/lane-why.ts'

function plan_of(steps: ReadonlyArray<string>, consumers: ReadonlyArray<string>): string {
	return ['## 計画', ...steps, '', plan_consumers_section.HEADING, ...consumers].join('\n')
}

describe('plan_named_files.named_files — the files a plan will edit', () => {
	it('counts the paths the plan names and the consumers it marks for fixing', () => {
		const plan = plan_of(
			[`- change \`${EDITED}\``],
			[`- \`restated\`: \`${FIXED}\` — 直す(share it)`],
		)

		expect(plan_named_files.named_files(plan)).toEqual([EDITED, FIXED])
	})

	it('leaves out no-impact and separate-issue consumers', () => {
		const plan = plan_of(
			[`- change \`${EDITED}\``],
			[`- \`read\`: \`${UNTOUCHED}\` — 影響なし(reads only)`, `- \`x\`: \`${FIXED}\` — 別 Issue`],
		)

		expect(plan_named_files.named_files(plan)).toEqual([EDITED])
	})

	it('leaves out tests, directories and a path named twice', () => {
		const plan = plan_of(
			[
				`- change \`${EDITED}\` and \`issue-plan-cli.ts\``,
				'- test `scripts/issue/issue-plan-cli.test.ts`',
				'- under `scripts/issue/`',
			],
			[`- \`record_plan\`: \`${EDITED}\` — 直す`],
		)

		expect(plan_named_files.named_files(plan)).toEqual([EDITED])
	})

	it('counts nothing for a plan naming no file', () => {
		expect(plan_named_files.named_files(plan_of(['- step'], ['- なし（no concept）']))).toEqual([])
	})
})
