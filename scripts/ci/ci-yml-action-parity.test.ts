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
// Both workflows prepare pnpm through the same composite action (joshuafolkken/kit#3095), so the
// action's own pins are compared as nobody's: a step of it copied back inline into either workflow
// shows up here as an action the other one does not use.
function extract_action_names(relative_paths: ReadonlyArray<string>): Array<string> {
	const names = relative_paths
		.flatMap((relative_path) => ci_yml_fixture.read_workflow(relative_path).split('\n'))
		.map((line) => workflow_pin_logic.parse_uses_line(line)?.name)
		.filter((name) => name !== undefined)

	return [...new Set(names)].toSorted((left, right) => left.localeCompare(right))
}

// The template job each runtime job shares its setup with: kit splits the template's `checks` into
// `static-checks` and `unit`, and `static-checks` is the half that installs the same way.
const SHARED_JOBS = [
	{ template: 'checks', runtime: 'static-checks' },
	{ template: 'e2e', runtime: 'e2e' },
]

function setup_pnpm_inputs(relative_path: string, job_name: string): unknown {
	return ci_yml_fixture
		.find_job(relative_path, job_name)
		?.steps?.find((step) => step.uses === ci_yml_fixture.SETUP_PNPM_USES)?.with
}

function all_step_names(relative_path: string): Array<string | undefined> {
	return Object.values(ci_yml_fixture.load_workflow(relative_path).jobs).flatMap((job) =>
		(job.steps ?? []).map((step) => step.name),
	)
}

describe('ci.yml action parity (templates/workflows/ci.yml vs .github/workflows/ci.yml)', () => {
	it('the runtime workflow calls the setup-pnpm composite action', () => {
		expect(ci_yml_fixture.read_workflow(ci_yml_fixture.RUNTIME_CI_YML)).toContain(
			`uses: ${ci_yml_fixture.SETUP_PNPM_USES}`,
		)
	})

	it('the template and the runtime workflow use the same set of actions', () => {
		expect(extract_action_names([ci_yml_fixture.TEMPLATE_CI_YML])).toEqual(
			extract_action_names([ci_yml_fixture.RUNTIME_CI_YML]),
		)
	})

	it.each(SHARED_JOBS)(
		'the template job $template calls setup-pnpm with the inputs of $runtime',
		({ template, runtime }) => {
			const template_inputs = setup_pnpm_inputs(ci_yml_fixture.TEMPLATE_CI_YML, template)

			expect(template_inputs).toBeDefined()
			expect(template_inputs).toEqual(setup_pnpm_inputs(ci_yml_fixture.RUNTIME_CI_YML, runtime))
		},
	)

	it('the template carries no step of the composite action inline', () => {
		const action_step_names = new Set(
			ci_yml_fixture
				.load_action(ci_yml_fixture.SETUP_PNPM_ACTION)
				.runs.steps.map((step) => step.name),
		)
		const inline = all_step_names(ci_yml_fixture.TEMPLATE_CI_YML).filter((name) =>
			action_step_names.has(name),
		)

		expect(inline).toEqual([])
	})
})
