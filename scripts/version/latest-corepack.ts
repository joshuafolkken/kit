#!/usr/bin/env tsx
/**
 * Bump pnpm via `corepack use` to the newest release on the project's CURRENT major.
 *
 * The target version is resolved from the registry (`pnpm view pnpm@<major> version`)
 * instead of a dist-tag, because pnpm publishes its per-major tag `latest-<major>` only
 * for SUPERSEDED majors — while <major> is the newest major, the only tag covering it is
 * `latest` (kit#750). The former `latest-<major>` pin (kit#444) therefore failed on
 * every run in the common case, and `latest` itself can momentarily point below the
 * devEngines floor. Picking the newest registry version whose major equals the
 * `packageManager` pin keeps both invariants: never below the adopted major, and
 * advancing while that major is the current one.
 *
 * The maintenance chain runs under safe-chain, which filters the registry view by
 * `minimum-release-age`. The `pnpm view` query goes through that same filtered view, so
 * the resolved version is always old enough to install — right after a pnpm release the
 * answer is simply the previous release instead of a "Tag not found" failure.
 *
 * The resolved version is floored at the current `packageManager` pin: a filtered registry
 * view legitimately answers below a freshly adopted pin for the first 24 hours after every
 * pnpm release, and writing that answer would downgrade the protected toolchain pin
 * (kit#766). Not-newer answers skip the bump non-fatally instead.
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
import { package_manager_version } from './package-manager-version'
import { publishable_range_check } from './publishable-range-check'

const PACKAGE_JSON_PATH = 'package.json'
const PACKAGE_MANAGER_RE = /"packageManager"\s*:\s*"pnpm@(\d+)(?:[^\d]|$)/u
const PINNED_VERSION_RE = /"packageManager"\s*:\s*"pnpm@([^"+]+)/u
const TARGET_PREFIX = 'pnpm@'
const FALLBACK_TARGET = 'pnpm@latest'
const FAILURE_EXIT_CODE = 1

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

// `pnpm view` shares stdout with non-version noise (the safe-chain age-filter notice
// prints there, after the answer), so scan for the first line that is a plain version on
// the requested major instead of parsing the whole output.
function extract_version_line(stdout: string, major: string): string | undefined {
	return stdout
		.split('\n')
		.map((line: string) => line.trim())
		.find((line: string) => semver.valid(line) !== null && String(semver.major(line)) === major)
}

// Ask the registry for the newest pnpm release on the pinned major, reusing the release
// gate's probe so the safe-chain-filtered-view semantics stay single-sourced. Returns
// undefined when the query fails or answers off-major.
function query_major_latest_version(major: string): string | undefined {
	const probe = publishable_range_check.probe_range('pnpm', major)
	if (probe.exit_code !== 0) return undefined

	return extract_version_line(probe.stdout, major)
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

// After corepack bumps the `packageManager` pin, realign
// `devEngines.packageManager.version` to the new version so the two fields keep
// matching (pnpm suppresses the dual-declaration warning only on an exact match).
function sync_development_engines_after_bump(package_json_path: string = PACKAGE_JSON_PATH): void {
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
// restored afterwards by sync_development_engines_after_bump (on success) or
// restore_package_json (on skip). Returns whether the file was rewritten.
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

// Roll the temporary widening back when corepack skipped the bump, leaving
// package.json byte-for-byte identical to its pre-run state.
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

function main(): void {
	const original = readFileSync(PACKAGE_JSON_PATH, 'utf8')
	const major = extract_pnpm_major(original)
	const target = resolve_floored_target(original, major)
	if (target === undefined) return

	const is_widened = did_widen_development_engines(original, major)
	const is_skipped = did_warn_skip(run_corepack(target))
	if (is_skipped && is_widened) restore_package_json(original)
	else if (!is_skipped) sync_development_engines_after_bump()
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main()

const latest_corepack = {
	extract_pnpm_major,
	extract_pinned_version,
	is_target_not_newer_than_pin,
	notify_skipped_bump,
	extract_version_line,
	query_major_latest_version,
	resolve_corepack_target,
	warn_skip,
	warn_unresolved,
	run_corepack,
	did_warn_skip,
	sync_development_engines_after_bump,
	did_widen_development_engines,
	restore_package_json,
	main,
}

export { latest_corepack }
