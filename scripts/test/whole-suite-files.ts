import path from 'node:path'
import { unit_setup_files } from './unit-setup-files'

// The files every test depends on without importing or reading them: the package and its lock,
// the vitest configuration, and the setup files every worker runs before every test. A `package.json`
// change of its `version` alone is none of them: `test:related` resolves it through the test-read map
// instead (`package-version-only.ts`, joshuafolkken/kit#7538). Nor is a `pnpm-lock.yaml` change that
// moves no unit runtime package (`UNIT_RUNTIME_PACKAGES`): it reaches the modules importing the packages
// it moved (`lockfile-changed-packages.ts`, joshuafolkken/kit#7554).
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
	'scripts/agent/agent-headless.ts',
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
	'scripts/run/run-headless-keys.ts',
	'scripts/test/unit-durations.ts',
	'scripts/test/unit-run-marker.ts',
	'scripts/test/unit-setup-files.ts',
	'scripts/test/vitest-cache-directory.ts',
	'scripts/test/vitest-cli-excludes.ts',
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

// The part of `WHOLE_SUITE_FILES` a scoped run narrows to the test files importing it directly
// (`direct-importers.ts`, joshuafolkken/kit#5122): each is a module some test imports by name, unlike a
// root or setup file, which only the whole suite reaches.
const EVERY_TEST_IMPORTS: ReadonlySet<string> = new Set(
	IMPORTED_BY_EVERY_TEST.map((file) => path.normalize(file)),
)

// The packages every unit test runs on — the runner, its bundler and the compiler — so a lockfile
// change moving one, or a package one depends on, runs the whole suite. An entry ending in `/` names a
// scope.
const UNIT_RUNTIME_PACKAGES: ReadonlyArray<string> = [
	'vitest',
	'vite',
	'vite-node',
	'typescript',
	'@vitest/',
]

function is_unit_runtime_package(name: string): boolean {
	return UNIT_RUNTIME_PACKAGES.some((entry) =>
		entry.endsWith(path.posix.sep) ? name.startsWith(entry) : name === entry,
	)
}

const whole_suite_files = { EVERY_TEST_IMPORTS, WHOLE_SUITE_FILES, is_unit_runtime_package }

export { whole_suite_files }
