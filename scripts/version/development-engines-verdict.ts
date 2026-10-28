import { readFileSync } from 'node:fs'
import { isDeepStrictEqual } from 'node:util'
import { git_spawn_sync } from '#scripts/git/git-spawn-sync'
import { PACKAGE_JSON } from '#scripts/lib/package-manifest'
import { z } from 'zod'
import { package_manager_version } from './package-manager-version'

// The `devEngines` verdict a dependency update is judged by (`.claude/skills/dependency-update`):
// the committed manifest against the working tree, printed as one line so nobody compares the two
// strings by eye. `kept` is the lockstep pnpm bump — the version equal to the `packageManager` pin,
// integrity suffix included — and `josh sync`'s `onFail` move from `error` to `download`; any other
// change is `restore`, with the reason in brackets.
const HEAD_PACKAGE_JSON = `HEAD:./${PACKAGE_JSON}`
const NOT_JUDGED = `devEngines: not judged (no ${PACKAGE_JSON} at HEAD to compare against)`
const PACKAGE_MANAGER_KEY = 'packageManager'
const VERSION_KEY = 'version'
const ON_FAIL_KEY = 'onFail'
const ON_FAIL_FROM = 'error'
const ON_FAIL_TO = 'download'
const UNCHANGED = 'devEngines: unchanged'
const KEPT = 'devEngines: kept'
const SUFFIX_MISSING = 'integrity suffix missing'
const NO_PIN = 'no pnpm@ packageManager pin to match'

type Entries = Record<string, unknown>

const entries_schema = z.record(z.string(), z.unknown())
const manifest_schema = z.looseObject({
	packageManager: z.string().default(''),
	devEngines: entries_schema.default({}),
})

type Manifest = z.infer<typeof manifest_schema>

function read_manifest(content: string): Manifest {
	return manifest_schema.parse(JSON.parse(content))
}

function is_entries(value: unknown): value is Entries {
	return entries_schema.safeParse(value).success
}

function read_package_manager(development_engines: Entries): Entries {
	const value = development_engines[PACKAGE_MANAGER_KEY]

	return is_entries(value) ? value : {}
}

// `packageManager` is compared key by key only when both sides are objects; the npm array form, or
// a block added or removed whole, is a structural change in itself.
function is_compared_inside(key: string, before: Entries, after: Entries): boolean {
	return key === PACKAGE_MANAGER_KEY && is_entries(before[key]) && is_entries(after[key])
}

function changed_keys(before: Entries, after: Entries): Array<string> {
	const keys = new Set([...Object.keys(before), ...Object.keys(after)])

	return [...keys].filter((key) => !isDeepStrictEqual(before[key], after[key]))
}

// The version is judged against the pin below, so only its presence counts here.
function is_expected_change(key: string, before: Entries, after: Entries): boolean {
	if (key === VERSION_KEY) return typeof after[key] === 'string'

	return key === ON_FAIL_KEY && before[key] === ON_FAIL_FROM && after[key] === ON_FAIL_TO
}

function find_structure_change(before: Entries, after: Entries): string | undefined {
	const outer = changed_keys(before, after).filter((key) => !is_compared_inside(key, before, after))
	const pm_before = read_package_manager(before)
	const pm_after = read_package_manager(after)
	const inner = changed_keys(pm_before, pm_after).filter(
		(key) => !is_expected_change(key, pm_before, pm_after),
	)
	const keys = [...outer, ...inner.map((key) => `${PACKAGE_MANAGER_KEY}.${key}`)]

	return keys.length === 0 ? undefined : `structure changed: ${keys.join(', ')}`
}

// Without a `pnpm@` pin there is nothing the version could be kept in lockstep with.
function find_version_mismatch(after: Manifest): string | undefined {
	const pin = package_manager_version.extract_pnpm_pin(after.packageManager)
	if (pin === undefined) return NO_PIN
	const current = String(read_package_manager(after.devEngines)[VERSION_KEY])
	if (current === pin) return undefined
	if (pin.startsWith(`${current}+`)) return SUFFIX_MISSING

	return `version ${current} is not the packageManager pin ${pin}`
}

function judge(before_content: string, after_content: string): string {
	const before = read_manifest(before_content).devEngines
	const after = read_manifest(after_content)
	if (isDeepStrictEqual(before, after.devEngines)) return UNCHANGED
	const reason = find_structure_change(before, after.devEngines) ?? find_version_mismatch(after)

	return reason === undefined ? KEPT : `devEngines: restore (${reason})`
}

// A manifest that does not parse is answered apart from every verdict rather than thrown, so the
// overrides check that follows still runs.
function judge_or_explain(head: string, current: string): string {
	try {
		return judge(head, current)
	} catch (error) {
		return `devEngines: not judged (${PACKAGE_JSON} unreadable: ${String(error)})`
	}
}

function describe(head: string | undefined, current: string): string {
	return head === undefined ? NOT_JUDGED : judge_or_explain(head, current)
}

// A `git show` that fails — no commit yet, no repository — answers apart from every verdict, so it
// never reads as a `devEngines` block the update added.
function report(): void {
	const head = git_spawn_sync.read(['show', HEAD_PACKAGE_JSON])

	console.info(describe(head, readFileSync(PACKAGE_JSON, 'utf8')))
}

const development_engines_verdict = { judge, describe, report }

export { development_engines_verdict }
