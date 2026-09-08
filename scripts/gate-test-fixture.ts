import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { execa } from 'execa'
import { vi } from 'vitest'

// The scaffolding both gate suites need to drive `josh gate` without spawning anything.
//
// `verification-gate.test.ts` owned all three helpers alone until joshuafolkken/kit#1328 added
// `gate-skip.test.ts`, which needs the same stubs behind a different mock of the changed tree. Two
// copies of them is the clone `CLAUDE.md` prohibits — and the copies would not have stayed identical:
// the bridging below exists because execa's real types are far wider than what the gate reads, so a
// change to either would be made in whichever file the next failure pointed at.

// An argument `josh gate` would have to forward to a sub-command, which is what it refuses. Both
// suites need one — the refusal is `verification-gate.test.ts`'s subject and the flags it accepts are
// `gate-skip.test.ts`'s — and two spellings of "an argument that is not a flag the gate consumes"
// would let one suite go on passing against a refusal the other had already changed.
const FORWARDED_FLAG = '--workers=1'

type ExecaResult = Awaited<ReturnType<typeof execa>>
type MockedExeca = ReturnType<typeof vi.mocked<typeof execa>>
type ExecaImplementation = Parameters<MockedExeca['mockImplementation']>[0]
type FakeExeca = (...parameters: ReadonlyArray<unknown>) => Promise<ExecaResult>

// execa's resolved Result is a large interface; the gate reads only `all` and `exitCode`, so a
// minimal stub is bridged through `unknown`.
function fake_result(exit_code: number, output: string): ExecaResult {
	const result = { all: output, exitCode: exit_code }

	return result as unknown as ExecaResult
}

// execa's real return type is a promise carrying IPC methods the gate never touches, so the
// implementation is bridged the same way the result is.
function as_execa_implementation(run: FakeExeca): ExecaImplementation {
	return run as unknown as ExecaImplementation
}

interface CapturedOutput {
	text: () => string
	restore: () => void
}

// The gate buffers every step's output and writes it all at once, so a suite that asserts on what a
// run printed has to hold the whole transcript rather than the last chunk.
function capture_stdout(): CapturedOutput {
	const chunks: Array<string> = []
	const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
		chunks.push(String(chunk))

		return true
	})

	return {
		text: (): string => chunks.join(''),
		restore: (): void => {
			spy.mockRestore()
		},
	}
}

interface SuiteRecords {
	stamp_path: string
	marker_path: string
	log_path: string
	clear: () => void
}

// Where a suite driving the real `run_verification_gate` puts the two records it would otherwise share
// with the live gate — and **the reason `GateOptions` carries those destinations at all**.
//
// A green run writes the green-gate record joshuafolkken/kit#1328 reuses, so a suite writing to the
// shared path plants "these files are green" for whatever the *real* working tree happens to be, and
// the next `pnpm josh gate` skips its four checks on the strength of it. The in-flight marker is the
// same hazard one step further on: cleared here, it stops telling the review beside a live gate that
// the unit suite is already running (joshuafolkken/kit#1242).
//
// Keyed on the label and the pid together, so two suites in parallel workers cannot answer for each
// other, and `clear` comes back with the paths rather than being written out per suite — three suites
// removing two files each is where the fourth one forgets the marker.
// The gate log is the third destination and is here for the same reason (joshuafolkken/kit#1227):
// every run writes it, so a suite left on the shared path would overwrite the live gate's own log
// with the output of four checks that never ran.
function suite_records(label: string): SuiteRecords {
	const suite_key = `${label}-${String(process.pid)}`
	const stamp_path = path.join(tmpdir(), `josh-gate-suite-stamp-${suite_key}.json`)
	const marker_path = path.join(tmpdir(), `josh-gate-suite-running-${suite_key}.json`)
	const log_path = path.join(tmpdir(), `josh-gate-suite-log-${suite_key}.log`)

	return {
		stamp_path,
		marker_path,
		log_path,
		clear: (): void => {
			rmSync(stamp_path, { force: true })
			rmSync(marker_path, { force: true })
			rmSync(log_path, { force: true })
		},
	}
}

const gate_test_fixture = {
	as_execa_implementation,
	capture_stdout,
	fake_result,
	FORWARDED_FLAG,
	suite_records,
}

export type { CapturedOutput, ExecaResult, FakeExeca, SuiteRecords }
export { gate_test_fixture }
