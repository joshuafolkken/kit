import { adopt_toolkits } from '#scripts/adopt/adopt-toolkits'
import { propagate_run, type RunStep, type StepResult } from './propagate-run'
import { propagate_steps, type Release, type ReleasePlan } from './propagate-steps'
import { propagate_targets, type Manifest, type PropagateTarget } from './propagate-targets'

// What one `josh propagate` run carries, decided from the repository it runs in.
//
// The supplier is kit or any toolkit built on it — app-kit, game-kit — and a toolkit's propagation
// carries the base packages under it too, at the versions that toolkit itself has installed and was
// verified with rather than at the base's newest. Each consumer is delivered by the topmost toolkit
// it installs: a lower supplier skips it, because syncing only the base would write the overlay's
// paths back to the base's originals (`docs/sync.md` → base first, overlay after), and would hand the
// consumer a base the toolkit above it never verified. Discovery, ordering and the CLI name are
// `josh adopt`'s own reads (`scripts/adopt/adopt-toolkits.ts`), not a second copy of them.

const REFUSAL_PREFIX = 'Refusing to propagate:'
const SUPPLIER_REFUSAL = [
	`${REFUSAL_PREFIX} this is not a ${adopt_toolkits.TOOLKIT_SCOPE} toolkit's own repository.`,
	'Propagation carries a published release outward, so it runs from the toolkit that published it',
	'— kit, or a toolkit built on it that ships a CLI. Run it from that checkout instead.',
].join('\n')
const UNRESOLVED_CAUSE =
	'declared here but not installed with a runnable CLI, so the consumers would receive this toolkit without it. Run `pnpm install`.'
const MISPLACED_CAUSE =
	'declared under `dependencies`, which leaves it out of the plan. Move it to `devDependencies`.'
const ARROW = ' → '
const LIST_SEPARATOR = ', '

interface Supplier {
	package_name: string
	bin_name: string
}

interface SupplierResolution {
	supplier?: Supplier
	refusal?: string
}

interface BaseResolution {
	bases?: Array<Release>
	cause?: string
}

interface PlanResolution {
	plan?: ReleasePlan
	refusal?: string
}

// A toolkit is a scoped package that ships a CLI — the same reading `josh adopt` applies to an
// installed one, applied here to the repository's own manifest.
function toolkit_name(manifest: Manifest): string | undefined {
	const { name } = manifest

	return name !== undefined && adopt_toolkits.is_toolkit_package(name) ? name : undefined
}

function supplier_of(manifest: Manifest | undefined): Supplier | undefined {
	const package_name = manifest === undefined ? undefined : toolkit_name(manifest)
	if (manifest === undefined || package_name === undefined) return undefined
	const bin_name = adopt_toolkits.bin_name_of(package_name, manifest)

	return bin_name === undefined ? undefined : { package_name, bin_name }
}

function resolve_supplier(project_root: string): SupplierResolution {
	const supplier = supplier_of(propagate_targets.read_manifest(project_root))

	return supplier === undefined ? { refusal: SUPPLIER_REFUSAL } : { supplier }
}

// A base toolkit pinned to the version installed in the supplier's own checkout — the one the
// supplier's verification gate ran against.
function pin_installed(project_root: string, release: Release): Release | undefined {
	const version = propagate_targets.installed_version(project_root, release.package_name)

	return version === undefined ? undefined : { ...release, version }
}

// Why a declared base toolkit would fall out of the plan, naming it — either way `josh adopt` refuses
// one for. A base left out is not merely left behind: every consumer that
// installs it would then read it as a toolkit above this one and be skipped.
function incomplete_cause(project_root: string): string | undefined {
	const misplaced = adopt_toolkits.misplaced_toolkits(project_root)
	if (misplaced.length > 0) return `${misplaced.join(LIST_SEPARATOR)} — ${MISPLACED_CAUSE}`
	const unresolved = adopt_toolkits.unresolved_toolkits(project_root)

	return unresolved.length === 0
		? undefined
		: `${unresolved.join(LIST_SEPARATOR)} — ${UNRESOLVED_CAUSE}`
}

// The supplier's base toolkits, base first, or the names that cannot be carried.
function base_releases(project_root: string, supplier: Supplier): BaseResolution {
	const cause = incomplete_cause(project_root)
	if (cause !== undefined) return { cause }

	const bases = adopt_toolkits
		.discover_toolkits(project_root)
		.filter((release) => release.package_name !== supplier.package_name)
		.map((release) => pin_installed(project_root, release))

	return bases.every((release) => release !== undefined) ? { bases } : { cause: UNRESOLVED_CAUSE }
}

// The releases one run carries: the base toolkits first, then the supplier at its own version, so the
// sync runs base first and the supplier's overlay is written last.
function build_plan(project_root: string, version: string): PlanResolution {
	const { supplier, refusal } = resolve_supplier(project_root)
	if (supplier === undefined) return { refusal: refusal ?? SUPPLIER_REFUSAL }
	const { bases, cause } = base_releases(project_root, supplier)
	if (bases === undefined) return { refusal: `${REFUSAL_PREFIX} ${cause ?? UNRESOLVED_CAUSE}` }
	const releases = [...bases, { ...supplier, version }]

	return { plan: { releases, origin: propagate_steps.PROPAGATE_ORIGIN } }
}

// The package the run publishes and waits for — by construction the plan's last release.
function supplier_name(plan: ReleasePlan): string {
	return plan.releases.at(-1)?.package_name ?? ''
}

// A declared scoped package counts as a toolkit unless it is demonstrably a library: installed, and
// shipping no CLI. One that is not installed yet cannot be told apart, and treating it as a toolkit
// errs toward leaving the consumer to the propagation above rather than reverting its overlay.
function may_be_toolkit(repository_path: string, package_name: string): boolean {
	if (adopt_toolkits.read_bin_name(repository_path, package_name) !== undefined) return true

	return adopt_toolkits.is_unreachable_toolkit(repository_path, package_name)
}

function carriers_of(target: PropagateTarget, plan: ReleasePlan): Array<string> {
	const carried = new Set(plan.releases.map((release) => release.package_name))

	return adopt_toolkits
		.all_declared_toolkits(target.path)
		.filter((name) => !carried.has(name) && may_be_toolkit(target.path, name))
}

// A consumer that installs a toolkit this run does not carry is left to that toolkit's propagation.
// Only a candidate that would otherwise be processed or reported current is re-classified.
function mark_carried(target: PropagateTarget, plan: ReleasePlan): PropagateTarget {
	if (target.state !== 'ready' && target.state !== 'up_to_date') return target
	const carriers = carriers_of(target, plan)

	return carriers.length === 0 ? target : { ...target, state: 'carried_above', carriers }
}

// What the dry run prints for the two steps that repeat per release: the versions each package is
// pinned to, and the sync order.
function plan_details(plan: ReleasePlan): Readonly<Record<string, string>> {
	return {
		[propagate_run.STEP_UPGRADE]: plan.releases
			.map((release) => `${release.package_name}@${release.version}`)
			.join(LIST_SEPARATOR),
		[propagate_run.STEP_SYNC]: propagate_steps
			.sync_commands(plan)
			.map(({ command }) => command.join(' '))
			.join(ARROW),
	}
}

// The dry-run runner: it reports what each step would do and touches nothing.
function create_step_describer(plan: ReleasePlan): RunStep {
	const details = plan_details(plan)

	return (target: PropagateTarget, step: string): StepResult => {
		const detail = details[step]
		const suffix = detail === undefined ? '' : `: ${detail}`

		console.info(`  ${target.repo}: would run ${step}${suffix}`)

		return { step, is_ok: true }
	}
}

const propagate_plan = {
	resolve_supplier,
	build_plan,
	supplier_name,
	mark_carried,
	create_step_describer,
}

export type { Supplier }
export { propagate_plan }
