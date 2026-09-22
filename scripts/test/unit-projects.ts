import { PILOT_FILES } from './pilot-files'
import { VITEST_INCLUDE_GLOBS } from './vitest-include-globs'

// The unit suite runs as two Vitest projects so the isolation-safe files can skip per-file worker
// isolation, which re-evaluates every shared module once per file (joshuafolkken/kit#2170). Measured
// back to back on the pilot set, isolate:false ran it in 27.5s against 64.7s isolated — a 57% cut,
// because module evaluation is about half of a run's wall clock.
//
// **The two projects partition the suite exactly.** `pure` runs the classifier's isolation-free set;
// `isolated` runs everything else the main globs match, excluding the pilot files so no file lands in
// both. Their union is every included file bar the packed-consumer smoke test, and nothing runs
// twice — which is what keeps the gate's green condition identical to the single-project suite it
// replaces. `classify-isolation.ts` lists a file as pure only when it mutates no state a sibling in
// the same worker could observe, so isolate:false changes how the pure files run, never whether they
// pass.

const TEST_TIMEOUT_MS = 10_000

// Smoke test packs and installs the real tarball — too slow (~60 s setup) for the unit gate. Run
// before release with: pnpm vitest run scripts/build/packed-consumer.test.ts
const MAIN_EXCLUDE: ReadonlyArray<string> = ['scripts/build/packed-consumer.test.ts']

// **`JOSH_LANE_CHILD` is blanked so the unit suite never inherits the lane it happens to run in**
// (joshuafolkken/kit#2310). The gate runs inside a dispatched lane child, whose mark and lane cwd would
// otherwise make every world-consulting rule guard (`pre-gate-cut`, `implementation-cut`, `lane-park`)
// read a delivery fixture as a real lane-child call and fire on it. A suite that wants to test
// lane-child behavior sets the mark itself in its own `beforeEach`, exactly as it always has; blank is
// the "no dispatch mark" a person's session carries, which `marked_issue` reads as absent.
const ENV: Record<string, string> = {
	CLAUDE_CODE_SESSION_ID: 'vitest-session',
	CODEX_THREAD_ID: '',
	JOSH_LANE_CHILD: '',
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
// body so a fixture's direct `process.stdout` write cannot leak into `pnpm josh test:unit`'s output
// (joshuafolkken/kit#2296). `setupFiles` rather than `globalSetup` because it must run inside the
// worker where the test's writes happen, not once in the main process.
const STDOUT_GUARD: ReadonlyArray<string> = ['./scripts/test/test-stdout-guard.ts']

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
			setupFiles: [...STDOUT_GUARD],
		},
	}
}

const UNIT_PROJECTS: ReadonlyArray<UnitProject> = [
	unit_project({
		name: PURE_PROJECT,
		include: PILOT_FILES,
		isolate: false,
		globalSetup: STATE_GUARD,
	}),
	unit_project({
		name: ISOLATED_PROJECT,
		include: VITEST_INCLUDE_GLOBS,
		isolate: true,
		exclude: [...MAIN_EXCLUDE, ...PILOT_FILES],
	}),
]

const unit_projects = {
	ENV,
	ISOLATED_PROJECT,
	MAIN_EXCLUDE,
	PURE_PROJECT,
	STATE_GUARD,
	STDOUT_GUARD,
	UNIT_PROJECTS,
}

export type { UnitProject, UnitProjectTest }
export { unit_projects }
