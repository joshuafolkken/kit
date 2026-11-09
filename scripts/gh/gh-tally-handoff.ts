import { randomUUID } from 'node:crypto'
import { appendFileSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { error_text } from '#scripts/lib/error-message'
import { z } from 'zod'

// A spawned josh command's GitHub request tally, handed back to the dispatcher that records the
// usage line (joshuafolkken/kit#6965). The built dispatcher runs a command that is not bundled as a
// tsx child, whose tally (`gh-request-tally.ts`) dies with it. The dispatcher names a file in
// `HANDOFF_ENV`; a process that counts a call without recording a line of its own appends its tally
// there, one JSON line as it exits, and the dispatcher adds every line to its own tally once the
// child has exited. Each process that inherits the variable writes its own line, so a child's own
// children are counted too. A test run never writes: its calls are fakes.

const HANDOFF_ENV = 'JOSH_GH_TALLY_FILE'
const LINE_SEPARATOR = '\n'

const count_schema = z.object({ calls: z.number(), not_modified: z.number() })

const handed_schema = z.object({
	calls: z.number(),
	not_modified: z.number(),
	endpoints: z.record(z.string(), count_schema),
})

type HandedTally = z.infer<typeof handed_schema>
type ExitListen = (listener: () => void) => void

const state = { is_armed: false }

function listen_exit(listener: () => void): void {
	process.once('exit', listener)
}

// An exit listener that throws would change the exit code, so a failed append is dropped.
function append_line(target: string, snapshot: () => HandedTally): void {
	try {
		appendFileSync(target, `${JSON.stringify(snapshot())}${LINE_SEPARATOR}`)
	} catch (error) {
		error_text.trace_swallowed('gh_tally_handoff.append_line', error)
	}
}

function target_of(environment: NodeJS.ProcessEnv): string | undefined {
	return environment['VITEST'] === undefined ? environment[HANDOFF_ENV] : undefined
}

function arm(
	snapshot: () => HandedTally,
	environment: NodeJS.ProcessEnv = process.env,
	listen: ExitListen = listen_exit,
): void {
	if (state.is_armed) return
	const target = target_of(environment)

	if (target === undefined) return
	state.is_armed = true
	listen(() => {
		append_line(target, snapshot)
	})
}

function target_path(): string {
	return path.join(os.tmpdir(), `josh-gh-tally-${randomUUID()}.jsonl`)
}

function parsed_of(text: string): HandedTally | undefined {
	try {
		return handed_schema.safeParse(JSON.parse(text)).data
	} catch {
		return undefined
	}
}

function read_text(target: string): string {
	try {
		return readFileSync(target, 'utf8')
	} catch {
		return ''
	}
}

// Every handed tally, the file removed; a child that sent no call wrote none, and a line that does
// not parse is dropped.
function taken(target: string): ReadonlyArray<HandedTally> {
	const lines = read_text(target).split(LINE_SEPARATOR)

	rmSync(target, { force: true })

	return lines.map((line) => parsed_of(line)).filter((handed) => handed !== undefined)
}

// For tests: the one exit listener belongs to the process, so each test starts it unarmed.
function reset(): void {
	state.is_armed = false
}

const gh_tally_handoff = { HANDOFF_ENV, arm, target_path, taken, reset }

export type { HandedTally }
export { gh_tally_handoff }
