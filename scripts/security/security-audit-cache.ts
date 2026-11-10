import { createHash } from 'node:crypto'
import { mkdirSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { core_budget } from '#scripts/gate/core-budget'
import { git_common_directory } from '#scripts/git/git-common-directory'
import { PROJECT_ROOT } from '#scripts/init/init-paths'
import { file_reader } from '#scripts/lib/read-file'
import { MS_PER_MINUTE } from '#scripts/lib/timeouts'
import { security_audit } from './security-audit'
import { security_audit_logic } from './security-audit-logic'

// The `josh audit` run behind a record of the last clean scan of each lockfile
// (joshuafolkken/kit#7146). The pre-push hook scanned on every push though the lockfile rarely
// changes; a lockfile whose clean scan is younger than the lifetime is not scanned again. **The
// record expires** so a vulnerability published since the scan is still caught within a day.
//
// A record is an empty file named after the lockfile's digest, its modification time the scan's, in
// the common git directory — every work tree of the repository shares it, so a lane pushing the
// lockfile its parent already scanned skips too. A failed scan records nothing, and its exit code and
// output are the scanner's own. **A below-floor scanner's clean exit records nothing either**:
// `security-audit.ts` calls it no proof, and a record would skip the upgraded scanner for a day.

const PASS_DIRECTORY = 'audit-pass'
// Outside a repository only, as `rule-value-cache.ts` keeps its reading.
const FALLBACK_DIRECTORY = ['node_modules', '.cache', 'josh']
const DIGEST_ALGORITHM = 'sha256'
const MINUTES_PER_HOUR = 60
const PASS_LIFETIME_HOURS = 24
const PASS_LIFETIME_MS = PASS_LIFETIME_HOURS * MINUTES_PER_HOUR * MS_PER_MINUTE
// A conservative reservation for the single-process scan, not a measurement (joshuafolkken/kit#2351):
// eight lanes auditing as they pushed spiked a machine the gate thought it had to itself.
const AUDIT_CORE_WEIGHT = 1
const AUDIT_COMMAND = 'audit'
const SUCCESS_EXIT_CODE = 0

interface AuditPorts {
	root: string
	now: () => number
	audit: () => Promise<number>
	is_trusted: () => boolean
}

function pass_directory(root: string): string {
	const common = git_common_directory.repository(root)

	if (common === undefined) return path.join(root, ...FALLBACK_DIRECTORY, PASS_DIRECTORY)

	return path.join(common, git_common_directory.STATE_DIRECTORY, PASS_DIRECTORY)
}

function lockfile_digest(root: string): string | undefined {
	const lockfile = path.join(root, security_audit_logic.LOCKFILE_PATH)
	const content = file_reader.read_if_readable(lockfile)

	return content === undefined
		? undefined
		: createHash(DIGEST_ALGORITHM).update(content).digest('hex')
}

function passed_at(record: string): number | undefined {
	try {
		return statSync(record).mtimeMs
	} catch {
		return undefined
	}
}

function is_live(passed: number | undefined, now_ms: number): passed is number {
	return passed !== undefined && now_ms - passed < PASS_LIFETIME_MS
}

function prune_expired(directory: string, now_ms: number): void {
	for (const name of readdirSync(directory)) {
		const record = path.join(directory, name)

		if (!is_live(passed_at(record), now_ms)) rmSync(record, { force: true })
	}
}

// **A record that cannot be written costs the next push a scan, never this one its result**, so a
// write failure is dropped rather than turning a clean scan into a failed audit.
function record_pass(directory: string, digest: string, now_ms: number): void {
	try {
		mkdirSync(directory, { recursive: true })
		prune_expired(directory, now_ms)
		const record = path.join(directory, digest)
		const stamp = new Date(now_ms)

		writeFileSync(record, '')
		utimesSync(record, stamp, stamp)
	} catch {
		// The next push scans again.
	}
}

function format_skip(passed_ms: number): string {
	const { LOCKFILE_PATH } = security_audit_logic
	const scanned = new Date(passed_ms).toISOString()
	const lifetime = `${String(PASS_LIFETIME_HOURS)}h`

	return `✔ audit skipped — ${LOCKFILE_PATH} unchanged since its clean scan at ${scanned} (scanned again after ${lifetime})`
}

// The scanner runs synchronously; the reservation takes a step that answers a promise.
async function scan(): Promise<number> {
	return security_audit.run()
}

// The pre-push hook calls `josh audit` directly rather than through `josh reserved-run`, so pnpm starts
// once; the scan takes its place in the core budget here, after a skip that needs no place.
async function reserved_audit(): Promise<number> {
	return await core_budget.with_command_reservation(AUDIT_CORE_WEIGHT, scan, {
		command: AUDIT_COMMAND,
	})
}

function is_scanner_trusted(): boolean {
	return security_audit.resolve_scanner(PROJECT_ROOT, process.platform)?.is_below_floor === false
}

const DEFAULT_PORTS: AuditPorts = {
	root: PROJECT_ROOT,
	now: Date.now,
	audit: reserved_audit,
	is_trusted: is_scanner_trusted,
}

async function scan_and_record(
	ports: AuditPorts,
	directory: string,
	digest: string,
): Promise<number> {
	const exit_code = await ports.audit()
	const is_clean = exit_code === SUCCESS_EXIT_CODE

	if (is_clean && ports.is_trusted()) record_pass(directory, digest, ports.now())

	return exit_code
}

// The `josh audit` run: a one-line skip on a live record of this lockfile, else the scan.
async function run(ports: AuditPorts = DEFAULT_PORTS): Promise<number> {
	const digest = lockfile_digest(ports.root)
	if (digest === undefined) return await ports.audit()
	const directory = pass_directory(ports.root)
	const passed = passed_at(path.join(directory, digest))

	if (!is_live(passed, ports.now())) return await scan_and_record(ports, directory, digest)
	console.info(format_skip(passed))

	return SUCCESS_EXIT_CODE
}

const security_audit_cache = { PASS_LIFETIME_MS, pass_directory, reserved_audit, run }

export type { AuditPorts }
export { security_audit_cache }
