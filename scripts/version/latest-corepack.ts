#!/usr/bin/env tsx
/**
 * Bump pnpm via `corepack use` to the newest release on the project's CURRENT major.
 *
 * The target version is resolved from the registry's publish timestamps
 * (`pnpm view pnpm time --json`) instead of a dist-tag, because pnpm publishes its
 * per-major tag `latest-<major>` only for SUPERSEDED majors — while <major> is the newest
 * major, the only tag covering it is `latest` (kit#750). The former `latest-<major>` pin
 * (kit#444) therefore failed on every run in the common case, and `latest` itself can
 * momentarily point below the devEngines floor. Picking the newest registry version whose
 * major equals the `packageManager` pin keeps both invariants: never below the adopted
 * major, and advancing while that major is the current one.
 *
 * The `minimum-release-age` quarantine is applied natively from `.npmrc` (kit#768).
 * safe-chain filters the registry only when the process tree was launched through one of
 * its wrapped shell commands, so `josh latest` and `pnpm josh latest` used to resolve
 * different answers and the pin oscillated. Reading the window from the repo-managed
 * `.npmrc` and filtering by publish timestamp makes the resolution identical in every
 * invocation context; right after a pnpm release the answer is simply the previous
 * release, exactly as the filtered view behaved.
 *
 * The resolved version is floored at the current `packageManager` pin: a filtered registry
 * view legitimately answers below a freshly adopted pin for the first 24 hours after every
 * pnpm release, and writing that answer would downgrade the protected toolchain pin
 * (kit#766). Not-newer answers skip the bump non-fatally instead.
 *
 * `devEngines.packageManager.version` is realigned with the `packageManager` pin on every
 * path — bumped, skipped, or unresolvable (kit#773). Alignment used to run only after a
 * successful bump, which never fires in the steady state of an up-to-date repository, so a
 * manifest that arrived with the two fields out of step kept the pnpm dual-declaration
 * warning forever. The alignment is idempotent, so running it unconditionally is free.
 *
 * Registry and corepack failures stay non-fatal: they are logged and swallowed (exit 0)
 * so the rest of the `josh latest` chain (`latest:update`, `audit`) keeps running.
 *
 * Usage: tsx scripts/version/latest-corepack.ts
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { execaSync } from 'execa'
import semver from 'semver'
import { z } from 'zod'
import { package_manager_version } from './package-manager-version'
import { safe_json_parse } from './parse-json'
import { release_age } from './release-age'

const PACKAGE_JSON_PATH = 'package.json'
const NPMRC_PATH = '.npmrc'
const PACKAGE_MANAGER_RE = /"packageManager"\s*:\s*"pnpm@(\d+)(?:[^\d]|$)/u
const PINNED_VERSION_RE = /"packageManager"\s*:\s*"pnpm@([^"+]+)/u
const TARGET_PREFIX = 'pnpm@'
const FALLBACK_TARGET = 'pnpm@latest'
const FAILURE_EXIT_CODE = 1
const VIEW_TIMEOUT_MS = 30_000
const NO_QUARANTINE_FALLBACK = 0
const release_times_schema = z.record(z.string(), z.string())

function extract_pnpm_major(package_json_content: string): string | undefined {
	return PACKAGE_MANAGER_RE.exec(package_json_content)?.[1]
}

// The full pinned version (e.g. 11.20.0), stripped of the `+sha512…` integrity suffix.
// Returns undefined for an absent pin or a bare-major shorthand (`pnpm@11`) — neither can
// anchor a comparison, so the floor below simply does not apply.
function extract_pinned_version(package_json_content: string): string | undefined {
	const raw = PINNED_VERSION_RE.exec(package_json_content)?.[1]
	if (raw === undefined || semver.valid(raw) === null) return undefined

	return raw
}

// Never move the pin backwards. A filtered registry view (safe-chain's minimum-release-age
// proxy) answers below a freshly adopted pin for 24 hours after every pnpm release, and an
// equal answer would only rewrite the same value — both skip instead (kit#766).
function is_target_not_newer_than_pin(target: string, pinned_version: string | undefined): boolean {
	if (pinned_version === undefined) return false
	const target_version = target.slice(TARGET_PREFIX.length)
	if (semver.valid(target_version) === null) return false

	return semver.lte(target_version, pinned_version)
}

// `pnpm view` shares stdout with non-JSON noise (the safe-chain age-filter notice prints
// there too), so cut the payload down to the outermost braces before parsing.
function extract_times_json(stdout: string): Record<string, string> | undefined {
	const start = stdout.indexOf('{')
	const end = stdout.lastIndexOf('}')
	if (start === -1 || end <= start) return undefined
	const parsed = release_times_schema.safeParse(safe_json_parse(stdout.slice(start, end + 1)))

	return parsed.success ? parsed.data : undefined
}

// The registry's publish timestamps for every pnpm release (version → ISO date, plus the
// created/modified bookkeeping keys the selector ignores).
function query_release_times(): Record<string, string> | undefined {
	const result = execaSync('pnpm', ['view', 'pnpm', 'time', '--json'], {
		reject: false,
		timeout: VIEW_TIMEOUT_MS,
	})
	if ((result.exitCode ?? FAILURE_EXIT_CODE) !== 0) return undefined

	return extract_times_json(result.stdout)
}

// The quarantine window from the repo-managed `.npmrc`; an unreadable file means no
// quarantine, same as a missing setting.
function read_minimum_release_age(): number {
	try {
		return release_age.parse_minimum_release_age(readFileSync(NPMRC_PATH, 'utf8'))
	} catch {
		return NO_QUARANTINE_FALLBACK
	}
}

// Ask the registry for the newest pnpm release on the pinned major that has aged past the
// quarantine window. Returns undefined when the query fails or nothing qualifies yet.
function query_major_latest_version(major: string): string | undefined {
	const times = query_release_times()
	if (times === undefined) return undefined

	return release_age.select_aged_version(times, major, read_minimum_release_age(), Date.now())
}

// The value handed to `corepack use`: an exact registry-resolved version on the pinned
// major, `pnpm@latest` when no major can be read from package.json, or undefined when
// the registry could not answer (the caller skips non-fatally).
function resolve_corepack_target(major: string | undefined): string | undefined {
	if (major === undefined) return FALLBACK_TARGET
	const version = query_major_latest_version(major)
	if (version === undefined) return undefined

	return `pnpm@${version}`
}

// Non-fatal skip message shared by both skip paths: keep the josh latest chain
// (latest:update, audit) running instead of aborting on a bump failure.
function warn_skip(reason: string): void {
	console.warn(`⚠ Skipped pnpm bump (${reason}); the chain continues.`)
}

function warn_unresolved(major: string | undefined): void {
	warn_skip(`no pnpm ${major ?? ''} release resolvable from the registry`)
}

function run_corepack(target: string): number {
	console.info(`\n▶ corepack use ${target}`)
	const result = execaSync('corepack', ['use', target], { stdio: 'inherit', reject: false })

	return result.exitCode ?? FAILURE_EXIT_CODE
}

// The target is an already-resolved exact version, so a non-zero status here is a
// genuine corepack or network failure; a later run retries. Returns whether a skip
// happened.
function did_warn_skip(status: number): boolean {
	if (status === 0) return false

	warn_skip(`corepack exited ${String(status)}`)

	return true
}

// Realign `devEngines.packageManager.version` with the `packageManager` pin so the two
// fields keep matching (pnpm suppresses the dual-declaration warning only on an exact
// match). Runs on every path, not just after a successful bump: a repository that arrives
// with the two fields already out of step sits in the no-bump steady state forever, so an
// alignment gated on a bump would never repair it (kit#773).
function sync_development_engines(package_json_path: string = PACKAGE_JSON_PATH): void {
	const content = readFileSync(package_json_path, 'utf8')
	const aligned = package_manager_version.align_development_engines_version(content)
	if (aligned === content) return

	writeFileSync(package_json_path, aligned)
	console.info('✔ Synced devEngines.packageManager.version to the packageManager pin')
}

// `corepack use` validates the resolved version against `devEngines` BEFORE it
// writes `packageManager`, so an exact pin (e.g. 11.5.0) rejects a newer patch
// (11.5.2) and the bump can never advance. Temporarily widen the pin to the bare
// major (a range the new patch satisfies) so corepack proceeds; the exact pin is
// restored afterwards by restore_package_json (on skip) and by the unconditional
// sync_development_engines that closes main(). Returns whether the file was rewritten.
function did_widen_development_engines(
	content: string,
	major: string | undefined,
	package_json_path: string = PACKAGE_JSON_PATH,
): boolean {
	if (major === undefined) return false
	const widened = package_manager_version.set_development_engines_version(content, major)
	if (widened === content) return false

	writeFileSync(package_json_path, widened)

	return true
}

// Roll the temporary widening back when corepack skipped the bump, restoring
// package.json to its pre-run state; the alignment closing main() then repairs any
// devEngines drift that state carried in.
function restore_package_json(
	content: string,
	package_json_path: string = PACKAGE_JSON_PATH,
): void {
	writeFileSync(package_json_path, content)
	console.info('✔ Restored package.json devEngines pin (pnpm bump skipped)')
}

// The equal case is the steady state of every up-to-date run, so it logs as success; only
// an answer strictly below the pin is the anomaly worth a warning (kit#766).
function notify_skipped_bump(target: string, pinned_version: string): void {
	if (target === `${TARGET_PREFIX}${pinned_version}`) {
		console.info(`✔ pnpm pin ${pinned_version} already matches the newest registry release.`)

		return
	}

	warn_skip(`registry answered ${target}, below the pinned ${pinned_version}`)
}

// Resolve the corepack target with the pin floor applied. Undefined means the bump was
// skipped and the reason has already been logged.
function resolve_floored_target(original: string, major: string | undefined): string | undefined {
	const target = resolve_corepack_target(major)

	if (target === undefined) {
		warn_unresolved(major)

		return undefined
	}

	const pinned_version = extract_pinned_version(original)
	if (!is_target_not_newer_than_pin(target, pinned_version)) return target

	notify_skipped_bump(target, pinned_version ?? '')

	return undefined
}

// Widen the devEngines pin, hand the resolved target to corepack, and roll the widening
// back when corepack skipped. Leaves the devEngines alignment to main().
function bump_package_manager(original: string, major: string | undefined, target: string): void {
	const is_widened = did_widen_development_engines(original, major)
	const is_skipped = did_warn_skip(run_corepack(target))
	if (is_skipped && is_widened) restore_package_json(original)
}

function main(): void {
	const original = readFileSync(PACKAGE_JSON_PATH, 'utf8')
	const major = extract_pnpm_major(original)
	const target = resolve_floored_target(original, major)
	if (target !== undefined) bump_package_manager(original, major, target)

	sync_development_engines()
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main()

const latest_corepack = {
	extract_pnpm_major,
	extract_pinned_version,
	is_target_not_newer_than_pin,
	notify_skipped_bump,
	extract_times_json,
	query_release_times,
	read_minimum_release_age,
	query_major_latest_version,
	resolve_corepack_target,
	warn_skip,
	warn_unresolved,
	run_corepack,
	did_warn_skip,
	sync_development_engines,
	did_widen_development_engines,
	restore_package_json,
	bump_package_manager,
	main,
}

export { latest_corepack }
