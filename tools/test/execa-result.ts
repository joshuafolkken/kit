import type { execa } from 'execa'

type ExecaResult = Awaited<ReturnType<typeof execa>>

// execa's resolved Result is a large interface; the commands under test read only `all` and
// `exitCode`, so a minimal stub is bridged through `unknown`.
function fake_result(exit_code: number | undefined, all = ''): ExecaResult {
	const result: unknown = { all, exitCode: exit_code }

	return result as ExecaResult
}

export type { ExecaResult }
export { fake_result }
