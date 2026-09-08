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
const STAGING_SUFFIX = '.download'
const FAILURE_STAMP_PREFIX = 'josh-audit-provision-'
const FORCE_FLAG = '--force'
const PATH_LOCATION = 'on PATH'
const { DOWNLOAD_TIMEOUT_MS, RETRY_INTERVAL_MS } = security_audit_provision_logic

// `content` absent is the failure; `status` is carried either way so the reason names it. A 404 —
// what a bumped version whose asset was renamed looks like, and the one failure that never fixes
// itself — would otherwise read exactly like a transient 503.
interface DownloadOutcome {
	content?: Buffer
	status: number
}

interface ProvisionOutcome {
	message: string
	is_installed: boolean
}

async function download(url: string): Promise<DownloadOutcome> {
	const response = await fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) })
	if (!response.ok) return { status: response.status }

	return { content: Buffer.from(await response.arrayBuffer()), status: response.status }
}

// Staged beside the target and renamed onto it, under a name carrying this process's id. A download
// interrupted halfway would otherwise leave a truncated file at the path `josh audit` spawns; and a
// shared staging name would let two sessions of the same project — the `SessionStart` matcher is
// empty, so a `clear` during a startup's download is exactly that — interleave their writes into one
// file that both then rename into place, which the checksum cannot catch because it was verified
// against each process's own buffer. The `finally` removes the staging file on every failing path.
function install(target_path: string, content: Buffer): void {
	const staging_path = `${target_path}.${String(process.pid)}${STAGING_SUFFIX}`

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

async function provision(target_path: string, asset: ScannerAsset): Promise<ProvisionOutcome> {
	const { format_checksum_mismatch, format_download_failure, format_installed } =
		security_audit_provision_logic
	const outcome = await download(asset.url)

	if (outcome.content === undefined) {
		const reason = `HTTP ${String(outcome.status)}`

		return { is_installed: false, message: format_download_failure(asset.url, reason) }
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
async function attempt(target_path: string, asset: ScannerAsset): Promise<string> {
	try {
		const outcome = await provision(target_path, asset)

		return outcome.is_installed ? outcome.message : record_failure(target_path, outcome.message)
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error)

		return record_failure(
			target_path,
			security_audit_provision_logic.format_provision_error(reason),
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

	return await attempt(target_path, asset)
}

// Every failure is a printed line and a zero exit, deliberately: this runs at session start, and a
// non-zero exit there would take an agent's whole session away over a tool it does not need yet.
// The audit's own gate is unchanged — a scanner that never arrived still fails the pre-push run.
async function main(): Promise<void> {
	const is_forced = process.argv.includes(FORCE_FLAG)

	try {
		console.info(await report(PROJECT_ROOT, process.platform, process.arch, is_forced))
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error)

		console.warn(security_audit_provision_logic.format_provision_error(reason))
	}
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main()

const security_audit_provision = { download, install, main, provision, report }

export { security_audit_provision }
