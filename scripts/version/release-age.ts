import { readFileSync } from 'node:fs'
import path from 'node:path'
import { yaml_document } from '#scripts/lib/yaml-document'
import semver from 'semver'
import { z } from 'zod'

// The minimum-release-age quarantine, applied natively instead of inherited from safe-chain's
// interception. safe-chain filters the registry only when the process tree was started through one
// of its wrapped shell commands, so `josh latest` and `pnpm josh latest` would resolve different
// "newest release" answers. These functions make the resolution deterministic: the policy comes
// from the repo-managed `pnpm-workspace.yaml`, the publish timestamps from the registry, and the
// selection is a pure computation over both. pnpm 12 reads its settings from `pnpm-workspace.yaml`
// — a `minimum-release-age` line in `.npmrc` is ignored there, so reading it would report a window
// pnpm does not apply.

const NO_QUARANTINE_MINUTES = 0
const WORKSPACE_PATH = 'pnpm-workspace.yaml'
const workspace_age_schema = z.object({ minimumReleaseAge: z.number().int().nonnegative() })

// A version → ISO publish date map, the shape both the registry and the GitHub Packages API are
// reduced to before the aged-version selection runs.
const release_times_schema = z.record(z.string(), z.string())
const MS_PER_MINUTE = 60_000

function parse_workspace(workspace_content: string): unknown {
	try {
		return yaml_document.parse_yaml(workspace_content)
	} catch {
		return undefined
	}
}

// The window `pnpm-workspace.yaml` content declares, or nothing when it does not declare one or the
// document is malformed — an explicit `minimumReleaseAge: 0` stays 0 rather than collapsing into
// "not declared".
function parse_declared_minimum_release_age(workspace_content: string): number | undefined {
	const parsed = workspace_age_schema.safeParse(parse_workspace(workspace_content))

	return parsed.success ? parsed.data.minimumReleaseAge : undefined
}

// The quarantine window in minutes from `pnpm-workspace.yaml`; a missing or malformed entry means
// no quarantine, matching pnpm's own default for the setting.
function parse_minimum_release_age(workspace_content: string): number {
	return parse_declared_minimum_release_age(workspace_content) ?? NO_QUARANTINE_MINUTES
}

// Stable releases only, on the requested major, published at or before the cutoff. The
// registry's `time` object also carries `created` / `modified` keys and prereleases; both
// fall out via the semver checks.
// An undefined major matches every line; a defined one pins the search to that major.
function is_on_major(version: string, major: string | undefined): boolean {
	return major === undefined || String(semver.major(version)) === major
}

function is_eligible(
	version: string,
	published_at: string,
	major: string | undefined,
	cutoff_ms: number,
): boolean {
	if (
		semver.valid(version) === null ||
		semver.prerelease(version) !== null ||
		!is_on_major(version, major)
	) {
		return false
	}

	const published_ms = Date.parse(published_at)

	return Number.isFinite(published_ms) && published_ms <= cutoff_ms
}

// The newest release on the major that has aged past the quarantine window, or undefined
// when none qualifies. Pure: identical inputs give the identical answer regardless of how
// the surrounding process was launched.
// `major` pins the search to one major line — what `josh latest` needs, since corepack validates the
// resolved pnpm version against `devEngines`. Pass `undefined` to search every major, which is what
// an "is this installable at all" question wants: `pnpm add pkg@latest` resolves to the newest
// permitted release regardless of major.
function select_aged_version(
	times: Record<string, string>,
	major: string | undefined,
	minimum_age_minutes: number,
	now_ms: number,
): string | undefined {
	const cutoff_ms = now_ms - minimum_age_minutes * MS_PER_MINUTE
	// cspell:ignore rcompare -- semver's reverse-compare API, newest first
	const eligible = Object.entries(times)
		.filter(([version, published_at]) => is_eligible(version, published_at, major, cutoff_ms))
		.map(([version]) => version)
		.toSorted(semver.rcompare)

	return eligible[0]
}

// The window declared in one `pnpm-workspace.yaml`, or nothing when the file is absent, unreadable,
// or does not declare the setting. Distinguishing "not declared" from "declared as 0" is what lets an
// explicit `minimumReleaseAge: 0` opt-out stop the walk instead of falling through to an ancestor's.
function read_declared_minimum_release_age(workspace_path: string): number | undefined {
	try {
		return parse_declared_minimum_release_age(readFileSync(workspace_path, 'utf8'))
	} catch {
		return undefined
	}
}

// The quarantine window declared by one specific `pnpm-workspace.yaml`, defaulting to the project's
// own. An absent, unreadable, or undeclared setting means no quarantine — the policy is advisory,
// and a project without one is not held back.
//
// Deliberately not the upward walk below: `josh latest` resolves this against the working directory
// it also writes `corepack use` into, and honouring an ancestor's policy there could freeze pnpm
// bumps in a project that declares none.
function read_minimum_release_age(workspace_path: string = WORKSPACE_PATH): number {
	return read_declared_minimum_release_age(workspace_path) ?? NO_QUARANTINE_MINUTES
}

// The window declared by the nearest `pnpm-workspace.yaml` at or above `start`, or nothing.
//
// This walks rather than reading one path because `josh version` and `josh latest` both run from
// anywhere inside a project — and from outside one — so resolving against the working directory
// alone would silently read "no quarantine" in every subdirectory. pnpm
// finds its workspace root the same way, by walking up to the nearest `pnpm-workspace.yaml`.
//
// `boundary` stops the walk at a known root. Production passes none, while tests bound the search
// so it cannot depend on the directories above the machine's temp root.
//
// Simplification: a nearer workspace file that does not declare the window falls through to an
// ancestor's, and pnpm's user-level `config.yaml` is not consulted. The consequence is one
// informational `Held:` line — the value never suppresses a command — so modelling pnpm's exact
// lookup is not worth its complexity here.
function find_declared_minimum_release_age(
	start: string,
	boundary: string | undefined,
): number | undefined {
	const declared = read_declared_minimum_release_age(path.join(start, WORKSPACE_PATH))
	if (declared !== undefined) return declared
	if (start === boundary) return undefined
	const parent = path.dirname(start)

	return parent === start ? undefined : find_declared_minimum_release_age(parent, boundary)
}

// The quarantine window resolved by walking up from a starting directory. An absent or undeclared
// policy means no quarantine — it is advisory, and a project without one is not held back.
function read_nearest_minimum_release_age(start: string, boundary?: string): number {
	return find_declared_minimum_release_age(path.resolve(start), boundary) ?? NO_QUARANTINE_MINUTES
}

const release_age = {
	release_times_schema,
	parse_minimum_release_age,
	parse_declared_minimum_release_age,
	read_minimum_release_age,
	read_nearest_minimum_release_age,
	select_aged_version,
}

export { release_age }
