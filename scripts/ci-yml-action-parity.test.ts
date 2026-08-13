import { describe, expect, it } from 'vitest'
import { ci_yml_fixture } from './ci-yml-fixture'
import { workflow_pin_logic } from './sync/workflow-pin-logic'

// The refs are deliberately excluded from this comparison. templates/workflows/ci.yml reaches a
// consumer through workflow_pin_logic.apply_pins_for_destination, which resolves every pin from
// .github/workflows at write time, so a template ref lagging behind a Dependabot bump never
// reaches a consumer. Asserting ref equality here would only re-add the manual sync step that
// broke CI on every GitHub Actions bump (joshuafolkken/kit#747). The action *names* still have to
// match: an action the runtime workflow does not use has no canonical pin to resolve from.
function extract_action_names(relative_path: string): Array<string> {
	const names = new Set<string>()

	for (const line of ci_yml_fixture.read_workflow(relative_path).split('\n')) {
		const pin = workflow_pin_logic.parse_uses_line(line)
		if (pin) names.add(pin.name)
	}

	return [...names].toSorted((left, right) => left.localeCompare(right))
}

describe('ci.yml action parity (templates/workflows/ci.yml vs .github/workflows/ci.yml)', () => {
	it('the template and the runtime workflow use the same set of actions', () => {
		expect(extract_action_names(ci_yml_fixture.TEMPLATE_CI_YML)).toEqual(
			extract_action_names(ci_yml_fixture.RUNTIME_CI_YML),
		)
	})
})
