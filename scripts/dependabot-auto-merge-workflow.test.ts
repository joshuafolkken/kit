import { describe, expect, it } from 'vitest'
import { ci_yml_fixture } from './ci-yml-fixture'
import { dependabot_workflow_fixture } from './dependabot-workflow-fixture'
import { transform_copied_content } from './init/init-copy-content'
import { init_logic } from './init/init-logic'
import { workflow_pin_logic } from './sync/workflow-pin-logic'

// joshuafolkken/kit#834 distributes the auto-merge workflow that closes the Dependabot pull requests
// the already-distributed `.github/dependabot.yml` opens. Before it, a consumer received only the
// half that opens them: joshuafolkken/app-kit#184 sat green, mergeable and unmerged with no
// `autoMergeRequest` on it, because nothing in the repository ever enabled auto-merge.
const {
	TEMPLATE,
	RUNTIME,
	MERGE_COMMAND,
	METADATA_STEP_ID,
	MANAGED_STEP_ID,
	MANAGED_OUTPUT,
	template_job,
	runtime_job,
	find_step,
	merge_step,
	step_run,
} = dependabot_workflow_fixture
const METADATA_ACTION = 'dependabot/fetch-metadata'
const ACTIONS_ECOSYSTEM = "steps.metadata.outputs.package-ecosystem == 'github_actions'"
const PATCH_UPDATE = "steps.metadata.outputs.update-type == 'version-update:semver-patch'"
const MINOR_UPDATE = "steps.metadata.outputs.update-type == 'version-update:semver-minor'"
const MAJOR_UPDATE = 'version-update:semver-major'
const MANAGED_GATE = dependabot_workflow_fixture.managed_gate(false)
const MANAGED_LIST_KEY = 'KIT_MANAGED_WORKFLOWS'
const STALE_REFERENCE = '0000000000000000000000000000000000000000 # v0.0.0'

// The paths the template refuses to auto-merge, as the workflow itself declares them.
function declared_managed_workflows(): Array<string> {
	const declared = ci_yml_fixture.load_workflow(TEMPLATE).env?.[MANAGED_LIST_KEY] ?? ''

	return declared
		.split('\n')
		.map((line) => line.trim())
		.filter((line) => line !== '')
		.toSorted((left, right) => left.localeCompare(right))
}

// The same set derived from kit's own distribution lists — the single source of truth the declared
// list has to match. A workflow destination is one `josh sync` overwrites through the pin-injecting
// write path, which is exactly what makes a bump to it revert (joshuafolkken/kit#836).
function distributed_workflows(): Array<string> {
	const destinations = [
		...init_logic.get_ai_copy_files(),
		...init_logic.get_ai_copy_file_mappings().map((mapping) => mapping.dest),
	]

	return destinations
		.filter((destination) => workflow_pin_logic.is_workflow_destination(destination))
		.toSorted((left, right) => left.localeCompare(right))
}

function action_names(relative_path: string): Array<string> {
	const names = new Set<string>()

	for (const line of ci_yml_fixture.read_workflow(relative_path).split('\n')) {
		const pin = workflow_pin_logic.parse_uses_line(line)
		if (pin) names.add(pin.name)
	}

	return [...names].toSorted((left, right) => left.localeCompare(right))
}

// The template with its metadata pin deliberately rolled back. Rebuilt line by line rather than
// through `String#replace`, whose replacement value would carry `$`-sequence semantics.
function with_stale_pin(): string {
	return ci_yml_fixture
		.read_workflow(TEMPLATE)
		.split('\n')
		.map((line) =>
			workflow_pin_logic.parse_uses_line(line)?.name === METADATA_ACTION
				? `        uses: ${METADATA_ACTION}@${STALE_REFERENCE}`
				: line,
		)
		.join('\n')
}

function runtime_metadata_reference(): string | undefined {
	for (const line of ci_yml_fixture.read_workflow(RUNTIME).split('\n')) {
		const pin = workflow_pin_logic.parse_uses_line(line)
		if (pin?.name === METADATA_ACTION) return pin.ref
	}

	return undefined
}

describe('dependabot-auto-merge.yml distribution', () => {
	it('is mapped from the template to the consumer workflows directory', () => {
		expect(init_logic.get_ai_copy_file_mappings()).toContainEqual({
			src: TEMPLATE,
			dest: RUNTIME,
		})
	})

	// The two halves have to land together. Distributing the config that opens the pull requests
	// without the workflow that merges them is the state kit#804 deliberately left behind and #834
	// closes.
	it('ships alongside the dependabot config that opens the pull requests', () => {
		expect(init_logic.get_ai_copy_files()).toContain('.github/dependabot.yml')
	})
})

describe('dependabot-auto-merge.yml gate', () => {
	const step = merge_step(template_job())
	const condition = step?.if ?? ''

	it('runs the merge step only for the github-actions ecosystem', () => {
		expect(condition).toContain(ACTIONS_ECOSYSTEM)
	})

	// `dependency-type` cannot separate the ecosystems — Dependabot reports github-actions updates as
	// `direct:production`, the same value it reports for npm production dependencies — so
	// `package-ecosystem` is the only usable discriminator (joshuafolkken/kit#802).
	it('merges patch and minor updates unattended', () => {
		expect(condition).toContain(PATCH_UPDATE)
		expect(condition).toContain(MINOR_UPDATE)
	})

	it('never merges a major update', () => {
		expect(condition).not.toContain(MAJOR_UPDATE)
	})

	// The whole job is Dependabot's; a workflow that acted on anyone else's pull request unattended
	// would be a different feature entirely. It keys on the author rather than on `github.actor`,
	// which names whoever triggered the run — see the withdrawal guards for why that distinction is
	// load-bearing (joshuafolkken/kit#838).
	it('runs only for pull requests Dependabot opened', () => {
		expect(template_job()?.if).toBe("github.event.pull_request.user.login == 'dependabot[bot]'")
	})

	// The command `josh doctor` matches to decide whether the repository auto-merge prerequisite
	// applies. Renaming it would silently drop the report the workflow depends on.
	it('enables auto-merge with the command the prerequisite report keys on', () => {
		expect(step?.run).toContain(MERGE_COMMAND)
	})
})

describe('dependabot-auto-merge.yml pins', () => {
	// An action the runtime workflow does not use has no canonical pin to resolve from, so write-time
	// injection would hand the consumer the template's own ref.
	it('uses the same actions as kit’s own runtime workflow', () => {
		expect(action_names(TEMPLATE)).toStrictEqual(action_names(RUNTIME))
	})

	it('reads the metadata action through a step the gate can reference', () => {
		const metadata = find_step(template_job(), METADATA_STEP_ID)

		expect(metadata?.uses ?? '').toContain(METADATA_ACTION)
	})

	// Dependabot's `github-actions` ecosystem cannot scan `templates/`, so the committed template ref
	// is never authoritative. A stale one must be rewritten on the way out rather than reaching a
	// consumer (joshuafolkken/kit#747).
	it('resolves the pin from kit’s runtime workflow at write time, not from the template', () => {
		const written = transform_copied_content(RUNTIME, with_stale_pin())

		expect(written).toContain(`${METADATA_ACTION}@${runtime_metadata_reference() ?? ''}`)
		expect(written).not.toContain(STALE_REFERENCE)
	})
})

// joshuafolkken/kit#836: a bump to a kit-distributed workflow is undone by the next `josh sync`,
// which resolves every pin from the installed kit package at write time (joshuafolkken/kit#747).
// Merging one produces a loop — bump, merge, sync writes it back, Dependabot proposes it again —
// with a full CI run per round. The template therefore skips those paths; a bump to a workflow the
// consumer owns is a real update and still merges.
function managed_step_run(): string {
	return step_run(find_step(template_job(), MANAGED_STEP_ID))
}

describe('dependabot-auto-merge.yml kit-managed exclusion', () => {
	it('decides from the changed paths in a dedicated step', () => {
		expect(managed_step_run()).toContain('/files')
	})

	// The default shell is `bash -e` without `pipefail`, so piping `gh` straight into `grep` would
	// mask a failed call behind grep's exit status and report "no kit-managed file" — merging the
	// very pull request the step exists to hold back. An assignment carries the command's status.
	it('captures the changed paths before comparing, so a failed lookup fails the step', () => {
		expect(managed_step_run()).toContain('changed="$(gh api')
	})

	// A partial answer is a wrong answer here: a kit-managed path beyond the first page would be
	// missed and the bump merged.
	it('reads every page of the changed paths', () => {
		expect(managed_step_run()).toContain('--paginate')
	})

	it('publishes the decision as the output the merge gate reads', () => {
		expect(managed_step_run()).toContain(MANAGED_OUTPUT)
	})

	it('merges only when no kit-managed workflow is touched', () => {
		expect(merge_step(template_job())?.if ?? '').toContain(MANAGED_GATE)
	})

	// The list is a copy of kit's distribution lists because YAML cannot read them, so this
	// comparison is what keeps the copy honest: adding a workflow to `AI_COPY_FILES` without adding
	// it here would silently re-open the loop for that file.
	it('excludes exactly the workflows kit distributes', () => {
		expect(declared_managed_workflows()).toStrictEqual(distributed_workflows())
	})

	// Guards the comparison above against passing vacuously if both sides ever became empty.
	it('declares at least one kit-managed workflow', () => {
		expect(declared_managed_workflows().length).toBeGreaterThan(0)
	})

	// `grep -f` on an empty pattern file matches nothing, so an emptied list would read as "nothing
	// is managed" and reopen the loop. The step refuses that reading instead of guessing.
	it('refuses to decide when the list is empty', () => {
		const run = managed_step_run()

		expect(run).toContain(`if [ -z "\${${MANAGED_LIST_KEY}:-}" ]; then`)
		expect(run).toContain('exit 1')
	})

	// The exclusion belongs to the distributed copy only. In kit `.github/workflows/*` IS the source
	// of truth, so a bump merged there is the update every consumer receives — excluding it would
	// stop the pins from ever being maintained (joshuafolkken/kit#802).
	it('is absent from kit’s own runtime workflow, where those pins are the source', () => {
		expect(find_step(runtime_job(), MANAGED_STEP_ID)).toBeUndefined()
		expect(merge_step(runtime_job())?.if ?? '').not.toContain(MANAGED_OUTPUT)
	})
})
