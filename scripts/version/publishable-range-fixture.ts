import type { ProbeResult } from './publishable-range'

// The two probe outcomes `pnpm view <name>@<range> version` actually produces: a version on stdout
// when something visible satisfies the range, and an empty stdout with a non-zero exit when the
// supply-chain guard hides every candidate (ERR_PNPM_PACKAGE_NOT_FOUND). Shared so the logic tests
// and the CLI tests assert against the same shape rather than two drifting copies.
const SAFE_CHAIN_NOTICE =
	'ℹ Safe-chain: Some package versions were suppressed due to minimum age requirement.\n'

const RESOLVED_PROBE: ProbeResult = { exit_code: 0, stdout: `4.23.4\n${SAFE_CHAIN_NOTICE}` }
const SUPPRESSED_PROBE: ProbeResult = {
	exit_code: 1,
	stdout: `[ERR_PNPM_PACKAGE_NOT_FOUND] No matching version found for tsx@^4.23.5\n${SAFE_CHAIN_NOTICE}`,
}

const SUPPRESSED_NAME = 'tsx'
const SUPPRESSED_RANGE = '^4.23.5'

const WORKSPACE_NAME = '@local/shared'
const WORKSPACE_RANGE = 'workspace:*'

// Mirrors the manifest that shipped the defect: one range whose floor the guard still withholds,
// one that resolves, a devDependency that must stay out of the check, and a workspace protocol the
// registry cannot answer for — ordinary in the consumer repos that also run this guard.
const MANIFEST_FIXTURE = JSON.stringify({
	dependencies: {
		semver: '^7.8.5',
		[SUPPRESSED_NAME]: SUPPRESSED_RANGE,
		[WORKSPACE_NAME]: WORKSPACE_RANGE,
	},
	devDependencies: { vitest: '^4.1.10' },
})

/** Answers as the registry does while `tsx@^4.23.5` is withheld and everything else resolves. */
function probe_with_one_suppressed(name: string): ProbeResult {
	return name === SUPPRESSED_NAME ? SUPPRESSED_PROBE : RESOLVED_PROBE
}

export {
	MANIFEST_FIXTURE,
	probe_with_one_suppressed,
	RESOLVED_PROBE,
	SAFE_CHAIN_NOTICE,
	SUPPRESSED_NAME,
	SUPPRESSED_PROBE,
	SUPPRESSED_RANGE,
	WORKSPACE_NAME,
	WORKSPACE_RANGE,
}
