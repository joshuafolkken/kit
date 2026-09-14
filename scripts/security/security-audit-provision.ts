#!/usr/bin/env tsx
import { chmodSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PROJECT_ROOT } from '#scripts/init/init-paths'
import { stamp_file } from '#scripts/josh/stamp-file'
import { security_audit } from './security-audit'
import { security_audit_logic } from './security-audit-logic'
import { security_audit_provision_logic, type ScannerAsset } from './security-audit-provision-logic'

const EXECUTABLE_MODE = 0o755
const FAILURE_STAMP_PREFIX = 'josh-audit-provision-'
const FORCE_FLAG = '--force'
const PATH_LOCATION = 'on PATH'
const { RETRY_INTERVAL_MS } = security_audit_provision_logic

function describe_error(error: unknown): string {
	return error instanceof Error ? error.message : String(error)
}

// `content` absent is the failure, and `reason` says which one. A 404 — what a bumped version whose
// asset was renamed looks like, and the one failure that never fixes itself — would otherwise read
// exactly like a transient 503, and a rejected request like neither.
interface DownloadOutcome {
	content?: Buffer
	reason: string
}

interface ProvisionOutcome {
	message: string
	is_installed: boolean
}

// The rejection is caught here rather than left to `attempt`: being offline, behind a proxy that
// refuses the host, or past the timeout is a *fetch* failure, and reporting it through the generic
// catch-all would drop the release URL out of the message that names where the fetch went.
async function download(url: string, timeout_ms: number): Promise<DownloadOutcome> {
	try {
		const response = await fetch(url, { signal: AbortSignal.timeout(timeout_ms) })
		if (!response.ok) return { reason: `HTTP ${String(response.status)}` }

		return { content: Buffer.from(await response.arrayBuffer()), reason: '' }
	} catch (error) {
		return { reason: describe_error(error) }
	}
}

// Staged beside the target and renamed onto it, under a name carrying this process's id. A download
// interrupted halfway would otherwise leave a truncated file at the path `josh audit` spawns; and a
// shared staging name would let two sessions of the same project — the `SessionStart` matcher is
// empty, so a `clear` during a startup's download is exactly that — interleave their writes into one
// file that both then rename into place, which the checksum cannot catch because it was verified
// against each process's own buffer. The `finally` removes the staging file on every failing path.
function install(target_path: string, content: Buffer): void {
	const staging_path = security_audit_provision_logic.build_staging_path(target_path, process.pid)

	mkdirSync(path.dirname(target_path), { recursive: true })

	try {
		writeFileSync(staging_path, content)
		chmodSync(staging_path, EXECUTABLE_MODE)
		renameSync(staging_path, target_path)
	} finally {
		rmSync(staging_path, { force: true })
	}
}

function failure_stamp_path(target_path: string): string {
	return stamp_file.stamp_path(FAILURE_STAMP_PREFIX, target_path)
}

function is_in_backoff(target_path: string): boolean {
	const recorded = Number(stamp_file.read_stamp_text(failure_stamp_path(target_path)))

	return Number.isFinite(recorded) && Date.now() - recorded < RETRY_INTERVAL_MS
}

function record_failure(target_path: string, message: string): string {
	stamp_file.write_stamp(failure_stamp_path(target_path), Date.now())

	return message
}

async function provision(
	target_path: string,
	asset: ScannerAsset,
	timeout_ms: number,
): Promise<ProvisionOutcome> {
	const { format_checksum_mismatch, format_download_failure, format_installed } =
		security_audit_provision_logic
	const outcome = await download(asset.url, timeout_ms)

	if (outcome.content === undefined) {
		return { is_installed: false, message: format_download_failure(asset.url, outcome.reason) }
	}

	const actual = stamp_file.digest(outcome.content)

	if (actual !== asset.sha256) {
		return {
			is_installed: false,
			message: format_checksum_mismatch(asset.name, asset.sha256, actual),
		}
	}

	install(target_path, outcome.content)

	return { is_installed: true, message: format_installed(target_path) }
}

// The one place a failure is recorded, so the backoff covers a rejected fetch, a bad checksum and a
// write that could not land alike — every reason the next session start would otherwise repeat.
async function attempt(
	target_path: string,
	asset: ScannerAsset,
	timeout_ms: number,
): Promise<string> {
	try {
		const outcome = await provision(target_path, asset, timeout_ms)
		if (!outcome.is_installed) return record_failure(target_path, outcome.message)

		// Cleared on success, or a `pnpm install` that wipes the cache directory — which this design
		// treats as costing one re-fetch — would instead be answered by a stale record telling the
		// reader to pass `--force` for as long as the backoff runs.
		stamp_file.remove_stamp(failure_stamp_path(target_path))

		return outcome.message
	} catch (error) {
		return record_failure(
			target_path,
			security_audit_provision_logic.format_provision_error(describe_error(error)),
		)
	}
}

// PATH first, so a machine that installed the scanner itself keeps running exactly that binary.
// `is_executable_file` rather than a bare existence test: a zero-byte or non-executable file at the
// managed path would be reported here as an installed scanner for ever, while `josh audit` spawned
// it and failed with something that looks nothing like a missing binary.
function existing_scanner(target_path: string): string | undefined {
	if (security_audit.is_binary_available(security_audit_logic.BINARY_NAME)) return PATH_LOCATION

	return security_audit.is_executable_file(target_path) ? target_path : undefined
}

async function report(
	project_root: string,
	platform: string,
	architecture: string,
	is_forced: boolean,
): Promise<string> {
	const logic = security_audit_provision_logic
	const target_path = security_audit_logic.build_managed_binary_path(project_root, platform)
	const existing = existing_scanner(target_path)
	if (existing !== undefined) return logic.format_already_present(existing)

	const asset = logic.resolve_asset(platform, architecture)
	if (asset === undefined) return logic.format_unsupported_platform(platform, architecture)
	if (!is_forced && is_in_backoff(target_path)) return logic.format_recent_failure()

	return await attempt(target_path, asset, logic.build_download_timeout(is_forced))
}

// Every failure is a printed line and a zero exit, deliberately: this runs at session start, and a
// non-zero exit there would take an agent's whole session away over a tool it does not need yet.
// The audit's own gate is unchanged — a scanner that never arrived still fails the pre-push run.
async function main(): Promise<void> {
	const is_forced = process.argv.includes(FORCE_FLAG)

	try {
		console.info(await report(PROJECT_ROOT, process.platform, process.arch, is_forced))
	} catch (error) {
		console.warn(security_audit_provision_logic.format_provision_error(describe_error(error)))
	}
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main()

const security_audit_provision = { attempt, download, install, main, provision, report }

export { security_audit_provision }
