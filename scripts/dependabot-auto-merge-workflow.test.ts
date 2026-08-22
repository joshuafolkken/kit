import { describe, expect, it } from 'vitest'
import { ci_yml_fixture, type WorkflowJob, type WorkflowStep } from './ci-yml-fixture'
import { transform_copied_content } from './init/init-copy-content'
import { init_logic } from './init/init-logic'
import { workflow_pin_logic } from './sync/workflow-pin-logic'

// joshuafolkken/kit#834 distributes the auto-merge workflow that closes the Dependabot pull requests
// the already-distributed `.github/dependabot.yml` opens. Before it, a consumer received only the
// half that opens them: joshuafolkken/app-kit#184 sat green, mergeable and unmerged with no
// `autoMergeRequest` on it, because nothing in the repository ever enabled auto-merge.
const TEMPLATE = 'templates/workflows/dependabot-auto-merge.yml'
const RUNTIME = '.github/workflows/dependabot-auto-merge.yml'
const JOB = 'auto-merge'
const METADATA_STEP_ID = 'metadata'
const METADATA_ACTION = 'dependabot/fetch-metadata'
const MERGE_COMMAND = 'gh pr merge --auto --merge'
const ACTIONS_ECOSYSTEM = "steps.metadata.outputs.package-ecosystem == 'github_actions'"
const PATCH_UPDATE = "steps.metadata.outputs.update-type == 'version-update:semver-patch'"
const MINOR_UPDATE = "steps.metadata.outputs.update-type == 'version-update:semver-minor'"
const MAJOR_UPDATE = 'version-update:semver-major'
const STALE_REFERENCE = '0000000000000000000000000000000000000000 # v0.0.0'

function template_job(): WorkflowJob | undefined {
	return ci_yml_fixture.find_job(TEMPLATE, JOB)
}

function merge_step(job: WorkflowJob | undefined): WorkflowStep | undefined {
	return job?.steps?.find((step) => (step.run ?? '').includes(MERGE_COMMAND))
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

	// The whole job is Dependabot's; a workflow that merged anyone else's pull request unattended
	// would be a different feature entirely.
	it('runs only for pull requests Dependabot opened', () => {
		expect(template_job()?.if).toBe("github.actor == 'dependabot[bot]'")
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
		const metadata = template_job()?.steps?.find((step) => step.id === METADATA_STEP_ID)

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
