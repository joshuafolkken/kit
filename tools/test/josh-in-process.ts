import process from 'node:process'
import { vi, type MockInstance } from 'vitest'
import { josh_harness, type HarnessResult } from './josh-harness'

// A josh command called in this process the way `josh_harness.run` spawns it (joshuafolkken/kit#9116):
// in the environment's tree, with the child's surroundings (`josh_harness.CHILD_ENVIRONMENT`), its
// output captured and its exit code answered. A child's startup was most of a scenario that asserts
// on what the command decides; a scenario about how the CLI itself answers keeps `josh_harness.run`.
//
// The working directory and the variables are this process's own, so they are put back however the
// run ends — the next scenario, and the next file in the same worker, start where they did.

type CommandRun = (argv: ReadonlyArray<string>) => Promise<number>
type WriteSpy = MockInstance<(chunk: string | Uint8Array) => boolean>

const DECODER = new TextDecoder()

function set_variable(name: string, value: string | undefined): void {
	if (value === undefined) Reflect.deleteProperty(process.env, name)
	else process.env[name] = value
}

// Enters `root` with the child's variables and answers with the way back. The directory is changed
// first, so a `chdir` that throws has changed nothing yet.
function enter(root: string): () => void {
	const cwd = process.cwd()
	const previous = Object.keys(josh_harness.CHILD_ENVIRONMENT).map(
		(name) => [name, process.env[name]] as const,
	)

	process.chdir(root)

	for (const [name, value] of Object.entries(josh_harness.CHILD_ENVIRONMENT)) {
		set_variable(name, value)
	}

	return function leave(): void {
		process.chdir(cwd)
		for (const [name, value] of previous) set_variable(name, value)
	}
}

function capture(stream: NodeJS.WriteStream, chunks: Array<string>): WriteSpy {
	function record(chunk: string | Uint8Array): boolean {
		chunks.push(typeof chunk === 'string' ? chunk : DECODER.decode(chunk))

		return true
	}

	return vi.spyOn(stream, 'write').mockImplementation(record)
}

async function run_in_process(
	root: string,
	run: CommandRun,
	argv: ReadonlyArray<string>,
): Promise<HarnessResult> {
	const stdout: Array<string> = []
	const stderr: Array<string> = []
	const leave = enter(root)
	const spies: Array<WriteSpy> = []

	try {
		spies.push(capture(process.stdout, stdout), capture(process.stderr, stderr))

		const exit_code = await run(argv)

		return { exit_code, stdout: stdout.join(''), stderr: stderr.join(''), is_timed_out: false }
	} finally {
		leave()
		for (const spy of spies) spy.mockRestore()
	}
}

const josh_in_process = { run_in_process }

export { josh_in_process }
