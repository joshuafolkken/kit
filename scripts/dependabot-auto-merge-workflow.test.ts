import { describe, expect, it } from 'vitest'
import { ci_yml_fixture } from './ci-yml-fixture'
import { dependabot_workflow_fixture } from './dependabot-workflow-fixture'
import { transform_copied_content } from './init/init-copy-content'
import { init_logic } from './init/init-logic'
import { managed_marker_logic } from './managed-marker/managed-marker-logic'
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
	decision_expression,
} = dependabot_workflow_fixture
const METADATA_ACTION = 'dependabot/fetch-metadata'
const ACTIONS_ECOSYSTEM = "steps.metadata.outputs.package-ecosystem == 'github_actions'"
const PATCH_UPDATE = "steps.metadata.outputs.update-type == 'version-update:semver-patch'"
const MINOR_UPDATE = "steps.metadata.outputs.update-type == 'version-update:semver-minor'"
const MAJOR_UPDATE = 'version-update:semver-major'
const MANAGED_GATE = dependabot_workflow_fixture.managed_gate(false)
const STALE_REFERENCE = '0000000000000000000000000000000000000000 # v0.0.0'
const WORKFLOWS_ROOT = '.github/workflows'
const WORKFLOWS_PREFIX = `${WORKFLOWS_ROOT}/`

// True for the workflow directory itself, anything under it, and any ancestor of it — `.github`
// alone, or the repository root, would carry every workflow through the directory copy just as
// directly. The root is spelled several ways (`.`, `./`, an empty entry), all of which normalize to
// the empty string and are answered before the prefix comparisons, where they would slip through.
function shares_path_with_workflows(directory: string): boolean {
	const normalized = directory
		.replaceAll('\\', '/')
		.replace(/^\.$/u, '')
		.replace(/^\.\//u, '')
		.replace(/\/$/u, '')

	if (normalized === '') return true
	// An entry that climbs out of the repository can reach `.github/workflows` from anywhere above it.
	if (normalized.split('/').includes('..')) return true

	return (
		normalized === WORKFLOWS_ROOT ||
		normalized.startsWith(WORKFLOWS_PREFIX) ||
		`${WORKFLOWS_ROOT}/`.startsWith(`${normalized}/`)
	)
}

const DEPLOY_VPS_DESTINATION = `${WORKFLOWS_PREFIX}deploy-vps.yml`
const MARKER_VARIABLE = 'MANAGED_MARKER'
const { MARKER_PREFIX } = managed_marker_logic

// Every workflow destination kit distributes. A workflow destination is one `josh sync` overwrites
// through the transform that injects pins and the stamp, which is exactly what makes a bump to it
// revert (joshuafolkken/kit#836) and exactly what the stamp records (joshuafolkken/kit#844).
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

// These read the decision the reconciling step declares, not a condition on it: joshuafolkken/kit#845
// moved every clause about *which* updates may arm out of the step gates and into one expression.
// What each clause does is proven by evaluation in `dependabot-auto-merge-decision.test.ts`; these
// hold that the clauses are written at all, and that the majors clause is absent rather than
// negated somewhere out of sight.
describe('dependabot-auto-merge.yml gate', () => {
	it('discriminates on the github-actions ecosystem', () => {
		expect(decision_expression(template_job())).toContain(ACTIONS_ECOSYSTEM)
	})

	// `dependency-type` cannot separate the ecosystems — Dependabot reports github-actions updates as
	// `direct:production`, the same value it reports for npm production dependencies — so
	// `package-ecosystem` is the only usable discriminator (joshuafolkken/kit#802).
	it('names patch and minor updates as the ones that merge unattended', () => {
		const condition = decision_expression(template_job())

		expect(condition).toContain(PATCH_UPDATE)
		expect(condition).toContain(MINOR_UPDATE)
	})

	it('never merges a major update', () => {
		expect(decision_expression(template_job())).not.toContain(MAJOR_UPDATE)
	})

	// The whole job is Dependabot's; a workflow that acted on anyone else's pull request unattended
	// would be a different feature entirely. It keys on the author rather than on `github.actor`,
	// which names whoever triggered the run — see `dependabot-auto-merge-reconcile.test.ts` for why
	// that distinction is load-bearing (joshuafolkken/kit#838).
	it('runs only for pull requests Dependabot opened', () => {
		expect(template_job()?.if).toBe("github.event.pull_request.user.login == 'dependabot[bot]'")
	})

	// The command `josh doctor` matches to decide whether the repository auto-merge prerequisite
	// applies. Renaming it would silently drop the report the workflow depends on.
	it('enables auto-merge with the command the prerequisite report keys on', () => {
		const arming = merge_step(template_job())

		expect(step_run(arming)).toContain(MERGE_COMMAND)
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

// joshuafolkken/kit#836: a bump to a workflow an upstream package distributes is undone by the next
// `sync`, which resolves every pin from the installed package at write time (joshuafolkken/kit#747).
// Merging one produces a loop — bump, merge, sync writes it back, Dependabot proposes it again —
// with a full CI run per round. The template therefore holds those bumps back; a bump to a workflow
// the consumer owns is a real update and still merges.
//
// The decision is read off each changed file's own stamp rather than from a list of paths, because a
// list can only describe what the package holding it distributes and a repository may receive
// workflows from several (joshuafolkken/kit#844).
function managed_step_run(): string {
	return step_run(find_step(template_job(), MANAGED_STEP_ID))
}

describe('dependabot-auto-merge.yml upstream-managed exclusion', () => {
	it('decides from the changed files in a dedicated step', () => {
		expect(managed_step_run()).toContain('/files')
	})

	// The default shell is `bash -e` without `pipefail`, so piping `gh` into anything would mask a
	// failed call behind the downstream command's status and report "nothing managed" — merging the
	// very pull request the step exists to hold back. An assignment carries the command's status.
	it('captures the changed files before deciding, so a failed lookup fails the step', () => {
		expect(managed_step_run()).toContain('changed="$(gh api')
	})

	// A partial answer is a wrong answer here: a managed path beyond the first page would be missed
	// and the bump merged.
	it('reads every page of the changed files', () => {
		expect(managed_step_run()).toContain('--paginate')
	})

	it('publishes the decision as the output the merge gate reads', () => {
		expect(managed_step_run()).toContain(MANAGED_OUTPUT)
	})

	it('arms only when no upstream-managed workflow is touched', () => {
		expect(decision_expression(template_job())).toContain(MANAGED_GATE)
	})

	// The exclusion belongs to the distributed copy only. In kit `.github/workflows/*` IS the source
	// of truth, so a bump merged there is the update every consumer receives — excluding it would
	// stop the pins from ever being maintained (joshuafolkken/kit#802).
	it('is absent from kit’s own runtime workflow, where those pins are the source', () => {
		expect(find_step(runtime_job(), MANAGED_STEP_ID)).toBeUndefined()
		expect(merge_step(runtime_job())?.if ?? '').not.toContain(MANAGED_OUTPUT)
	})
})

// How the step reads the answer off a file, as opposed to which files it looks at. Both halves of
// the old check could misread — `grep` conflated "no match" with "I could not look", and a list
// could not describe a file another package writes (joshuafolkken/kit#844).
describe('dependabot-auto-merge.yml upstream-managed detection', () => {
	// `grep` answers 1 for "no match" and 2 for "I could not look", and the old check read both as
	// "not managed" — one of which means "merge it". Narrowing inside `--jq` and matching with
	// `case` removes the conflation: neither has a failure status to misread.
	it('narrows to workflow files inside the query rather than through grep', () => {
		const run = managed_step_run()

		expect(run).toContain(`select(.filename | startswith("${WORKFLOWS_PREFIX}"))`)
		expect(run).not.toContain('grep')
	})

	// The stamp is matched at the start of the file: this workflow declares the token in its own
	// `env` in order to match on it, so a substring test would call every copy of it managed for the
	// wrong reason and would also flag a file that merely mentions the token.
	it('matches the stamp at the start of the file', () => {
		expect(managed_step_run()).toContain(`"$MANAGED_MARKER"*)`)
		expect(find_step(template_job(), MANAGED_STEP_ID)?.env?.[MARKER_VARIABLE]).toBe(MARKER_PREFIX)
	})

	// A path composed here would break on the first workflow whose name contains a space or a `#`,
	// and every read failing means every bump is held back for good. GitHub already encoded the URL
	// it returns, and it already points at this pull request's head.
	it('reads each file through the URL the API supplied', () => {
		const run = managed_step_run()

		expect(run).toContain('.contents_url')
		expect(run).toContain('gh api "$url"')
		expect(run).not.toContain('/contents/$file')
	})

	// A response that named a workflow but carried no URL to read it at has told the step nothing, so
	// it belongs on the hold-back branch with everything else it could not read — not skipped onto the
	// merge side, which is where a guard on the URL alone would send it.
	it('holds the bump back when a changed workflow carries no URL', () => {
		expect(managed_step_run()).toContain('[ -n "$file$url" ] || continue')
	})

	// Failing lands on the same safe side as answering "managed" — no output is published, and the
	// reconciling step reads a missing input as "do not arm" — but it lands there visibly. Answering
	// would withdraw a previously armed auto-merge on a green job, with nothing to look at.
	it('fails the step when a changed workflow cannot be read', () => {
		const run = managed_step_run()
		const unreadable = run.indexOf('could not be read')

		expect(unreadable).toBeGreaterThan(-1)
		expect(run.slice(unreadable)).toContain('exit 1')
		expect(run.slice(unreadable)).not.toContain('has_managed=true')
	})
})

// The list this replaced had to be kept equal to kit's distribution lists by hand, and #844 is what
// happens when a list and the files it describes come apart. The stamp is written by the same
// transform that writes the file, so the invariant becomes a property of the write path — asserted
// here against the real distribution lists, so a workflow destination added later cannot quietly
// ship unstamped and merge its own bumps.
describe('dependabot-auto-merge.yml upstream-managed stamp coverage', () => {
	it('distributes at least one workflow', () => {
		expect(distributed_workflows().length).toBeGreaterThan(0)
	})

	it.each(distributed_workflows())('stamps %s on the way out', (destination) => {
		expect(managed_marker_logic.is_marked(transform_copied_content(destination, ''))).toBe(true)
	})

	// `deploy-vps.yml` is patched by sync but written directly rather than through that transform, so
	// it is never stamped and a bump to its own pins still merges. The old list got this right only
	// because someone remembered to leave it out.
	it('does not distribute deploy-vps.yml, which keeps its own pins', () => {
		expect(distributed_workflows()).not.toContain(DEPLOY_VPS_DESTINATION)
	})

	// The coverage above enumerates the file lists, which is the whole distribution only while no
	// workflow reaches a consumer through the directory list: `sync_directory` copies with `cpSync`
	// and never reaches the transform, so a workflow placed there would ship unstamped and unpinned
	// with every assertion still green. The list is no longer empty — it carries the `verify-ui`
	// skill — so the guard names what may not be in it rather than requiring it to stay empty.
	it('copies no workflow directory, the case the coverage above cannot see', () => {
		const directories = init_logic.get_ai_copy_directories()

		expect(directories.some((directory) => shares_path_with_workflows(directory))).toBe(false)
	})

	// The guard is the only thing standing between the directory list and an unstamped workflow, so
	// the shapes that would carry one are asserted rather than assumed.
	it.each([WORKFLOWS_ROOT, `${WORKFLOWS_PREFIX}ci.yml`, '.github', '.', './', '', '..', '../kit'])(
		'rejects %j as a directory-copy entry',
		(candidate) => {
			expect(shares_path_with_workflows(candidate)).toBe(true)
		},
	)

	it.each(['.claude/skills/verify-ui', 'prompts', '.github/ISSUE_TEMPLATE'])(
		'accepts %j as a directory-copy entry',
		(candidate) => {
			expect(shares_path_with_workflows(candidate)).toBe(false)
		},
	)
})
