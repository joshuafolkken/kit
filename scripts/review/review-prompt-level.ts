import { file_reader } from '#scripts/lib/read-file'

// **A reviewer's launch prompt opens with its review level** (joshuafolkken/kit#5555): the level sits on
// the brief's first line, which the prompt only points at, so a transcript never carried it and
// `josh lane:breakdown` printed `round 1` where it means `round 1 · medium`. The prompt stays one line —
// a detached launch refuses a control character — so the level leads it before a separator, and the
// transcript reader reads it back with the same pattern.

const LEVEL_PATTERN = /^(low|medium|high|xhigh|max)(?:$| — )/u
const SEPARATOR = ' — '

// The level a line opens with — a brief's bare first line or a prompt's lead — `undefined` otherwise.
function level_of(line: string): string | undefined {
	return LEVEL_PATTERN.exec(line)?.[1]
}

// The lead a prompt pointing at `brief_path` opens with: its level and the separator, or nothing for a
// brief not written or not opening with a level.
function opening(brief_path: string): string {
	const [first = ''] = (file_reader.read_if_readable(brief_path) ?? '').split('\n', 1)
	const level = level_of(first.trim())

	return level === undefined ? '' : `${level}${SEPARATOR}`
}

const review_prompt_level = { level_of, opening }

export { review_prompt_level }
