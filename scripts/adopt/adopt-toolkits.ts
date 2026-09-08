import path from 'node:path'
import { find_local_bin_upwards } from '#scripts/local-bin'
import type { Release } from '#scripts/propagate/propagate-steps'
import { propagate_targets, type Manifest } from '#scripts/propagate/propagate-targets'
import { KIT_PACKAGE_NAME } from '#scripts/version/kit-descriptor'
import { z } from 'zod'

// Which `@joshuafolkken/*` toolkits `josh adopt` can upgrade in the repository it is run from
// (joshuafolkken/kit#1085).
//
// Discovery is a filesystem fact rather than a roster written here: a hardcoded list would go stale
// the day a fourth toolkit is published, and a project that depends on only one of them would be
// told to sync a CLI it does not have.

const TOOLKIT_SCOPE = '@joshuafolkken/'
// `josh adopt` pulls whatever is newest inward. The exact-version pin is `josh propagate`'s, and it
// exists there only because that command waits for a specific publish before carrying it outward.
const LATEST_VERSION = 'latest'
const NODE_MODULES = 'node_modules'
const BASE_RANK = 0
const DERIVED_RANK = 1

// Only the field the bin name is read from, in both shapes npm accepts. The manifest is read through
// propagation's own reader, which keeps every other field, so this parses what that reader passed
// through rather than opening the file a second time (`CLAUDE.md` → "No clones").
const bin_map_schema = z.record(z.string(), z.string())
const bin_schema = z.looseObject({ bin: z.union([z.string(), bin_map_schema]).optional() })

function is_toolkit_package(package_name: string): boolean {
	return package_name.startsWith(TOOLKIT_SCOPE)
}

// kit is the base tier and every other toolkit distributes files *derived* from kit's, so the two
// can manage the same path and whichever `sync` ran last decides its contents
// (`docs/sync.md` → "two distribution tiers"). Ordering is therefore base-first: kit syncs, then the
// toolkits that overlay it. Sorting by name would put kit last and have it overwrite the overlay
// with the original every single run.
function toolkit_rank(package_name: string): number {
	return package_name === KIT_PACKAGE_NAME ? BASE_RANK : DERIVED_RANK
}

function compare_toolkits(left: string, right: string): number {
	const by_rank = toolkit_rank(left) - toolkit_rank(right)

	return by_rank === 0 ? left.localeCompare(right) : by_rank
}

function scoped_names(declared: Readonly<Record<string, string>> | undefined): Array<string> {
	return Object.keys(declared ?? {}).filter((package_name) => is_toolkit_package(package_name))
}

// Toolkits are development tooling, and the shared upgrade builder installs them with `pnpm add -D`
// (`build_upgrade_shell_command`). A toolkit declared under `dependencies` would therefore be
// *relocated* into `devDependencies` by the upgrade — a manifest rewrite nobody asked for, riding
// silently into the pull request. Discovery reads `devDependencies` only for that reason, and
// `misplaced_toolkits` names what was left out so the omission is reported rather than silent.
function declared_toolkits(project_root: string): ReadonlyArray<string> {
	const manifest = propagate_targets.read_manifest(project_root)

	return scoped_names(manifest?.devDependencies).toSorted(compare_toolkits)
}

// npm accepts two shapes for `bin`. The string form names exactly one executable and its name is the
// package's *unscoped* one — the rule `read_bin_entry` in `scripts/local-bin.ts` reads in the other
// direction, from a name to a path. The object form is answered by that same unscoped name where it
// declares one, so a toolkit shipping several CLIs still resolves to one deterministically.
function pick_bin_name(package_name: string, bin: string | Record<string, string>): string {
	const unscoped = path.basename(package_name)
	if (typeof bin === 'string') return unscoped
	if (bin[unscoped] !== undefined) return unscoped

	return Object.keys(bin)[0] ?? unscoped
}

function read_installed_manifest(project_root: string, package_name: string): Manifest | undefined {
	return propagate_targets.read_manifest(path.join(project_root, NODE_MODULES, package_name))
}

function bin_name_of(package_name: string, installed: Manifest): string | undefined {
	const parsed = bin_schema.safeParse(installed)
	const bin = parsed.success ? parsed.data.bin : undefined

	return bin === undefined ? undefined : pick_bin_name(package_name, bin)
}

// The CLI a toolkit installs, read from the installed package's own `bin` field. Deriving it means
// `@joshuafolkken/app-kit` answers `josh-app` without anyone maintaining the mapping here.
function read_bin_name(project_root: string, package_name: string): string | undefined {
	const installed = read_installed_manifest(project_root, package_name)

	return installed === undefined ? undefined : bin_name_of(package_name, installed)
}

function has_runnable_cli(project_root: string, bin_name: string): boolean {
	return find_local_bin_upwards(project_root, bin_name) !== undefined
}

// A declared toolkit is a target only when its CLI is actually runnable here. A dependency whose
// shim is missing — an install that never ran, a partial workspace — cannot be told to sync, and
// spawning it would fail the sync step rather than say what is wrong.
function resolve_toolkit(project_root: string, package_name: string): Release | undefined {
	const bin_name = read_bin_name(project_root, package_name)
	if (bin_name === undefined) return undefined
	if (!has_runnable_cli(project_root, bin_name)) return undefined

	return { package_name, version: LATEST_VERSION, bin_name }
}

// Unreachable and not-a-toolkit are two different answers, and collapsing them is what makes a
// refusal give advice that is wrong. **Unreachable** is a broken install — the package is missing
// here, or it declares a CLI whose shim is not installed — and `pnpm install` fixes it whatever the
// package turns out to be. A package that is installed perfectly well and simply ships **no** CLI is
// a scoped *library* rather than a toolkit: nothing about it is broken, so it is not this, and it is
// not misplaced either. The `@joshuafolkken/` prefix alone cannot tell the two apart, which is why
// the question is asked of the installed `bin` field (joshuafolkken/kit#1540 review round 1).
function is_unreachable_toolkit(project_root: string, package_name: string): boolean {
	const installed = read_installed_manifest(project_root, package_name)
	if (installed === undefined) return true

	const bin_name = bin_name_of(package_name, installed)

	return bin_name !== undefined && !has_runnable_cli(project_root, bin_name)
}

// Only a package that is *demonstrably* a toolkit — installed, with its CLI runnable here — is
// reported as misplaced. Telling the owner of a scoped runtime library to move it into
// `devDependencies` would break the build it is there to serve, and one that is not installed at all
// is answered by `unresolved_toolkits` instead, whose `pnpm install` is the fix that actually
// applies. Naming only what can be proved is what keeps a refusal honest.
function misplaced_toolkits(project_root: string): ReadonlyArray<string> {
	const manifest = propagate_targets.read_manifest(project_root)
	const development = new Set(scoped_names(manifest?.devDependencies))

	return scoped_names(manifest?.dependencies).filter(
		(name) => !development.has(name) && resolve_toolkit(project_root, name) !== undefined,
	)
}

function discover_toolkits(project_root: string): ReadonlyArray<Release> {
	return declared_toolkits(project_root)
		.map((package_name) => resolve_toolkit(project_root, package_name))
		.filter((release) => release !== undefined)
}

// Every scoped package this manifest declares, in either field. `unresolved_toolkits` reads both
// because a broken install is a broken install wherever it was declared, and the fix it reports —
// `pnpm install` — is right for a package under `dependencies` too.
function all_declared_toolkits(project_root: string): ReadonlyArray<string> {
	const manifest = propagate_targets.read_manifest(project_root)
	const development = scoped_names(manifest?.devDependencies)

	return [...new Set([...development, ...scoped_names(manifest?.dependencies)])]
}

// The other half of the same read: which declared packages the run cannot reach at all. Dropping
// them silently is what let a partial install sync kit alone and revert the overlay tier
// (joshuafolkken/kit#1540), so the caller refuses on this list rather than discovering it as a
// shorter plan. A scoped library that ships no CLI appears in neither list, because nothing about it
// is broken.
function unresolved_toolkits(project_root: string): ReadonlyArray<string> {
	return all_declared_toolkits(project_root).filter((package_name) =>
		is_unreachable_toolkit(project_root, package_name),
	)
}

const adopt_toolkits = {
	TOOLKIT_SCOPE,
	LATEST_VERSION,
	is_toolkit_package,
	compare_toolkits,
	declared_toolkits,
	misplaced_toolkits,
	pick_bin_name,
	read_bin_name,
	is_unreachable_toolkit,
	resolve_toolkit,
	discover_toolkits,
	unresolved_toolkits,
}

export { adopt_toolkits }
