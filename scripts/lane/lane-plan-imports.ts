import path from 'node:path'
import { main_guard } from '#scripts/lib/main-guard'
import { file_reader } from '#scripts/lib/read-file'

// `lane:plan <N> <path>... --imports <path>...` — the existing modules the lane's new code will import,
// probed before the first edit (joshuafolkken/kit#5928). joshuafolkken/kit#5846 learned only from
// `main-guard-boundary.test.ts`, after implementing, that `epic.ts` ran `main()` on import, and paused
// for the fix. The judgment is `main-guard.ts`: the guard check that test shares, and a top-level
// `main()` the plan asks alone.

const IMPORTS_FLAG = '--imports'
const ABSENT = -1

interface ImportSplit {
	plan: ReadonlyArray<string>
	imports: ReadonlyArray<string>
}

// The plan's tokens before `--imports`, and the module paths after it.
function split(argv: ReadonlyArray<string>): ImportSplit {
	const at = argv.indexOf(IMPORTS_FLAG)

	if (at === ABSENT) return { plan: argv, imports: [] }

	return { plan: argv.slice(0, at), imports: argv.slice(at + 1) }
}

// The finding for `file`, or undefined when it can be imported or does not exist yet.
function blocked_line(file: string, directory: string): string | undefined {
	const source = file_reader.read_if_readable(path.resolve(directory, file))
	const reason = source === undefined ? undefined : main_guard.import_blocker(source)

	return reason === undefined ? undefined : `import blocked: ${file} — ${reason}`
}

// Names each module of `imports` that cannot be imported, then the prerequisite split; silent when
// every one can, so a plan with no finding prints what it printed before.
function report(issue: string, imports: ReadonlyArray<string>, directory: string): void {
	const lines = imports
		.map((file) => blocked_line(file, directory))
		.filter((line): line is string => line !== undefined)

	if (lines.length === 0) return

	for (const line of lines) console.error(line)
	console.error(
		`File the fix as a prerequisite issue <P>, then split it off first: pnpm josh run:split ${issue} --prerequisite <P>`,
	)
}

const lane_plan_imports = { report, split }

export { lane_plan_imports }
