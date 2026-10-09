#!/usr/bin/env tsx
/**
 * Bump pnpm via `pnpm self-update` to the newest release on the project's CURRENT major.
 *
 * The target version is resolved from the registry's publish timestamps
 * (`pnpm view pnpm time --json`) instead of a dist-tag, because pnpm publishes its
 * per-major tag `latest-<major>` only for SUPERSEDED majors — while <major> is the newest
 * major, the only tag covering it is `latest`, so a `latest-<major>` pin would fail on every
 * run in the common case, and `latest` itself can momentarily point below the devEngines
 * floor. Picking the newest registry version whose major equals the `packageManager` pin keeps
 * both invariants: never below the adopted major, and advancing while that major is the
 * current one.
 *
 * The `minimumReleaseAge` quarantine is applied natively from `pnpm-workspace.yaml`.
 * safe-chain filters the registry only when the process tree was launched through one of its
 * wrapped shell commands, so `josh latest` and `pnpm josh latest` would resolve different
 * answers and the pin would oscillate. Reading the window from the repo-managed
 * `pnpm-workspace.yaml` and filtering by publish timestamp makes the resolution identical in
 * every invocation context; right after a pnpm release the answer is simply the previous
 * release, exactly as the filtered view behaves.
 *
 * The resolved version is floored at the current `packageManager` pin: a filtered registry
 * view legitimately answers below a freshly adopted pin for the first 24 hours after every
 * pnpm release, and writing that answer would downgrade the protected toolchain pin.
 * Not-newer answers skip the bump non-fatally instead.
 *
 * `devEngines.packageManager.version` is realigned with the `packageManager` pin on every
 * path — bumped, skipped, or unresolvable. A bump never fires in the steady state of an
 * up-to-date repository, so alignment gated on one would leave a manifest that arrived with
 * the two fields out of step warning forever. The alignment is idempotent, so running it
 * unconditionally is free.
 *
 * A failed bump exits non-zero with its cause, the manifest restored — a skip would let
 * `latest:scope --record` mark the run fresh while a pnpm that could not self-update (the
 * Corepack shim refuses it) stayed pinned silently. `josh latest` runs this step
 * last, right before the record, so the dependency update and the audit still finish and only the
 * record is withheld. A registry answer not newer than the pin, or nothing aged past the
 * quarantine window yet, remains a non-fatal skip.
 *
 * Usage: tsx scripts/version/latest-corepack.ts
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { json_value } from '#scripts/lib/json-value'
import { COMMAND_TIMEOUT_MS } from '#scripts/lib/timeouts'
import { execaSync } from 'execa'
import semver from 'semver'
import { z } from 'zod'
import { package_manager_version } from './package-manager-version'
import { release_age } from './release-age'

const PACKAGE_JSON_PATH = 'package.json'
const PACKAGE_MANAGER_RE = /"packageManager"\s*:\s*"pnpm@(\d+)(?:[^\d]|$)/u
const PINNED_VERSION_RE = /"packageManager"\s*:\s*"pnpm@([^"+]+)/u
const TARGET_PREFIX = 'pnpm@'
const FAILURE_EXIT_CODE = 1
const WORKSPACE_PATH = 'pnpm-workspace.yaml'
const SHA512_BYTES = 64
const INTEGRITY_RE = /^sha512-([A-Za-z0-9+/]+={0,2})$/u
const PACKAGE_MANAGER_VALUE_RE = /("packageManager"\s*:\s*")pnpm@[^"]+(")/u

// `target` is undefined both when the registry did not answer and when it answered but nothing has
// aged past the quarantine window yet; only the first is a failure.
interface TargetResolution {
	target: string | undefined
	is_registry_reachable: boolean
}

const PNPM_DEVELOPMENT_MANAGER_SCHEMA = z.object({ name: z.literal('pnpm'), version: z.string() })
const DEV_ENGINES_SCHEMA = z.object({ packageManager: PNPM_DEVELOPMENT_MANAGER_SCHEMA })
const DEV_ENGINES_PNPM_SCHEMA = z.object({ devEngines: DEV_ENGINES_SCHEMA.optional() })
const COREPACK_REMEDY =
	'pnpm runs through the Corepack shim, where pnpm 11+ refuses self-update (ERR_PNPM_CANT_SELF_UPDATE_IN_COREPACK). Run `corepack disable pnpm`, install a standalone pnpm (https://pnpm.io/installation), run josh sync so a devEngines.packageManager.onFail of "error" becomes "download" (the standalone pnpm then fetches the pinned version), then rerun josh latest.'

function extract_development_engines_version(package_json_content: string): string | undefined {
	const parsed = DEV_ENGINES_PNPM_SCHEMA.safeParse(
		json_value.parse_or_undefined(package_json_content),
	)

	return parsed.success ? parsed.data.devEngines?.packageManager.version : undefined
}

function extract_pnpm_major(package_json_content: string): string | undefined {
	const pin_major = PACKAGE_MANAGER_RE.exec(package_json_content)?.[1]
	if (pin_major !== undefined) return pin_major
	const version = extract_development_engines_version(package_json_content)
	if (version === undefined) return undefined

	return semver.minVersion(version)?.major.toString()
}

function exact_pinned_version(raw: string | undefined): string | undefined {
	if (raw === undefined) return undefined

	return semver.valid(raw) ?? undefined
}

// The full pinned version (e.g. 11.20.0), stripped of the `+sha512…` integrity suffix.
// Returns undefined for an absent pin or a bare-major shorthand (`pnpm@11`) — neither can
// anchor a comparison, so the floor below simply does not apply.
function extract_pinned_version(package_json_content: string): string | undefined {
	const package_pin = PINNED_VERSION_RE.exec(package_json_content)?.[1]
	if (package_pin !== undefined) return exact_pinned_version(package_pin)
	const development_pin = extract_development_engines_version(package_json_content)

	return exact_pinned_version(development_pin?.split('+', 1)[0])
}

// Never move the pin backwards. A filtered registry view (safe-chain's minimum-release-age
// proxy) answers below a freshly adopted pin for 24 hours after every pnpm release, and an
// equal answer would only rewrite the same value — both skip instead.
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
	const parsed = release_age.release_times_schema.safeParse(
		json_value.parse_or_undefined(stdout.slice(start, end + 1)),
	)

	return parsed.success ? parsed.data : undefined
}

// The registry's publish timestamps for every pnpm release (version → ISO date, plus the
// created/modified bookkeeping keys the selector ignores).
function query_release_times(): Record<string, string> | undefined {
	const result = execaSync('pnpm', ['view', 'pnpm', 'time', '--json'], {
		reject: false,
		timeout: COMMAND_TIMEOUT_MS,
	})
	if ((result.exitCode ?? FAILURE_EXIT_CODE) !== 0) return undefined

	return extract_times_json(result.stdout)
}

function to_resolution(
	version: string | undefined,
	is_registry_reachable: boolean,
): TargetResolution {
	const target = version === undefined ? undefined : `${TARGET_PREFIX}${version}`

	return { target, is_registry_reachable }
}

// Ask the registry for the newest pnpm release on the pinned major that has aged past the
// quarantine window.
function resolve_major_target(major: string): TargetResolution {
	const times = query_release_times()
	if (times === undefined) return to_resolution(undefined, false)

	// The project's own `pnpm-workspace.yaml`, deliberately not the upward walk the version check
	// uses: `josh latest` reads `package.json` and writes the pnpm pin relative to the working
	// directory, so it has no subdirectory case — and honouring an ancestor's policy here could freeze
	// pnpm bumps in a project that declares none.
	const version = release_age.select_aged_version(
		times,
		major,
		release_age.read_minimum_release_age(WORKSPACE_PATH),
		Date.now(),
	)

	return to_resolution(version, true)
}

function parse_latest_version(stdout: string): string | undefined {
	const version = /"(\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?)"/u.exec(stdout)?.[1]
	if (version === undefined) return undefined

	return semver.valid(version) ?? undefined
}

function query_latest_version(): string | undefined {
	const result = execaSync('pnpm', ['view', 'pnpm', 'version', '--json'], {
		reject: false,
		timeout: COMMAND_TIMEOUT_MS,
	})
	if ((result.exitCode ?? FAILURE_EXIT_CODE) !== 0) return undefined

	return parse_latest_version(result.stdout)
}

// The target handed to pnpm self-update: an exact registry-resolved version on the pinned major, or
// the latest exact version when no major can be read from package.json. The latest-version query
// has no quarantine selection, so resolving nothing there always means the registry did not answer.
function resolve_target(major: string | undefined): TargetResolution {
	if (major !== undefined) return resolve_major_target(major)
	const version = query_latest_version()

	return to_resolution(version, version !== undefined)
}

function resolve_corepack_target(major: string | undefined): string | undefined {
	return resolve_target(major).target
}

// Non-fatal skip message for a registry answer with nothing to adopt — nothing to bump, nothing failed.
function warn_skip(reason: string): void {
	console.warn(`⚠ Skipped pnpm bump (${reason}).`)
}

// Every failure path ends here, so the exit status the `josh latest` chain stops on is one value.
function fail_bump(reason: string): number {
	console.error(
		`✖ pnpm bump failed (${reason}); the run is not recorded, so the next josh latest retries it.`,
	)

	return FAILURE_EXIT_CODE
}

// Corepack exports COREPACK_ROOT to the package manager it launches, and pnpm 11+ refuses
// `self-update` under it (ERR_PNPM_CANT_SELF_UPDATE_IN_COREPACK), so the remedy is named there.
function fail_self_update(status: number, environment: NodeJS.ProcessEnv = process.env): number {
	if (environment['COREPACK_ROOT'] !== undefined) console.error(COREPACK_REMEDY)

	return fail_bump(`pnpm self-update exited ${String(status)}`)
}

function run_pnpm_update(target: string): number {
	const version = target.slice(TARGET_PREFIX.length)

	console.info(`\n▶ pnpm self-update ${version}`)

	const result = execaSync('pnpm', ['self-update', version], { stdio: 'inherit', reject: false })

	return result.exitCode ?? FAILURE_EXIT_CODE
}

// Realign `devEngines.packageManager.version` with the `packageManager` pin so the two
// fields keep matching (pnpm suppresses the dual-declaration warning only on an exact
// match). Runs on every path, not just after a successful bump: a repository that arrives
// with the two fields already out of step sits in the no-bump steady state forever, so an
// alignment gated on a bump would never repair it.
function sync_development_engines(package_json_path: string = PACKAGE_JSON_PATH): void {
	const content = readFileSync(package_json_path, 'utf8')
	const aligned = package_manager_version.align_development_engines_version(content)
	if (aligned === content) return

	writeFileSync(package_json_path, aligned)
	console.info('✔ Synced devEngines.packageManager.version to the packageManager pin')
}

// Restore the pre-run manifest if self-update fails after changing it.
function restore_package_json(
	content: string,
	package_json_path: string = PACKAGE_JSON_PATH,
): void {
	writeFileSync(package_json_path, content)
	console.info('✔ Restored package.json pin (pnpm bump failed)')
}

function decode_integrity(encoded: string): string | undefined {
	const bytes = Buffer.from(encoded, 'base64')
	if (bytes.length !== SHA512_BYTES) return undefined
	if (bytes.toString('base64') !== encoded) return undefined

	return `sha512.${bytes.toString('hex')}`
}

function extract_encoded_integrity(stdout: string): string | undefined {
	const payload = /"sha512-[A-Za-z0-9+/]+={0,2}"/u.exec(stdout)?.[0]
	if (payload === undefined) return undefined
	const parsed: unknown = json_value.parse_or_undefined(payload)
	if (typeof parsed !== 'string') return undefined

	return INTEGRITY_RE.exec(parsed)?.[1]
}

function query_integrity(target: string): string | undefined {
	const result = execaSync('pnpm', ['view', target, 'dist.integrity', '--json'], {
		reject: false,
		timeout: COMMAND_TIMEOUT_MS,
	})
	if ((result.exitCode ?? FAILURE_EXIT_CODE) !== 0) return undefined

	const encoded = extract_encoded_integrity(result.stdout)
	if (encoded === undefined) return undefined

	return decode_integrity(encoded)
}

function restore_integrity(target: string, integrity: string): void {
	const content = readFileSync(PACKAGE_JSON_PATH, 'utf8')
	const version = target.slice(TARGET_PREFIX.length)
	const expected = `pnpm@${version}`
	const current = PACKAGE_MANAGER_VALUE_RE.exec(content)?.[0]

	if (current?.endsWith(`${expected}"`) !== true) {
		throw new Error(`pnpm self-update did not pin ${expected}`)
	}

	const pinned = content.replace(
		PACKAGE_MANAGER_VALUE_RE,
		(_match: string, prefix: string, suffix: string) => {
			return `${prefix}${expected}+${integrity}${suffix}`
		},
	)

	writeFileSync(
		PACKAGE_JSON_PATH,
		package_manager_version.align_development_engines_version(pinned),
	)
}

// The equal case is the steady state of every up-to-date run, so it logs as success; only
// an answer strictly below the pin is the anomaly worth a warning.
function notify_skipped_bump(target: string, pinned_version: string): void {
	if (target === `${TARGET_PREFIX}${pinned_version}`) {
		console.info(`✔ pnpm pin ${pinned_version} already matches the newest registry release.`)

		return
	}

	warn_skip(`registry answered ${target}, below the pinned ${pinned_version}`)
}

function restore_after_update(original: string, target: string, integrity: string): number {
	try {
		restore_integrity(target, integrity)

		return 0
	} catch {
		restore_package_json(original)

		return fail_bump('pnpm self-update wrote an unexpected pin')
	}
}

function pin_unpinned_manifest(original: string, target: string, integrity: string): number {
	const manifest = z.record(z.string(), z.unknown()).parse(json_value.parse_or_undefined(original))
	const pinned = JSON.stringify(
		{ ...manifest, packageManager: `${target}+${integrity}` },
		undefined,
		'\t',
	)

	writeFileSync(
		PACKAGE_JSON_PATH,
		package_manager_version.align_development_engines_version(`${pinned}\n`),
	)

	const result = execaSync('pnpm', ['--version'], { reject: false })
	if (result.exitCode === 0 && result.stdout.trim() === target.slice(TARGET_PREFIX.length)) return 0

	restore_package_json(original)

	return fail_bump('the newly pinned pnpm version could not start')
}

// The target is an already-resolved exact version, so a non-zero status here is a genuine
// pnpm, Corepack or network failure.
function update_pinned_manifest(original: string, target: string, integrity: string): number {
	const status = run_pnpm_update(target)
	if (status === 0) return restore_after_update(original, target, integrity)

	restore_package_json(original)

	return fail_self_update(status)
}

// Query integrity before mutating the manifest; self-update writes both pins without it.
function bump_package_manager(original: string, target: string): number {
	const integrity = query_integrity(target)
	if (integrity === undefined) return fail_bump(`no integrity for ${target}`)
	if (!PACKAGE_MANAGER_RE.test(original)) return pin_unpinned_manifest(original, target, integrity)

	return update_pinned_manifest(original, target, integrity)
}

// An unreachable registry fails, so the unrecorded run is retried. A reachable one with nothing
// aged past the quarantine window is the quarantine skip — like a not-newer answer, there is nothing
// to adopt yet, and failing would stall every run for up to the whole window.
function report_unresolved(major: string | undefined, is_registry_reachable: boolean): number {
	const label = `pnpm ${major ?? ''}`.trimEnd()
	if (!is_registry_reachable) return fail_bump(`the registry did not answer for ${label}`)

	warn_skip(`no ${label} release has aged past the quarantine window yet`)

	return 0
}

// Resolve the pnpm target with the pin floor applied, then bump.
function bump_to_registry_target(original: string, major: string | undefined): number {
	const { target, is_registry_reachable } = resolve_target(major)
	if (target === undefined) return report_unresolved(major, is_registry_reachable)

	const pinned_version = extract_pinned_version(original)

	if (!is_target_not_newer_than_pin(target, pinned_version)) {
		return bump_package_manager(original, target)
	}

	notify_skipped_bump(target, pinned_version ?? '')

	return 0
}

function main(): number {
	const original = readFileSync(PACKAGE_JSON_PATH, 'utf8')
	const status = bump_to_registry_target(original, extract_pnpm_major(original))

	sync_development_engines()

	return status
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = main()

const latest_corepack = {
	extract_pnpm_major,
	extract_pinned_version,
	is_target_not_newer_than_pin,
	notify_skipped_bump,
	extract_times_json,
	resolve_corepack_target,
	run_pnpm_update,
	query_integrity,
	restore_integrity,
	fail_self_update,
	sync_development_engines,
	restore_package_json,
	main,
}

export { latest_corepack }
