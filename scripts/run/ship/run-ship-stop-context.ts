import { stripVTControlCharacters } from 'node:util'
import { changed_paths } from '#scripts/git/changed-paths'
import { stamp_file } from '#scripts/josh/stamp-file'
import { z } from 'zod'
import { run_ship_next } from './run-ship-next'
import { run_ship_probe } from './run-ship-probe'

// What a relaunched lane child needs in front of it to fix a stopped ship: the tail of the failed
// stage's output — a red check, or the High/Medium findings a review stage reports — and the branch's
// changed files. Without them the resumed session opened `josh ship --log` and `git diff` itself before
// doing anything (joshuafolkken/kit#3923).
//
// **Both are bounded**, so a long gate log never becomes the whole prompt. The tail is kept because a
// check reports its verdict last; the lines left out go to a file whose path and line range the prompt
// names, so nothing is lost and the session reads only the range it needs.

const EXCERPT_LINE_LIMIT = 40
const CHANGED_PATH_LIMIT = 30
const OUTPUT_PREFIX = 'josh-ship-stop-'
const OUTPUT_SUFFIX = '.log'
const KEY_SEPARATOR = '-'
const LINE_BREAK = '\n'
const CARRIAGE_RETURN = '\r'

const omitted_schema = z
	.object({ path: z.string().optional(), last_line: z.number().int() })
	.strict()
const stop_context_schema = z
	.object({
		excerpt: z.array(z.string()).readonly(),
		omitted: omitted_schema.optional(),
		changed: z.array(z.string()).readonly().optional(),
		more_changed: z.number().int(),
	})
	.strict()

type StopContext = z.infer<typeof stop_context_schema>
type Omitted = z.infer<typeof omitted_schema>

// A spinner redraws its line with a carriage return, so only the frame after the last one is what the
// terminal showed; a CRLF line ends in one and keeps its whole text.
function shown_frame(line: string): string {
	return line.trimEnd().split(CARRIAGE_RETURN).at(-1) ?? ''
}

function output_lines(output: string): Array<string> {
	return stripVTControlCharacters(output)
		.trimEnd()
		.split(LINE_BREAK)
		.map((line) => shown_frame(line))
}

// The full output is kept beside the ship log, keyed the same way, so the prompt's line range points at
// text that reads exactly as the excerpt was cut from.
async function keep_full_output(issue: string, output: string): Promise<string | undefined> {
	const repository = await run_ship_probe.repository_directory()

	if (repository === undefined) return undefined

	const target = stamp_file.stamp_path(
		`${OUTPUT_PREFIX}${issue}${KEY_SEPARATOR}`,
		repository,
		OUTPUT_SUFFIX,
	)

	try {
		return stamp_file.replace_text_stamp(target, output)
	} catch {
		return undefined
	}
}

// A full output that could not be kept still reports the cut, with no path: the prompt then points at
// the stopped report, which holds the same lines.
async function omitted_range(issue: string, lines: ReadonlyArray<string>): Promise<Omitted> {
	const path = await keep_full_output(issue, lines.join(LINE_BREAK))
	const last_line = lines.length - EXCERPT_LINE_LIMIT

	return path === undefined ? { last_line } : { path, last_line }
}

async function excerpt_of(
	issue: string,
	output: string,
): Promise<Pick<StopContext, 'excerpt' | 'omitted'>> {
	const lines = output.trim() === '' ? [] : output_lines(output)

	if (lines.length <= EXCERPT_LINE_LIMIT) return { excerpt: lines }

	return { excerpt: lines.slice(-EXCERPT_LINE_LIMIT), omitted: await omitted_range(issue, lines) }
}

// A git that cannot answer leaves the list out rather than costing the relaunch — never empty, which
// would read as a branch with no changes.
async function read_paths(): Promise<Array<string> | undefined> {
	try {
		return await changed_paths.read_changed_paths(false)
	} catch {
		return undefined
	}
}

async function changed_of(): Promise<Pick<StopContext, 'changed' | 'more_changed'>> {
	const paths = await read_paths()

	if (paths === undefined) return { more_changed: 0 }

	return {
		changed: paths.slice(0, CHANGED_PATH_LIMIT),
		more_changed: Math.max(0, paths.length - CHANGED_PATH_LIMIT),
	}
}

async function build(issue: string, output: string): Promise<StopContext> {
	return { ...(await excerpt_of(issue, output)), ...(await changed_of()) }
}

function has_excerpt(context: StopContext | undefined): boolean {
	return context !== undefined && context.excerpt.length > 0
}

function excerpt_heading(issue: string, omitted: Omitted | undefined): string {
	if (omitted === undefined) return 'The failed stage output:'

	const source = omitted.path ?? `the stopped report (\`${run_ship_next.COMMAND.LOG} ${issue}\`)`
	const range = `lines 1-${String(omitted.last_line)} are in ${source}`

	return `The failed stage output (its last ${String(EXCERPT_LINE_LIMIT)} lines; ${range}):`
}

function changed_text(context: StopContext): string {
	if (context.changed === undefined) return 'The changed files could not be read from git.'

	if (context.changed.length === 0) return 'No files changed against the default branch.'

	const more = context.more_changed > 0 ? ` (and ${String(context.more_changed)} more)` : ''

	return `Changed files on the branch: ${context.changed.join(', ')}${more}.`
}

// The block the ship-stop prompt carries between the next command and the closing invocation.
function describe(issue: string, context: StopContext): string {
	const changed = changed_text(context)

	if (!has_excerpt(context)) return changed

	return [excerpt_heading(issue, context.omitted), ...context.excerpt, changed].join(LINE_BREAK)
}

const run_ship_stop_context = {
	CHANGED_PATH_LIMIT,
	EXCERPT_LINE_LIMIT,
	build,
	describe,
	has_excerpt,
	stop_context_schema,
}

export type { StopContext }
export { run_ship_stop_context }
