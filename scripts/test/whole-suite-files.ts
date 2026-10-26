import path from 'node:path'
import { unit_setup_files } from './unit-setup-files'

// The files every test depends on without importing or reading them: the package and its lock,
// the vitest configuration, and the setup files every worker runs before every test.
const SETUP_FILES: ReadonlyArray<string> = [
	...unit_setup_files.NETWORK_GUARD,
	...unit_setup_files.STATE_GUARD,
	...unit_setup_files.WORKER_GUARDS,
	...unit_setup_files.READ_RECORDER,
]

const ROOT_FILES: ReadonlyArray<string> = [
	'package.json',
	'pnpm-lock.yaml',
	'pnpm-workspace.yaml',
	'tsconfig.json',
	'vitest.config.ts',
	'vitest.harness.config.ts',
	// What the read recorder runs in every worker, which no test imports through the setup file.
	'tools/test/test-read-capture.ts',
	'scripts/test/test-read-trace.ts',
]

// **What the vitest config and the worker setup files import** (joshuafolkken/kit#4465). Vitest runs
// every test when a file it is given is a config dependency — every module the config imports,
// statically or not — and the setup files are in every test's graph, so `vitest related` widens to the
// whole suite on any of these with no word of why. Named here, they print the reason instead.
// `whole-suite-files.test.ts` holds the list to both graphs, so an import added to either fails there.
const IMPORTED_BY_EVERY_TEST: ReadonlyArray<string> = [
	'scripts/git/constants.ts',
	'scripts/git/git-location-environment.ts',
	'scripts/init/init-paths.ts',
	'scripts/josh/agent-session-environment.ts',
	'scripts/josh/platform-temporary.ts',
	'scripts/josh/process-identity.ts',
	'scripts/josh/process-owner.ts',
	'scripts/josh/stamp-file.ts',
	'scripts/lane/lane-child-mark-keys.ts',
	'scripts/lib/atomic-write.ts',
	'scripts/lib/json-value.ts',
	'scripts/lib/read-file.ts',
	'scripts/lib/timeouts.ts',
	'scripts/test/unit-run-marker.ts',
	'scripts/test/unit-setup-files.ts',
	'scripts/test/vitest-cache-directory.ts',
	'tools/test/duration-sequencer.ts',
	'tools/test/duration-shard.ts',
	'tools/test/pure-files.ts',
	'tools/test/test-module-elapsed.ts',
	'tools/test/test-repository-guard.ts',
	'tools/test/unit-duration-record.ts',
	'tools/test/unit-guard-environment.ts',
	'tools/test/unit-projects.ts',
	'tools/test/vitest-config-workers.ts',
	'tools/test/vitest-include-globs.ts',
]

const WHOLE_SUITE_FILES: ReadonlySet<string> = new Set(
	[...ROOT_FILES, ...IMPORTED_BY_EVERY_TEST, ...SETUP_FILES].map((file) => path.normalize(file)),
)

const whole_suite_files = { WHOLE_SUITE_FILES }

export { whole_suite_files }
