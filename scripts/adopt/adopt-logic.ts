import { repo_discovery } from '#scripts/discovery/repo-discovery'
import { repo_origin } from '#scripts/discovery/repo-origin'
import type { Release, ReleasePlan } from '#scripts/propagate/propagate-steps'
import type { PropagateTarget } from '#scripts/propagate/propagate-targets'
import { self_sync_guard } from '#scripts/self-sync-guard/self-sync-guard-logic'
import { KIT_PACKAGE_NAME } from '#scripts/version/kit-descriptor'

// The decisions `josh adopt` makes before any step runs: whether this repository may adopt at all,
// which repository the issue is opened in, and what the run is carrying (joshuafolkken/kit#1085).

const ADOPT_ORIGIN = 'Opened by `josh adopt` in this repository.'
const INCOMPLETE_HEADLINE =
	'Refusing to adopt: these declared toolkits would fall out of the plan, and the run would sync the rest without them.'
const INCOMPLETE_EFFECT =
	"The toolkits overlay files derived from kit's own (see docs/sync.md), so syncing kit without one rewrites that overlay back to kit's original — a wrong diff wearing kit's face."
const MISPLACED_CAUSE =
	'declared under `dependencies`; the upgrade installs with `pnpm add -D` and would relocate it. Move it to `devDependencies`.'
const ABSENT_CAUSE =
	'no runnable CLI here; the package or its `node_modules/.bin` shim is missing. Run `pnpm install`.'

// Adoption never runs inside kit's own repository — the same boundary `josh sync` draws
// (joshuafolkken/kit#868), and for the same reason: the sync would overwrite the distribution source
// with its own derived templates. Refused here, before anything writes, rather than left for the
// sync to fail on halfway through the sequence.
//
// It is only kit that is refused, not every repository under the scope. app-kit and game-kit are
// themselves consumers of kit — `josh propagate` carries kit's releases *into* them — so adopting
// there is exactly the intended use, and a refusal keyed on the npm scope would lock out the two
// repositories that need this command most.
function refuse_inside_kit_repository(project_root: string): string | undefined {
	if (self_sync_guard.read_package_name(project_root) !== KIT_PACKAGE_NAME) return undefined

	return [
		`Refusing to adopt: this is ${KIT_PACKAGE_NAME}'s own repository.`,
		'Adoption carries a published toolkit inward, so it runs in a repository that consumes one.',
		'Run it from a consumer project instead.',
	].join('\n')
}

// The verification gate and the pull request both run through `pnpm josh`, which is kit's own CLI.
// pnpm writes a `node_modules/.bin` shim only for a project's *direct* dependencies, so a repository
// that declares app-kit or game-kit alone has no `josh` shim: those two steps would fail *after* the
// upgrade and the sync had already written, leaving a dirty tree and no pull request. Refused before
// anything writes instead.
function refuse_without_kit(releases: ReadonlyArray<Release>): string | undefined {
	if (releases.some((release) => release.package_name === KIT_PACKAGE_NAME)) return undefined

	return [
		`Refusing to adopt: ${KIT_PACKAGE_NAME} is not a direct dev dependency here.`,
		'The verification gate and the pull request run through `pnpm josh`, which it provides.',
		`Add it with \`pnpm add -D ${KIT_PACKAGE_NAME}\` and run this again.`,
	].join('\n')
}

// One indented line per toolkit, so the reader sees which fix belongs to which package rather than
// two lists to match up by hand.
function name_causes(package_names: ReadonlyArray<string>, cause: string): Array<string> {
	return package_names.map((package_name) => `  ${package_name} — ${cause}`)
}

// A declared toolkit that falls out of the plan is a refusal rather than a warning
// (joshuafolkken/kit#1540). kit distributes the base files and every other toolkit overlays files
// *derived* from them (`docs/sync.md` → two distribution tiers), so a run that syncs kit without the
// overlay does not merely do less — it writes the overlay's paths back to kit's originals. That diff
// then wears kit's own face in the pull request, which is exactly what a reviewer cannot spot.
//
// Warning and continuing was the first round's answer, and it holds only where someone is reading:
// `josh adopt` runs unattended, and both causes are one command away from fixed — so refusing costs
// the user a command and continuing costs a wrong diff. Refusing keeps the first round's rule rather
// than reversing it: the exclusion is still named, and now it also stops.
function refuse_incomplete_plan(
	misplaced: ReadonlyArray<string>,
	unresolved: ReadonlyArray<string>,
): string | undefined {
	const moved = name_causes(misplaced, MISPLACED_CAUSE)
	const named = [...moved, ...name_causes(unresolved, ABSENT_CAUSE)]
	if (named.length === 0) return undefined

	return [INCOMPLETE_HEADLINE, INCOMPLETE_EFFECT, ...named].join('\n')
}

// The one target of an adoption: this checkout, named by its own `origin` so the issue and the pull
// request land in the repository the work is done in. Read from the git config rather than asked of
// `gh`, which is how the discovery map is built too.
function resolve_self_target(project_root: string): PropagateTarget | undefined {
	const origin_url = repo_discovery.read_origin_url(project_root)
	if (origin_url === undefined) return undefined
	const identity = repo_origin.parse_origin_url(origin_url)
	if (identity === undefined) return undefined

	return { repo: repo_origin.format_identity(identity), path: project_root, state: 'ready' }
}

function build_plan(releases: ReadonlyArray<Release>): ReleasePlan {
	return { releases, origin: ADOPT_ORIGIN }
}

const adopt_logic = {
	ADOPT_ORIGIN,
	refuse_inside_kit_repository,
	refuse_without_kit,
	refuse_incomplete_plan,
	resolve_self_target,
	build_plan,
}

export { adopt_logic }
