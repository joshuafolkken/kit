import { markdown_section } from '#scripts/issue/markdown-section'

// A plan's existing-consumers section (`HEADING`) — the existing code, prompts and documents that
// read or write each state, command, label, file or process the plan adds or changes, and what this
// issue does with each. A concept added without it shipped while its readers still assumed the old
// world (joshuafolkken/kit#4270, #4265 after `lane:pause`), so `issue:plan` refuses a plan that omits
// it.
//
// **"None" is an answer only with its reason** (`NONE_WITH_REASON`), since a bare "none" cannot be
// told from a section filled in to get past the check.

const HEADING = '### 影響を受ける既存の利用者'
const ANY_HEADING = /^#{1,6}\s/u
const LIST_MARKER = /^(?:[-*+]|\d+\.)\s+/u
const NONE_WORD = 'なし'
const NONE_WITH_REASON = /^なし\s*[（(]\s*\S.*[）)]$/u
const MISSING = `The plan has no \`${HEADING}\` section: list, for each state, command, label, file or process it adds or changes, the existing places that read or write it and what this issue does with each (\`pnpm josh plan:consumers <identifier...>\` drafts it), or write \`なし（<reason>）\`.`
const EMPTY = `The plan's \`${HEADING}\` section is empty: list the existing consumers, or write \`なし（<reason>）\`.`
const BARE_NONE = `The plan's \`${HEADING}\` section says \`なし\` without a reason: write \`なし（<reason>）\`.`

// The section runs to the next heading of any level, since the plan's own sections are `###`. Fenced
// lines are blanked first, so a `# comment` in a code block neither ends the section nor is an entry.
function section_entries(plan: string): ReadonlyArray<string> | undefined {
	if (!markdown_section.has_line(plan, HEADING)) return undefined
	const raw = markdown_section.section_lines(plan, HEADING).join('\n')
	const lines = markdown_section.fence_free_lines(raw)
	const end = lines.findIndex((line) => ANY_HEADING.test(line.trim()))
	const body = end === -1 ? lines : lines.slice(0, end)

	return body.map((line) => line.trim().replace(LIST_MARKER, '')).filter((line) => line !== '')
}

// "None" answers for the whole section, so only a section that opens with it is read as one — a "none"
// nested under a consumer entry is that entry's note. A reason wrapped onto later lines is joined back.
function is_bare_none(entries: ReadonlyArray<string>): boolean {
	const [first = ''] = entries

	if (!first.startsWith(NONE_WORD) || NONE_WITH_REASON.test(first)) return false

	return !NONE_WITH_REASON.test(entries.join(' '))
}

// The refusal for a plan whose section is missing, empty or a reasonless "none"; `undefined` passes.
function refusal_of(plan: string): string | undefined {
	const entries = section_entries(plan)

	if (entries === undefined) return MISSING
	if (entries.length === 0) return EMPTY

	return is_bare_none(entries) ? BARE_NONE : undefined
}

const plan_consumers_section = { HEADING, refusal_of }

export { plan_consumers_section }
