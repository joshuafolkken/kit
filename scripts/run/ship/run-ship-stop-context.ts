import { stripVTControlCharacters } from 'node:util'
import { agent_role_profile } from '#scripts/agent/agent-role-profile'
import { changed_paths } from '#scripts/git/changed-paths'
import { stamp_file } from '#scripts/josh/stamp-file'
import { review_prior_findings } from '#scripts/review/review-prior-findings'
import { z } from 'zod'
import { run_ship_next } from './run-ship-next'
import { run_ship_probe } from './run-ship-probe'
import type { StopFinding } from './run-ship-review'

// What a relaunched lane child needs in front of it to fix a stopped ship: the tail of the failed
// stage's output — a red check, or the High/Medium findings a review stage reports — and the branch's
// changed files. Without them the resumed session opened `josh ship --log` and `git diff` itself before
// doing anything (joshuafolkken/kit#3923).
//
// **Both are bounded**, so a long gate log never becomes the whole prompt. The tail is kept because a
// check reports its verdict last; the lines left out go to a file whose path and line range the prompt
// names, so nothing is lost and the session reads only the range it needs.
//
// **A review stop also carries the lane's earlier findings on the files it cites** (joshuafolkken/kit#4780),
// so the fix meets the constraint an earlier round set on the same line rather than breaking it.

const EXCERPT_LINE_LIMIT = 40
const EXCERPT_LINE_WIDTH = 240
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
		prior: z.array(z.string()).readonly().optional(),
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
		.map((line) => agent_role_profile.printable(shown_frame(line)))
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

// A line is cut to a width, so one minified or wrapped line cannot spend the prompt's whole budget.
function clipped(lines: ReadonlyArray<string>): Array<string> {
	return lines.map((line) => line.slice(0, EXCERPT_LINE_WIDTH))
}

async function excerpt_of(
	issue: string,
	output: string,
): Promise<Pick<StopContext, 'excerpt' | 'omitted'>> {
	const lines = output.trim() === '' ? [] : output_lines(output)

	if (lines.length <= EXCERPT_LINE_LIMIT) return { excerpt: clipped(lines) }

	return {
		excerpt: clipped(lines.slice(-EXCERPT_LINE_LIMIT)),
		omitted: await omitted_range(issue, lines),
	}
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

async function build(
	issue: string,
	output: string,
	findings: ReadonlyArray<StopFinding> = [],
): Promise<StopContext> {
	const prior = review_prior_findings.on_files(issue, findings)

	return {
		...(await excerpt_of(issue, output)),
		...(await changed_of()),
		...(prior.length > 0 && { prior }),
	}
}

function has_excerpt(context: StopContext | undefined): boolean {
	return context !== undefined && context.excerpt.length > 0
}

function excerpt_heading(issue: string, omitted: Omitted | undefined, shown: number): string {
	if (omitted === undefined) return 'The failed stage output:'

	const source = omitted.path ?? `the stopped report (\`${run_ship_next.COMMAND.LOG} ${issue}\`)`
	const range = `lines 1-${String(omitted.last_line)} are in ${source}`

	return `The failed stage output (its last ${String(shown)} lines; ${range}):`
}

// The head lines a budget leaves out join the range the heading names; the file, when one was kept,
// still holds every line.
function with_dropped(omitted: Omitted | undefined, dropped: number): Omitted | undefined {
	if (dropped === 0) return omitted

	return { ...omitted, last_line: (omitted?.last_line ?? 0) + dropped }
}

function excerpt_block(
	issue: string,
	context: StopContext,
	changed: string,
	dropped: number,
): string {
	const shown = context.excerpt.slice(dropped)
	const heading = excerpt_heading(issue, with_dropped(context.omitted, dropped), shown.length)

	return [heading, ...shown, changed].join(LINE_BREAK)
}

function changed_text(context: StopContext): string {
	if (context.changed === undefined) return 'The changed files could not be read from git.'

	if (context.changed.length === 0) return 'No files changed against the default branch.'

	const more = context.more_changed > 0 ? ` (and ${String(context.more_changed)} more)` : ''

	return `Changed files on the branch: ${context.changed.join(', ')}${more}.`
}

function trailer_text(context: StopContext): string {
	return [changed_text(context), ...review_prior_findings.fix_lines(context.prior)].join(LINE_BREAK)
}

function fitted_block(issue: string, context: StopContext, budget: number): string {
	const changed = trailer_text(context)

	if (!has_excerpt(context)) return changed

	let dropped = 0
	let block = excerpt_block(issue, context, changed, dropped)

	while (block.length > budget && dropped < context.excerpt.length - 1) {
		dropped += 1
		block = excerpt_block(issue, context, changed, dropped)
	}

	return block
}

function has_prior(context: StopContext): boolean {
	return context.prior !== undefined && context.prior.length > 0
}

// The block the ship-stop prompt carries between the next command and the closing invocation.
//
// **It fits the `budget` the prompt leaves it** — the prompt is one argv element, kept within
// `MAX_VALUE_LENGTH` (joshuafolkken/kit#3964), well under the launch gate's prompt cap — by dropping
// the excerpt's head first, since a check
// reports its verdict last; the tail line always stays. Past that, the earlier findings go oldest first.
function describe(
	issue: string,
	context: StopContext,
	budget: number = agent_role_profile.MAX_VALUE_LENGTH,
): string {
	let fitted = context
	let block = fitted_block(issue, fitted, budget)

	while (block.length > budget && has_prior(fitted)) {
		fitted = { ...fitted, prior: fitted.prior?.slice(1) }
		block = fitted_block(issue, fitted, budget)
	}

	return block
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
