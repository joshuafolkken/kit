import { workflow_pin_logic } from '#scripts/sync/workflow-pin-logic'
import { describe, expect, it } from 'vitest'
import { ci_yml_fixture } from './ci-yml-fixture'

// The refs are deliberately excluded from this comparison. templates/workflows/ci.yml reaches a
// consumer through workflow_pin_logic.apply_pins_for_destination, which resolves every pin from
// .github/workflows at write time, so a template ref lagging behind a Dependabot bump never
// reaches a consumer. Asserting ref equality here would only re-add the manual sync step that
// broke CI on every GitHub Actions bump (joshuafolkken/kit#747). The action *names* still have to
// match: an action the runtime workflow does not use has no canonical pin to resolve from.
//
// The runtime side counts the composite action ci.yml calls as part of ci.yml: the template carries
// that action's steps inline (joshuafolkken/kit#2982). The action now travels to consumers too
// (joshuafolkken/kit#3013), but the template has not been moved onto it yet.
function extract_action_names(relative_paths: ReadonlyArray<string>): Array<string> {
	const names = relative_paths
		.flatMap((relative_path) => ci_yml_fixture.read_workflow(relative_path).split('\n'))
		.map((line) => workflow_pin_logic.parse_uses_line(line)?.name)
		.filter((name) => name !== undefined)

	return [...new Set(names)].toSorted((left, right) => left.localeCompare(right))
}

describe('ci.yml action parity (templates/workflows/ci.yml vs .github/workflows/ci.yml)', () => {
	it('the runtime workflow calls the setup-pnpm composite action', () => {
		expect(ci_yml_fixture.read_workflow(ci_yml_fixture.RUNTIME_CI_YML)).toContain(
			`uses: ${ci_yml_fixture.SETUP_PNPM_USES}`,
		)
	})

	it('the template and the runtime workflow use the same set of actions', () => {
		expect(extract_action_names([ci_yml_fixture.TEMPLATE_CI_YML])).toEqual(
			extract_action_names([ci_yml_fixture.RUNTIME_CI_YML, ci_yml_fixture.SETUP_PNPM_ACTION]),
		)
	})
})
