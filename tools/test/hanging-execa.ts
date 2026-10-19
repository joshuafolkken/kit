// A stand-in for `execa` whose commands never answer — the fault joshuafolkken/kit#3590 bounds. A
// test mocks `execa` with `spawn` and runs under fake timers: a call that carries a `timeout` ends
// the way execa ends one it killed on its budget, and a call that carries none never settles, so a
// spawn that lost its timeout fails the test on the suite's own timeout instead of passing.

interface SpawnOptions {
	timeout?: number
	reject?: boolean
	stdio?: string
}

interface SpawnCall {
	file: string
	arguments_list: ReadonlyArray<string>
	options: SpawnOptions
}

interface SpawnResult {
	stdout: string
	timedOut: boolean
}

interface HangState {
	// The commands that do answer, by binary name — everything else hangs.
	answers: Map<string, string>
	calls: Array<SpawnCall>
}

const state: HangState = { answers: new Map(), calls: [] }
const TIMED_OUT: SpawnResult = { stdout: '', timedOut: true }

// What execa throws for a spawn it killed on its budget: `timedOut` is the field callers read.
function create_timeout_error(file: string, timeout_ms: number): Error {
	const error = new Error(`Command timed out after ${String(timeout_ms)} milliseconds: ${file}`)

	return Object.assign(error, { timedOut: true, exitCode: undefined })
}

// `reject: false` turns execa's failure into a result, and a budget kill is one of those failures.
async function hang(file: string, options: SpawnOptions): Promise<SpawnResult> {
	const { timeout, reject: should_reject = true } = options

	return await new Promise<SpawnResult>((resolve, reject) => {
		if (timeout === undefined) return

		setTimeout(() => {
			if (should_reject) reject(create_timeout_error(file, timeout))
			else resolve(TIMED_OUT)
		}, timeout)
	})
}

async function spawn(
	file: string,
	arguments_list: ReadonlyArray<string> = [],
	options: SpawnOptions = {},
): Promise<SpawnResult> {
	state.calls.push({ file, arguments_list, options })

	const answer = state.answers.get(file)

	return answer === undefined ? await hang(file, options) : { stdout: answer, timedOut: false }
}

function answer_with(file: string, stdout: string): void {
	state.answers.set(file, stdout)
}

function reset(): void {
	state.answers.clear()
	state.calls.length = 0
}

// The budget each recorded spawn carried, in call order.
function timeouts(): Array<number | undefined> {
	return state.calls.map((call) => call.options.timeout)
}

function calls(): ReadonlyArray<SpawnCall> {
	return state.calls
}

const hanging_execa = { answer_with, calls, reset, spawn, timeouts }

export { hanging_execa }
