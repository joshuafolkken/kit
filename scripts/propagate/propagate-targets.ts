import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import type { RepoMap } from '#scripts/discovery/repo-map-logic'
import { z } from 'zod'

// Deciding which repositories a published release should be carried into.
//
// The candidate set is joshuafolkken/kit#869's discovery map, so the owner restriction is inherited
// rather than restated: propagation writes — `josh vu`, `josh sync`, a commit, a pull request — and
// a write aimed at somebody else's repository is worse than a read aimed at one. Nothing here
// re-implements discovery.
//
// Which candidates are targets is read from the candidate itself: a repository is downstream when
// its manifest declares a dependency on this package. That is a fact about the checkout in front of
// us rather than a roster, so a new consumer needs no edit here — and it covers a consumer that is
// not a published package at all, which a list of downstream package names cannot
// (joshuafolkken/kit#863).

const MANIFEST_NAME = 'package.json'
const NODE_MODULES = 'node_modules'

// Why a candidate is not going to be processed, or that it is.
type TargetState = 'ready' | 'up_to_date' | 'not_downstream' | 'missing_checkout' | 'unreadable'

interface PropagateTarget {
	repo: string
	path: string
	state: TargetState
	// The range the consumer currently declares, when it declares one at all. Reported so a skip can
	// say what it skipped rather than only that it did.
	declared_range?: string
}

// Only the fields propagation reads. `passthrough` is deliberate — a consumer manifest carries far
// more, and rejecting it for that would classify every real repository as unreadable.
const manifest_schema = z
	.object({
		name: z.string().optional(),
		version: z.string().optional(),
		dependencies: z.record(z.string(), z.string()).optional(),
		devDependencies: z.record(z.string(), z.string()).optional(),
	})
	.loose()

type Manifest = z.infer<typeof manifest_schema>

// Whether a candidate's directory is there at all. Only an override can name a path that is not:
// discovery produces candidates by scanning directories that exist.
function has_checkout(repository_path: string): boolean {
	return existsSync(repository_path)
}

function read_manifest(repository_path: string): Manifest | undefined {
	const manifest_path = path.join(repository_path, MANIFEST_NAME)
	if (!existsSync(manifest_path)) return undefined

	try {
		const parsed: unknown = JSON.parse(readFileSync(manifest_path, 'utf8'))

		const result = manifest_schema.safeParse(parsed)

		return result.success ? result.data : undefined
	} catch {
		return undefined
	}
}

// The range a manifest declares for `package_name`, from either dependency field. Undefined when the
// manifest does not depend on it at all.
function declared_range(manifest: Manifest, package_name: string): string | undefined {
	return manifest.dependencies?.[package_name] ?? manifest.devDependencies?.[package_name]
}

// The version of `package_name` actually installed in a consumer's `node_modules`. This — not the
// declared range — is what decides "already up to date": a caret range that would accept the new
// release still leaves the old copy installed until someone installs it.
function installed_version(repository_path: string, package_name: string): string | undefined {
	const installed = read_manifest(path.join(repository_path, NODE_MODULES, package_name))

	return typeof installed?.version === 'string' ? installed.version : undefined
}

// The three ways a candidate can fail before its manifest is even read, kept apart because they mean
// different things. A path that does not exist is a checkout to report rather than clone; a
// directory with no manifest at all is simply not a Node project (a Godot or Rust repository sharing
// the parent directory), which is an ordinary "not downstream" rather than damage.
function classify_manifest_absence(repository_path: string): TargetState | undefined {
	if (!has_checkout(repository_path)) return 'missing_checkout'
	if (!existsSync(path.join(repository_path, MANIFEST_NAME))) return 'not_downstream'

	return undefined
}

// The state a candidate is in before any dependency is considered: it has no checkout, no manifest,
// an unreadable one, or it is the supplier itself. A supplier repository is not a target because
// propagation carries a release outward, and the source is where it came from.
function classify_before_dependency(
	repository_path: string,
	package_name: string,
	manifest: Manifest | undefined,
): TargetState | undefined {
	const absence = classify_manifest_absence(repository_path)
	if (absence !== undefined) return absence
	if (manifest === undefined) return 'unreadable'

	return manifest.name === package_name ? 'not_downstream' : undefined
}

// Classify one candidate.
function classify_target(
	repo: string,
	repository_path: string,
	package_name: string,
	target_version: string,
): PropagateTarget {
	const manifest = read_manifest(repository_path)
	const early = classify_before_dependency(repository_path, package_name, manifest)
	if (early !== undefined) return { repo, path: repository_path, state: early }
	const range = manifest === undefined ? undefined : declared_range(manifest, package_name)
	if (range === undefined) return { repo, path: repository_path, state: 'not_downstream' }
	const is_current = installed_version(repository_path, package_name) === target_version

	return {
		repo,
		path: repository_path,
		state: is_current ? 'up_to_date' : 'ready',
		declared_range: range,
	}
}

// Every candidate in the map, classified, in map order. Candidates that are not downstream are kept
// in the result rather than filtered away, so the report can say what was considered — a consumer
// silently missing from a propagation run is the failure mode this command exists to remove.
function resolve_targets(
	map: RepoMap,
	package_name: string,
	target_version: string,
): Array<PropagateTarget> {
	const targets: Array<PropagateTarget> = []

	for (const [repo, repository_path] of map) {
		targets.push(classify_target(repo, repository_path, package_name, target_version))
	}

	return targets
}

const propagate_targets = {
	has_checkout,
	read_manifest,
	classify_manifest_absence,
	classify_before_dependency,
	declared_range,
	installed_version,
	classify_target,
	resolve_targets,
}

export type { Manifest, PropagateTarget, TargetState }
export { propagate_targets }
