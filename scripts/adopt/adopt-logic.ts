import { repo_discovery } from '#scripts/discovery/repo-discovery'
import { repo_origin } from '#scripts/discovery/repo-origin'
import type { Release, ReleasePlan } from '#scripts/propagate/propagate-steps'
import type { PropagateTarget } from '#scripts/propagate/propagate-targets'
import { self_sync_guard } from '#scripts/self-sync-guard/self-sync-guard-logic'
import { KIT_PACKAGE_NAME } from '#scripts/version/kit-descriptor'

// The decisions `josh adopt` makes before any step runs: whether this repository may adopt at all,
// which repository the issue is opened in, and what the run is carrying (joshuafolkken/kit#1085).

const ADOPT_ORIGIN = 'Opened by `josh adopt` in this repository.'

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
	resolve_self_target,
	build_plan,
}

export { adopt_logic }
