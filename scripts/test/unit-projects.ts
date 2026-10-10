import { agent_session_environment } from '#scripts/josh/agent-session-environment'
import { PURE_FILES } from '#scripts/test/pure-files'
import { VITEST_INCLUDE_GLOBS } from '#scripts/test/vitest-include-globs'

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

const PURE_PROJECT = 'pure'
const ISOLATED_PROJECT = 'isolated'

// The state guard runs on the pure project alone. isolate:false is what lets one file see the git
// branch, working tree or GIT_* variables a sibling left changed, so that is the only run where a leak
// is a correctness problem rather than a latent one — and the isolated project keeps exactly the guards
// the single-project suite had. The network guard is armed once at the root instead, since it arms
// `PATH` before any worker of either project forks.
const STATE_GUARD: ReadonlyArray<string> = ['./scripts/test/test-state-guard.ts']

// Runs in every worker of both projects, before each test, and silences the real streams for the test
// body so a fixture's direct `process.stdout` write cannot leak into `pnpm josh test:unit`'s output.
// `setupFiles` rather than `globalSetup` because it must run inside the
// worker where the test's writes happen, not once in the main process.
const STDOUT_GUARD: ReadonlyArray<string> = ['./scripts/test/test-stdout-guard.ts']

// Runs in every worker for the same reason: it wraps that worker's own `fetch`, refusing a real
// Telegram send and recording which test tried.
const TELEGRAM_GUARD: ReadonlyArray<string> = ['./scripts/test/test-telegram-guard.ts']

// Runs in every worker too: it replaces that worker's machine reading, so a suite that drives the gate
// admits the same way on every platform and every load.
const MACHINE_GUARD: ReadonlyArray<string> = ['./scripts/test/test-machine-guard.ts']

// The guards every run of the suite arms, whichever config starts it: the network guard once in the
// main process, the stdout, Telegram and machine guards in every worker. Named here so `vitest.config.ts` and
// `vitest.harness.config.ts` read one definition — the harness once ran with none of them.
const NETWORK_GUARD: ReadonlyArray<string> = ['./scripts/test/test-network-guard.ts']
const WORKER_GUARDS: ReadonlyArray<string> = [...STDOUT_GUARD, ...TELEGRAM_GUARD, ...MACHINE_GUARD]

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
			setupFiles: [...WORKER_GUARDS],
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
	ENV,
	ISOLATED_PROJECT,
	MACHINE_GUARD,
	MAIN_EXCLUDE,
	NETWORK_GUARD,
	PURE_PROJECT,
	STATE_GUARD,
	STDOUT_GUARD,
	TELEGRAM_GUARD,
	UNIT_PROJECTS,
	WORKER_GUARDS,
}

export type { UnitProject, UnitProjectTest }
export { unit_projects }
