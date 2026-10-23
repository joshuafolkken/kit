import { existsSync } from 'node:fs'
import { execa } from 'execa'
import { pnpm_reach } from './pnpm-reach'
import { SUITE_TIMEOUT_MS } from './timeouts'

// One definition of "run a check, keep its output, never throw".
//
// `lint-parallel.ts` and `verification-gate.ts` both fan out to concurrent child processes and both
// need the same three things: the output buffered until the child finishes (concurrent writers
// otherwise interleave into an unreadable transcript), a non-zero exit reported rather than thrown
// (so one failing check does not abort its siblings), and a bound on how long a child may hang.
// They had the same code twice, which is how a fix to one of them missed the other.

const { PNPM } = pnpm_reach
const FORCE_COLOR = '1'
const FAIL_EXIT_CODE = 1

interface BufferedProcessResult {
	output: string
	// execa reports `undefined` when a process is terminated by a signal; treat
	// that as a failure (it is never strictly equal to 0).
	exit_code: number | undefined
	// How long the child ran, in milliseconds. Measured here rather than at each call site because
	// this function owns the child's lifetime — a caller timing it from outside would have to repeat
	// the same two readings, and every fan-out caller would repeat them once per branch.
	elapsed_ms: number
}

// The two things a caller outside the fan-out needs to vary, and the only two.
// `lane:open` runs its install in the work tree it just created rather
// than in the directory `josh` was typed in, and bounds it well under the fan-out's half hour
// because an install that never answers has to end the command rather than hold a parallel run
// open. Everything else — the buffering, the non-throwing exit, and the color policy that respects
// `NO_COLOR` — is the same contract, so it is inherited rather than restated.
interface BufferedProcessOptions {
	cwd?: string
	timeout_ms?: number
}

// What execa reports about a child that produced no exit code. Declared here because execa's own
// result type does not carry `code` or `shortMessage` on the non-rejecting path, though both are
// there at runtime whenever the child did not exit by itself.
interface UnfinishedChild {
	exitCode?: number | undefined
	code?: string | undefined
	shortMessage?: string | undefined
}

// A missing working directory is reported with the same code as a missing executable, so the code
// alone would blame pnpm for a lane directory that was removed.
function is_pnpm_missing(result: UnfinishedChild, cwd: string | undefined): boolean {
	return pnpm_reach.is_not_found(result) && existsSync(cwd ?? process.cwd())
}

// Why a child has no exit code: it could not be started, it ran past its bound, or a signal ended
// it. The child cannot say so itself — in the first case there is no child — and without this a
// check that never ran reads as a check that failed with nothing to report.
function unfinished_reason(result: UnfinishedChild, cwd: string | undefined): Array<string> {
	if (result.exitCode !== undefined) return []
	const reason = [result.shortMessage ?? '']
	if (is_pnpm_missing(result, cwd)) reason.push(pnpm_reach.NOT_ON_PATH_NOTICE)

	return reason
}

// The reason follows whatever the child wrote before it stopped: a timed-out suite's last lines
// are the evidence, and the reason is what explains them.
function collect_output(all: string, reason: ReadonlyArray<string>): string {
	return [all, ...reason].filter((part) => part !== '').join('\n')
}

// A buffered child writes to a pipe, so it is told to keep its colors unless the caller opted out.
// Exported for the eslint daemon route (`eslint-daemon.ts`), which buffers the same way.
function child_environment(): NodeJS.ProcessEnv {
	const environment = { ...process.env }
	if (environment['NO_COLOR'] === undefined) environment['FORCE_COLOR'] = FORCE_COLOR
	else delete environment['FORCE_COLOR']

	return environment
}

async function run_buffered_process(
	command_args: ReadonlyArray<string>,
	options: BufferedProcessOptions = {},
): Promise<BufferedProcessResult> {
	// `performance.now()` rather than `Date.now()`: it is monotonic, so a system clock adjusted
	// mid-check cannot produce a negative or wildly inflated duration.
	const started_at = performance.now()
	// `cwd` is spread in rather than assigned: `exactOptionalPropertyTypes` refuses an explicit
	// `undefined` for an optional `string`, and passing one anyway breaks execa's overload
	// resolution — which silently widens `result.all` back to `string | undefined`.
	const result = await execa(PNPM, [...command_args], {
		env: child_environment(),
		extendEnv: false,
		all: true,
		reject: false,
		...(options.cwd !== undefined && { cwd: options.cwd }),
		timeout: options.timeout_ms ?? SUITE_TIMEOUT_MS,
	})

	return {
		output: collect_output(result.all, unfinished_reason(result, options.cwd)),
		exit_code: result.exitCode,
		elapsed_ms: performance.now() - started_at,
	}
}

// Narrowed to the one field it reads, so a caller asking "did this fail" never has to invent the
// two it does not — a duration fabricated to satisfy a parameter is a number nobody measured.
function is_process_failed(result: Pick<BufferedProcessResult, 'exit_code'>): boolean {
	return result.exit_code !== 0
}

const buffered_process = { child_environment, is_process_failed, run_buffered_process }

export type { BufferedProcessResult }
export { buffered_process, FAIL_EXIT_CODE }
