import { read_spawn_stdout } from '#scripts/lib/spawn-exit'
import { COMMAND_TIMEOUT_MS } from '#scripts/lib/timeouts'
import { execaSync } from 'execa'
import semver from 'semver'
import { safe_chain_preinstall } from './preinstall-command'

// joshuafolkken/kit#7597: `josh sync` copies `minimumReleaseAgeExclude` into the repository's
// `.aikido` (`project-config.ts`), but only safe-chain from 1.5.15 reads that file's `safe-chain:`
// section — 1.5.14 has no repository config at all. An older binary on PATH, which the shell
// integration falls back to when `~/.safe-chain/bin` is absent, keeps holding back every excluded
// package without a word.
const PROJECT_EXCLUSIONS_MIN_VERSION = '1.5.15'
const SAFE_CHAIN_BIN = 'safe-chain'

// `safe-chain --version` prints `Current safe-chain version: 1.2.2`.
function parse_version(output: string): string | undefined {
	return semver.coerce(output)?.version
}

// The version of the safe-chain on PATH, or undefined when none starts or it says nothing readable.
// A missing safe-chain is the `preinstall` warning's to report, not this one's.
function read_local_version(): string | undefined {
	const result = execaSync(SAFE_CHAIN_BIN, ['--version'], {
		reject: false,
		timeout: COMMAND_TIMEOUT_MS,
	})
	if (result.exitCode !== 0) return undefined

	return parse_version(read_spawn_stdout(result))
}

function is_stale(version: string): boolean {
	return semver.lt(version, PROJECT_EXCLUSIONS_MIN_VERSION)
}

function stale_warning(version: string): string {
	return (
		`⚠ safe-chain ${version} on PATH predates ${PROJECT_EXCLUSIONS_MIN_VERSION}, so it ignores the` +
		' `.aikido` age exclusions copied from `minimumReleaseAgeExclude` and holds back packages listed' +
		` there. Reinstall it with the hash-verified steps at ${safe_chain_preinstall.INSTALL_GUIDE_URL}`
	)
}

// Silent unless the version was read and is older than the floor: an unreadable answer is not proof
// of a stale install.
function report_local_version(): void {
	const version = read_local_version()
	if (version === undefined || !is_stale(version)) return

	console.info('')
	console.info(stale_warning(version))
}

const safe_chain_local_version = {
	PROJECT_EXCLUSIONS_MIN_VERSION,
	read_local_version,
	is_stale,
	report_local_version,
}

export { safe_chain_local_version }
