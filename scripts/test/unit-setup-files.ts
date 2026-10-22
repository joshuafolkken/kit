// The state guard runs on the pure project alone. isolate:false is what lets one file see the git
// branch, working tree or GIT_* variables a sibling left changed, so that is the only run where a leak
// is a correctness problem rather than a latent one — and the isolated project keeps exactly the guards
// the single-project suite had. The network guard is armed once at the root instead, since it arms
// `PATH` before any worker of either project forks.
const STATE_GUARD: ReadonlyArray<string> = ['./tools/test/test-state-guard.ts']

// Runs in every worker of both projects, before each test, and silences the real streams for the test
// body so a fixture's direct `process.stdout` write cannot leak into `pnpm josh test:unit`'s output.
// `setupFiles` rather than `globalSetup` because it must run inside the
// worker where the test's writes happen, not once in the main process.
const STDOUT_GUARD: ReadonlyArray<string> = ['./tools/test/test-stdout-guard.ts']

// Runs in every worker for the same reason: it wraps that worker's own `fetch`, refusing a real
// Telegram send and recording which test tried.
const TELEGRAM_GUARD: ReadonlyArray<string> = ['./tools/test/test-telegram-guard.ts']

// Runs in every worker too: it replaces that worker's machine reading, so a suite that drives the gate
// admits the same way on every platform and every load.
const MACHINE_GUARD: ReadonlyArray<string> = ['./tools/test/test-machine-guard.ts']

// The guards every run of the suite arms, whichever config starts it: the network guard once in the
// main process, the stdout, Telegram and machine guards in every worker. Named here so `vitest.config.ts` and
// `vitest.harness.config.ts` read one definition — the harness once ran with none of them.
const NETWORK_GUARD: ReadonlyArray<string> = ['./tools/test/test-network-guard.ts']
const WORKER_GUARDS: ReadonlyArray<string> = [...STDOUT_GUARD, ...TELEGRAM_GUARD, ...MACHINE_GUARD]

// Runs in every worker of the unit suite, idle unless a whole-suite `josh test:unit` asked it to
// record which repository paths each test reads (`test-read-recorder.ts`). Not a guard, and not
// the harness config's: only this suite's runs feed the test-read map.
const READ_RECORDER: ReadonlyArray<string> = ['./tools/test/test-read-recorder.ts']

// Kept apart from `unit-projects.ts` so the shipped `josh test:related` can name every setup file
// without loading the kit-internal project partition.
const unit_setup_files = {
	MACHINE_GUARD,
	NETWORK_GUARD,
	READ_RECORDER,
	STATE_GUARD,
	STDOUT_GUARD,
	TELEGRAM_GUARD,
	WORKER_GUARDS,
}

export { unit_setup_files }
