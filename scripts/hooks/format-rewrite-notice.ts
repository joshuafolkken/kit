import { readFileSync } from 'node:fs'

// The rewrite half of the edit hook (joshuafolkken/kit#2314). The format hook runs prettier and
// `eslint --fix` in place after every edit, so a file the model just wrote can be rewritten out from
// under the image the model holds — and the next `Edit` against that stale image misses, then pays for
// a full re-read that rides every later request. joshuafolkken/kit#2275 built the `additionalContext`
// path this rides and joshuafolkken/kit#2296 put cspell on it; this returns the fact that the file
// changed and the region that changed, so the model reissues against current text without re-reading
// the whole file. Nothing is added when formatting left the file untouched.

// additionalContext rides back on the edit, so the changed region is cut to this bound rather than
// let a large reformat balloon the run's context — the notice is a cheaper hint than the full re-read
// it replaces, and stays cheaper only while it is bounded.
const MAX_REWRITE_CHARS = 1200
const REWRITE_TRUNCATION_NOTICE = '\n…(rewrite preview truncated)'
// The header names what the block is, since additionalContext arrives with no framing of its own, and
// says the one thing the model has to act on: its copy is stale, so re-read before the next edit.
const REWRITE_HEADER =
	'The format hook rewrote this file after your edit, so your in-memory copy is now stale — re-read it before the next Edit or the match will miss.'
const REWRITE_RANGE_PREFIX = 'Changed around lines '
const LINE_SEPARATOR = '\n'
const FIRST_LINE = 1

// The span of the post-format file that differs from the pre-format one — the common head and tail
// are trimmed so the range points at what actually moved rather than the whole file.
interface ChangedRange {
	start_line: number
	end_line: number
	body: string
}

function common_prefix_length(before: ReadonlyArray<string>, after: ReadonlyArray<string>): number {
	const limit = Math.min(before.length, after.length)
	let index = 0

	while (index < limit && before[index] === after[index]) index += 1

	return index
}

function common_suffix_length(
	before: ReadonlyArray<string>,
	after: ReadonlyArray<string>,
	prefix: number,
): number {
	const limit = Math.min(before.length, after.length) - prefix
	let index = 0

	while (index < limit && before.at(-1 - index) === after.at(-1 - index)) index += 1

	return index
}

function changed_range(before: string, after: string): ChangedRange {
	const before_lines = before.split(LINE_SEPARATOR)
	const after_lines = after.split(LINE_SEPARATOR)
	const prefix = common_prefix_length(before_lines, after_lines)
	const last = after_lines.length - common_suffix_length(before_lines, after_lines, prefix)

	return {
		start_line: prefix + FIRST_LINE,
		end_line: Math.max(prefix + FIRST_LINE, last),
		body: after_lines.slice(prefix, last).join(LINE_SEPARATOR),
	}
}

function cap_body(body: string): string {
	if (body.length <= MAX_REWRITE_CHARS) return body

	return `${body.slice(0, MAX_REWRITE_CHARS)}${REWRITE_TRUNCATION_NOTICE}`
}

// The block the model reads: the header, the line range, then the region's new text cut to the bound.
// `undefined` when formatting changed nothing, so the ordinary edit adds nothing to additionalContext.
function build(before: string, after: string): string | undefined {
	if (before === after) return undefined

	const range = changed_range(before, after)
	const location = `${REWRITE_RANGE_PREFIX}${String(range.start_line)}-${String(range.end_line)}:`

	return `${REWRITE_HEADER}\n${location}\n${cap_body(range.body)}`
}

// The file content around a format run, read for the before/after comparison. A path the hook was
// handed nothing for, or one gone by the time it reads, compares as an empty string rather than
// throwing — the hook runs after the write already succeeded and must never turn it into a failure.
function read_text(file_path: string | undefined): string {
	if (file_path === undefined) return ''

	try {
		return readFileSync(file_path, 'utf8')
	} catch {
		return ''
	}
}

const rewrite_notice = { build, read_text }

export { rewrite_notice, MAX_REWRITE_CHARS }
