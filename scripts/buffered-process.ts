import { execa } from 'execa'

// One definition of "run a check, keep its output, never throw".
//
// `lint-parallel.ts` and `verification-gate.ts` both fan out to concurrent child processes and both
// need the same three things: the output buffered until the child finishes (concurrent writers
// otherwise interleave into an unreadable transcript), a non-zero exit reported rather than thrown
// (so one failing check does not abort its siblings), and a bound on how long a child may hang.
// They had the same code twice, which is how a fix to one of them missed the other
// (joshuafolkken/kit#914).

const PNPM = 'pnpm'
const FORCE_COLOR = '1'
const FAIL_EXIT_CODE = 1
// Long enough for a cold unit suite on a large consumer, short enough that a check which never
// exits ends the run instead of holding it open with nothing printed — the same hazard
// `propagate-steps.ts` bounds with its own step timeout. Because output is buffered until the
// child finishes, a hung child shows nothing at all until this fires.
const PROCESS_TIMEOUT_MS = 1_800_000

interface BufferedProcessResult {
	output: string
	// execa reports `undefined` when a process is terminated by a signal; treat
	// that as a failure (it is never strictly equal to 0).
	exit_code: number | undefined
	// How long the child ran, in milliseconds. Measured here rather than at each call site because
	// this function owns the child's lifetime — a caller timing it from outside would have to repeat
	// the same two readings, and every fan-out caller would repeat them once per branch
	// (joshuafolkken/kit#1248).
	elapsed_ms: number
}

// The two things a caller outside the fan-out needs to vary, and the only two
// (joshuafolkken/kit#1554). `lane:open` runs its install in the work tree it just created rather
// than in the directory `josh` was typed in, and bounds it well under the fan-out's half hour
// because an install that never answers has to end the command rather than hold a parallel run
// open. Everything else — the buffering, the non-throwing exit, the forced color — is the same
// contract, so it is inherited rather than restated.
interface BufferedProcessOptions {
	cwd?: string
	timeout_ms?: number
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
		env: { ...process.env, FORCE_COLOR },
		all: true,
		reject: false,
		...(options.cwd !== undefined && { cwd: options.cwd }),
		timeout: options.timeout_ms ?? PROCESS_TIMEOUT_MS,
	})

	return {
		output: result.all,
		exit_code: result.exitCode,
		elapsed_ms: performance.now() - started_at,
	}
}

// Narrowed to the one field it reads, so a caller asking "did this fail" never has to invent the
// two it does not — a duration fabricated to satisfy a parameter is a number nobody measured.
function is_process_failed(result: Pick<BufferedProcessResult, 'exit_code'>): boolean {
	return result.exit_code !== 0
}

const buffered_process = { is_process_failed, run_buffered_process }

export type { BufferedProcessOptions, BufferedProcessResult }
export { buffered_process, FAIL_EXIT_CODE, PROCESS_TIMEOUT_MS }
