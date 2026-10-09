import { existsSync } from 'node:fs'
import path from 'node:path'
import { stripVTControlCharacters } from 'node:util'
import { buffered_process } from '#scripts/lib/buffered-process'
import { INSTALL_TIMEOUT_MS } from '#scripts/lib/timeouts'

// A lock file that no longer matches its inputs, asked before the gate.
//
// The pre-push hook's setup runs `pnpm install`, which rewrites a lock that has drifted — a
// `.pnpmfile.mjs` edit moves `pnpmfileChecksum` — and so leaves the working tree dirty under the push.
// The hook then refuses the gate's record and re-runs the whole unit suite, long enough under a crowded
// machine to time the push out. The frozen, lock-only install answers the same question without
// writing anything or touching `node_modules`, in about a third of a second.
//
// A project with no lock file has nothing to drift, so nothing is asked there.
//
// **pnpm's own error line rides along**: the install refuses for reasons other than drift too — an
// engine mismatch, a timeout on a crowded machine — and there "run `pnpm install`" fixes nothing, so
// the reader needs pnpm's error code to tell the two apart. The line naming an `ERR_PNPM_` code wins
// over the first line, which in a workspace is pnpm's "Scope: all N workspace projects" banner.

const LOCK_FILE = 'pnpm-lock.yaml'
const PNPM_ERROR_CODE = 'ERR_PNPM_'
const LOCK_CHECK_ARGUMENTS = ['install', '--frozen-lockfile', '--lockfile-only', '--ignore-scripts']
const LOCK_DRIFT = `${LOCK_FILE} does not match its inputs (\`pnpm install --frozen-lockfile\` refuses it), so the pre-push hook's install would rewrite it under the push: run \`pnpm install\` and commit ${LOCK_FILE}.`

function drift_problem(output: string): string {
	const lines = stripVTControlCharacters(output)
		.split('\n')
		.map((line) => line.trim())
		.filter((line) => line !== '')
	const reason = lines.find((line) => line.includes(PNPM_ERROR_CODE)) ?? lines[0]

	return reason === undefined ? LOCK_DRIFT : `${LOCK_DRIFT} pnpm said: ${reason}`
}

async function lock_problems(directory: string = process.cwd()): Promise<Array<string>> {
	if (!existsSync(path.join(directory, LOCK_FILE))) return []

	const result = await buffered_process.run_buffered_process(LOCK_CHECK_ARGUMENTS, {
		cwd: directory,
		timeout_ms: INSTALL_TIMEOUT_MS,
	})

	return buffered_process.is_process_failed(result) ? [drift_problem(result.output)] : []
}

const run_ship_lock = { LOCK_CHECK_ARGUMENTS, LOCK_DRIFT, lock_problems }

export { run_ship_lock }
