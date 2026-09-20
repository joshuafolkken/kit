import { execa } from 'execa'

// One captured `pnpm josh` subprocess (joshuafolkken/kit#2162). A composite command that collapses a
// sequence of `pnpm josh` calls into one — `run:merge`, `backlog:offer`, `lane:launch` — reads each
// step's output back rather than inheriting it, so the step's own report logic is reused rather than
// cloned and only the composite's own token reaches the caller's stdout. This is that read, single-
// sourced so the three composites cannot drift on how a subprocess is run or how its exit code is read.
//
// **`reject: false`**: a non-zero exit is a value to branch on, not a throw. **`forward_stderr`**: a
// step's explanation (a refusal, a candidate elsewhere, a reason) belongs on the caller's stderr where
// a person sees it, so a composite streams it through; `run:merge` keeps it piped, because it composes
// its own report from the captured values instead.

const PNPM = 'pnpm'
const JOSH = 'josh'
const NONZERO_EXIT = 1

interface JoshResult {
	code: number
	out: string
}

async function josh_run(
	args: ReadonlyArray<string>,
	should_forward_stderr = false,
): Promise<JoshResult> {
	const result = await execa(PNPM, [JOSH, ...args], {
		reject: false,
		stderr: should_forward_stderr ? 'inherit' : 'pipe',
	})

	return { code: result.exitCode ?? NONZERO_EXIT, out: result.stdout.trim() }
}

const josh_command = { josh_run }

export type { JoshResult }
export { josh_command }
