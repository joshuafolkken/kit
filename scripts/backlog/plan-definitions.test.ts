import { temporary_directory } from '#tools/test/temporary-directory'
import { describe, expect, it } from 'vitest'
import { plan_definitions } from './plan-definitions'
import { plan_definitions_fixture } from './plan-definitions-fixture'

const { board_repo, PANEL_DRAW, THEME_BODY, THEME_DEFS, THEME_PLAN } = plan_definitions_fixture
const make_directory = temporary_directory()

function repo(): string {
	return board_repo(make_directory('plan-definitions-'))
}

describe('plan_definitions.defining_paths', () => {
	it('keeps the body file defining a name the plan carries, and no other body file', async () => {
		const directory = repo()

		expect(await plan_definitions.defining_paths(THEME_PLAN, THEME_BODY, directory)).toStrictEqual([
			THEME_DEFS,
		])
	})

	it('keeps none when the plan carries no compound name', async () => {
		const directory = repo()
		const plan = `- \`${PANEL_DRAW}\` を直す\n`

		expect(await plan_definitions.defining_paths(plan, THEME_BODY, directory)).toStrictEqual([])
	})
})

describe('plan_definitions.with_definitions', () => {
	it('appends each defining body file to the plan as a code span', async () => {
		const directory = repo()

		expect(await plan_definitions.with_definitions(THEME_PLAN, THEME_BODY, directory)).toBe(
			`${THEME_PLAN}\n\`${THEME_DEFS}\``,
		)
	})

	it('leaves the plan alone when the issue has no body', async () => {
		expect(await plan_definitions.with_definitions(THEME_PLAN, undefined, '.')).toBe(THEME_PLAN)
	})
})
