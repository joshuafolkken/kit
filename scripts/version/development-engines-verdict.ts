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

type Entries = Record<string, unknown>

const entries_schema = z.record(z.string(), z.unknown())
const manifest_schema = z.looseObject({ devEngines: entries_schema.optional() })

function read_development_engines(content: string): Entries {
	return manifest_schema.parse(JSON.parse(content)).devEngines ?? {}
}

function read_package_manager(development_engines: Entries): Entries {
	return entries_schema.safeParse(development_engines[PACKAGE_MANAGER_KEY]).data ?? {}
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
	const outer = changed_keys(before, after).filter((key) => key !== PACKAGE_MANAGER_KEY)
	const pm_before = read_package_manager(before)
	const pm_after = read_package_manager(after)
	const inner = changed_keys(pm_before, pm_after).filter(
		(key) => !is_expected_change(key, pm_before, pm_after),
	)
	const keys = [...outer, ...inner.map((key) => `${PACKAGE_MANAGER_KEY}.${key}`)]

	return keys.length === 0 ? undefined : `structure changed: ${keys.join(', ')}`
}

function find_version_mismatch(after_content: string, after: Entries): string | undefined {
	const target = package_manager_version.find_alignment_target(after_content)
	if (target === undefined) return undefined
	const current = String(read_package_manager(after)[VERSION_KEY])
	if (target.startsWith(`${current}+`)) return SUFFIX_MISSING

	return `version ${current} is not the packageManager pin ${target}`
}

function judge(before_content: string, after_content: string): string {
	const before = read_development_engines(before_content)
	const after = read_development_engines(after_content)
	if (isDeepStrictEqual(before, after)) return UNCHANGED
	const reason = find_structure_change(before, after) ?? find_version_mismatch(after_content, after)

	return reason === undefined ? KEPT : `devEngines: restore (${reason})`
}

function describe(head: string | undefined, current: string): string {
	return head === undefined ? NOT_JUDGED : judge(head, current)
}

// A `git show` that fails — no commit yet, no repository — answers apart from every verdict, so it
// never reads as a `devEngines` block the update added.
function report(): void {
	const head = git_spawn_sync.read(['show', HEAD_PACKAGE_JSON])

	console.info(describe(head, readFileSync(PACKAGE_JSON, 'utf8')))
}

const development_engines_verdict = { judge, describe, report }

export { development_engines_verdict }
