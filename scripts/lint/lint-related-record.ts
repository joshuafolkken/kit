import { lane_ledger_write } from '#scripts/lane/lane-ledger-write'
import { lane_paths } from '#scripts/lane/lane-paths'
import { launch_timing } from '#scripts/lane/launch-timing'

// What one `josh lint:related` run leaves in the lane ledger (joshuafolkken/kit#7827): how long each of
// its stages took — a stage that did not run is absent — beside the launcher's `dist` rebuild, the wait
// for the command's core reservation (`launch-timing.ts`), the whole run and its exit code, so
// `josh lane:stats` can tell which stage a slow run spent its time in.

type LintStage = 'fix_ms' | 'structural_ms' | 'lint_ms' | 'documents_ms' | 'unused_members_ms'
type LintStages = Partial<Record<LintStage, number>>

interface LintRunEnd {
	started: number
	exit_code: number
}

function rounded(ms: number | undefined): number | undefined {
	return ms === undefined ? undefined : Math.round(ms)
}

// The stage's time is kept whether it settles or throws, so a stage that failed still shows its cost.
async function timed<T>(stages: LintStages, stage: LintStage, run: () => Promise<T>): Promise<T> {
	const started = performance.now()

	try {
		return await run()
	} finally {
		stages[stage] = Math.round(performance.now() - started)
	}
}

// Best-effort: a write that throws never reaches the run's exit code.
async function record_run(stages: LintStages, end: LintRunEnd, ledger?: string): Promise<void> {
	try {
		await lane_ledger_write.record_lint_related(
			{
				issue: lane_paths.issue_here(),
				rebuild_ms: rounded(launch_timing.rebuild_ms()),
				core_wait_ms: rounded(launch_timing.core_wait_ms()),
				...stages,
				elapsed_ms: Math.round(performance.now() - end.started),
				exit_code: end.exit_code,
			},
			ledger,
		)
	} catch {
		// The ledger is diagnostics; the lint verdict stands without it.
	}
}

const lint_related_record = { record_run, timed }

export type { LintStages }
export { lint_related_record }
