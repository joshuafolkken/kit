import type { execaSync } from 'execa'

// Shared arrangement values for the `latest:corepack` suites. Each test file still declares
// its own `vi.mock` calls (vitest hoists those per file and they cannot be shared), but the
// paths, the quarantine window, and the publish timestamps the suites agree on live here so
// the bump, floor, and drift-repair files cannot drift apart.

type ExecaSyncResult = ReturnType<typeof execaSync>

const PACKAGE_JSON_PATH = 'package.json'
const NPMRC_PATH = '.npmrc'
const NPMRC_AGE_1440 = 'minimum-release-age=1440\n'
// Published long enough ago to clear any quarantine window / far enough in the future to
// stay inside every window — the two ends the age filter is exercised against.
const AGED_PUBLISH = '2020-01-01T00:00:00.000Z'
const QUARANTINED_PUBLISH = '2999-01-01T00:00:00.000Z'

// Minimal stand-in for an `execaSync` result: these suites only read `exitCode` and
// `stdout`, so the cast to the full result type lives here once instead of being
// re-declared in every file that mocks execa.
function fake_sync_result(exit_code: number | undefined, stdout = ''): ExecaSyncResult {
	const result = { exitCode: exit_code, stdout }

	return result as unknown as ExecaSyncResult
}

export {
	AGED_PUBLISH,
	fake_sync_result,
	NPMRC_AGE_1440,
	NPMRC_PATH,
	PACKAGE_JSON_PATH,
	QUARANTINED_PUBLISH,
}
