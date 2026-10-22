import { agent_session_environment } from '#scripts/josh/agent-session-environment'
import { unit_setup_files } from '#scripts/test/unit-setup-files'
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

// **`JOSH_LANE_CHILD` is blanked so the unit suite never inherits the lane it happens to run in**.
// The gate runs inside a dispatched lane child, whose mark and lane cwd would
// otherwise make every world-consulting rule guard (`pre-gate-cut`, `implementation-cut`, `lane-park`)
// read a delivery fixture as a real lane-child call and fire on it. A suite that wants to test
// lane-child behavior sets the mark itself in its own `beforeEach`, exactly as it always has; blank is
// the "no dispatch mark" a person's session carries, which `marked_issue` reads as absent.
//
// **The proxy spellings are blanked for the same reason**: a package-manager
// wrapper writes its loopback proxy and CA into everything `pnpm` spawns, so a suite asserting what a
// `gh` spawn receives would pass in CI and fail on a machine with the wrapper. A suite about proxies
// declares the one it is testing in its own `beforeEach`.
//
// **The detached ship supervisor's marks are blanked too**: the pre-push unit
// run inherits `JOSH_SHIP_SUPERVISED` and `JOSH_AGENT_PROVIDER` from the supervisor that pushes, so a
// ship fixture would take the supervised stop path — and try to relaunch a real lane child — only there.
//
// **The agent session's pid is blanked as well**: a claim records it as the
// hold's owner, and the supervisor inherits it from a session that has usually ended by the time the
// gate runs, so every hold a fixture writes would read back as `stale` there and nowhere else. A suite
// about the owner stubs the pid it is testing.
//
// **The agent session role is blanked for the lane mark's reason**: a ship reviewer runs the related
// tests after a fix it applies, and its `JOSH_AGENT_ROLE` would make both cut guards stand down on a
// delivery fixture that sets the lane mark and expects the refusal. A suite about the reviewer passes
// the role itself.
const PROXY_ENV: Record<string, string> = Object.fromEntries(
	[...agent_session_environment.PROXY_KEYS, agent_session_environment.PROXY_CERTIFICATE_KEY].map(
		(key) => [key, ''],
	),
)

const ENV: Record<string, string> = {
	...PROXY_ENV,
	[agent_session_environment.AGENT_PID_KEY]: '',
	CLAUDE_CODE_SESSION_ID: 'vitest-session',
	CODEX_THREAD_ID: '',
	JOSH_AGENT_PROVIDER: '',
	JOSH_AGENT_ROLE: '',
	JOSH_LANE_CHILD: '',
	JOSH_SHIP_SUPERVISED: '',
}

// **The packages most test files load are pre-bundled into one file each** (joshuafolkken/kit#4301).
// An isolated file starts a fresh module graph, so each of them re-imports these from their many
// source files: measured with `--experimental.importDurations`, execa and zod alone cost about 70ms
// and 50ms per file across 700 and 900 isolated files — the top two import costs of the suite.
// A bundled copy loads several times faster (execa 35ms → 9ms, zod 27ms → 10ms natively).
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

const UNIT_PROJECTS: ReadonlyArray<UnitProject> = [
	unit_project({
		name: PURE_PROJECT,
		include: PURE_FILES,
		isolate: false,
		globalSetup: STATE_GUARD,
	}),
	unit_project({
		name: ISOLATED_PROJECT,
		include: VITEST_INCLUDE_GLOBS,
		isolate: true,
		exclude: [...MAIN_EXCLUDE, ...PURE_FILES],
	}),
]

const unit_projects = {
	...unit_setup_files,
	DEPENDENCY_OPTIMIZER,
	ENV,
	ISOLATED_PROJECT,
	MAIN_EXCLUDE,
	OPTIMIZED_DEPENDENCIES,
	PURE_PROJECT,
	UNIT_PROJECTS,
}

export type { UnitProject, UnitProjectTest }
export { unit_projects }
