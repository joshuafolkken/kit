import { agent_session_environment } from '#scripts/josh/agent-session-environment'
import { unit_setup_files } from '#scripts/test/unit-setup-files'
import { vitest_cli_excludes } from '#scripts/test/vitest-cli-excludes'
import { PURE_FILES } from '#tools/test/pure-files'
import { VITEST_INCLUDE_GLOBS } from '#tools/test/vitest-include-globs'

// The unit suite runs as two Vitest projects so the isolation-safe files can skip per-file worker
// isolation, which re-evaluates every shared module once per file. Measured
// back to back on the pure set, isolate:false ran it in 27.5s against 64.7s isolated — a 57% cut,
// because module evaluation is about half of a run's wall clock.
//
// **The two projects partition the suite exactly.** `pure` runs the classifier's isolation-free set;
// `isolated` runs everything else the main globs match, excluding the pure files so no file lands in
// both. Their union is every included file bar the packed-consumer smoke test, and nothing runs
// twice — which is what keeps the gate's green condition identical to the single-project suite it
// replaces. `classify-isolation.ts` lists a file as pure only when it mutates no state a sibling in
// the same worker could observe, so isolate:false changes how the pure files run, never whether they
// pass.

const TEST_TIMEOUT_MS = 10_000

// Smoke test packs and installs the real tarball — too slow (~60 s setup) for the unit gate. Run
// before release with: pnpm vitest run --config vitest.harness.config.ts
const MAIN_EXCLUDE: ReadonlyArray<string> = ['scripts/build/packed-consumer.test.ts']

// **Every inherited `JOSH_*` key is blanked unless the allow-list keeps it** (joshuafolkken/kit#8769).
// A developer's shell, a lane, a ship supervisor or a reviewer exports `JOSH_*` keys CI never has —
// the lane and headless marks (#7309), `JOSH_SHIP_*` (#5029), the profile models (#5863), the paired
// review (#7035), the startup scope (#7509), `JOSH_BOARD_THEME` (#8214), `JOSH_SESSION_LANG` — and each
// one a hand-kept list missed passed the gate there and failed in CI alone. A suite that needs a value
// sets it itself with `vi.stubEnv`. The keys are strings, not their owners' constants, so the config's
// import graph stays small; the suite pins each to its owner.
//
// Kept: the keys the unit-test machinery itself hands its workers. Blanking one would override the
// value the machinery sets for this run with an empty string.
const INHERITED_JOSH_KEYS: ReadonlySet<string> = new Set([
	// The network guard's `arm` points git at its shim in Vitest's main process, after this config is
	// read (`tools/test/test-network-guard.ts`).
	'JOSH_GIT_BINARY',
	// `arm` gives the run a temporary root no live run reads (`scripts/josh/platform-temporary.ts`).
	'JOSH_TEMP_ROOT',
	// `arm` exports the log the in-worker Telegram guard writes (`tools/test/unit-guard-environment.ts`).
	'JOSH_UNIT_GUARD_LOG',
	// The read recorder's directory and root, passed in the Vitest spawn's env by a recordable run
	// (`scripts/test/test-read-recording.ts`); a blank one makes the recorder write to an empty path.
	'JOSH_TEST_READS_DIRECTORY',
	'JOSH_TEST_READS_ROOT',
])

const JOSH_PREFIX = 'JOSH_'

// **The proxy spellings are blanked as well**: a package-manager wrapper writes its loopback proxy and
// CA into everything `pnpm` spawns, so a suite asserting what a `gh` spawn receives would pass in CI
// and fail on a machine with the wrapper. **The agent session's pid is blanked** because a claim
// records it as the hold's owner, and the supervisor's session has usually ended by the gate. A suite
// about either declares the value it tests.
//
// **The time zone is pinned to UTC** (joshuafolkken/kit#8684): CI runs in UTC, so a snapshot that draws
// local time was recorded green on a +0700 machine and failed there alone. A suite about another zone
// stubs `TZ` itself; Node reads `process.env.TZ` live, so `vi.unstubAllEnvs()` returns it to UTC.
const UNIT_TIME_ZONE = 'UTC'

type EnvironmentSource = Readonly<Record<string, string | undefined>>

function blank(keys: ReadonlyArray<string>): Record<string, string> {
	return Object.fromEntries(keys.map((key) => [key, '']))
}

function inherited_josh_keys(source: EnvironmentSource): ReadonlyArray<string> {
	return Object.keys(source).filter(
		(key) => key.startsWith(JOSH_PREFIX) && !INHERITED_JOSH_KEYS.has(key),
	)
}

function unit_environment(source: EnvironmentSource): Record<string, string> {
	return {
		...blank(inherited_josh_keys(source)),
		...blank([
			...agent_session_environment.PROXY_KEYS,
			agent_session_environment.PROXY_CERTIFICATE_KEY,
			agent_session_environment.AGENT_PID_KEY,
		]),
		CLAUDE_CODE_SESSION_ID: 'vitest-session',
		CODEX_THREAD_ID: '',
		// `auto` would probe GitHub and keep its answer in the repository's shared cache, which the
		// developer's own sessions read; a test that exercises `auto` sets it and isolates that cache.
		JOSH_GH_TRANSPORT: 'graphql',
		TZ: UNIT_TIME_ZONE,
	}
}

const ENV: Record<string, string> = unit_environment(process.env)

// **The packages most test files load are pre-bundled into one file each** (joshuafolkken/kit#4301).
// An isolated file starts a fresh module graph, so each of them re-imports these from their many
// source files. Bundling reduces the repeated module-loading cost across the suite.
const OPTIMIZED_DEPENDENCIES: ReadonlyArray<string> = [
	'execa',
	'zod',
	'semver',
	'ora',
	'string-width',
	'@actions/expressions',
]

interface DependencyOptimizer {
	optimizer: { ssr: { enabled: boolean; include: Array<string> } }
}

// The optimizer is set once on the root config, never per project: the optimizer state belongs to the
// Vite server, so a project carrying `test.deps.optimizer` resolves a server of its own instead of
// sharing the root's (vitest's `getOwnServerReason`), and both projects would pay that startup.
const DEPENDENCY_OPTIMIZER: DependencyOptimizer = {
	optimizer: { ssr: { enabled: true, include: [...OPTIMIZED_DEPENDENCIES] } },
}

const PURE_PROJECT = 'pure'
const ISOLATED_PROJECT = 'isolated'

const { STATE_GUARD, WORKER_GUARDS, READ_RECORDER } = unit_setup_files

interface UnitProjectTest {
	name: string
	clearMocks: boolean
	restoreMocks: boolean
	env: Record<string, string>
	include: ReadonlyArray<string>
	exclude: ReadonlyArray<string>
	isolate: boolean
	testTimeout: number
	globalSetup: ReadonlyArray<string>
	setupFiles: ReadonlyArray<string>
}

interface UnitProject {
	test: UnitProjectTest
}

interface UnitProjectSpec {
	name: string
	include: ReadonlyArray<string>
	isolate: boolean
	exclude?: ReadonlyArray<string>
	globalSetup?: ReadonlyArray<string>
}

function unit_project(spec: UnitProjectSpec): UnitProject {
	return {
		test: {
			name: spec.name,
			clearMocks: true,
			restoreMocks: false,
			env: ENV,
			include: [...spec.include],
			exclude: [...(spec.exclude ?? [])],
			isolate: spec.isolate,
			testTimeout: TEST_TIMEOUT_MS,
			globalSetup: [...(spec.globalSetup ?? [])],
			setupFiles: [...WORKER_GUARDS, ...READ_RECORDER],
		},
	}
}

// A command line's `--exclude` narrows both projects (`vitest-cli-excludes.ts`).
function unit_projects_for(argv: ReadonlyArray<string>): ReadonlyArray<UnitProject> {
	const excluded = vitest_cli_excludes.cli_excludes(argv)

	return [
		unit_project({
			name: PURE_PROJECT,
			include: PURE_FILES,
			isolate: false,
			exclude: excluded,
			globalSetup: STATE_GUARD,
		}),
		unit_project({
			name: ISOLATED_PROJECT,
			include: VITEST_INCLUDE_GLOBS,
			isolate: true,
			exclude: [...MAIN_EXCLUDE, ...PURE_FILES, ...excluded],
		}),
	]
}

const UNIT_PROJECTS: ReadonlyArray<UnitProject> = unit_projects_for(process.argv)

const unit_projects = {
	...unit_setup_files,
	DEPENDENCY_OPTIMIZER,
	ENV,
	INHERITED_JOSH_KEYS,
	ISOLATED_PROJECT,
	MAIN_EXCLUDE,
	OPTIMIZED_DEPENDENCIES,
	PURE_PROJECT,
	UNIT_PROJECTS,
	unit_environment,
	unit_projects_for,
}

export type { UnitProject, UnitProjectTest }
export { unit_projects }
