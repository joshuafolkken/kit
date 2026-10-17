import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { cost_tokens } from '#scripts/cost-runtime/cost-tokens'
import { document_section } from '#scripts/document/document-section'
import { distributed_paths } from '#scripts/init/distributed-paths'
import { find_package_directory } from '#scripts/josh/package-directory'
import { stamp_file } from '#scripts/josh/stamp-file'

interface LaneSet {
	text: string
	rules_path: string
}

// **A headless lane child or review session starts from the lane instruction set, not `CLAUDE.md`.**
// `CLAUDE.md` carries rules only an interactive session can act on — consultation versus execution,
// explicit workflow invocation, stop notifications — and every request re-reads it. The lane document
// names the rules a lane does need by `CLAUDE.md` heading or bold label, and each `include` line is
// expanded from the launch checkout's own `CLAUDE.md` here, so the rule text keeps one source (#3929).
const LANE_DOCUMENT = 'prompts/collaboration-workflow/lane-instructions.md'
const RULES_FILE = 'CLAUDE.md'
// `AGENTS.md` only points at `CLAUDE.md`, and Claude Code loads it once `CLAUDE.md` is excluded.
const POINTER_FILE = 'AGENTS.md'
const INCLUDE_PATTERN = /^<!-- include: CLAUDE\.md → "(?<wanted>.+)" -->$/u
const PROMPT_FILE_FLAG = '--append-system-prompt-file'
const SETTINGS_FLAG = '--settings'
const PROMPT_FILE_PREFIX = 'josh-lane-instructions-'
const PROMPT_FILE_SUFFIX = '.md'
const PACKAGE_DIRECTORY = find_package_directory(path.dirname(fileURLToPath(import.meta.url)))

// An include that resolves to nothing is `undefined`, never an empty string, so a renamed heading
// fails the whole composition rather than silently dropping a rule.
function expand_line(line: string, rules: string): string | undefined {
	const wanted = INCLUDE_PATTERN.exec(line)?.groups?.['wanted']

	if (wanted === undefined) return line

	return document_section.section(rules, wanted)?.text
}

function compose(lane_markdown: string, rules: string): string | undefined {
	const expanded = lane_markdown.split('\n').map((line) => expand_line(line, rules))

	if (expanded.includes(undefined)) return undefined

	return expanded.join('\n')
}

// **Where the rules are: the checkout's `CLAUDE.md`, else the package copy it imports.** kit and a
// consumer holding a full copy keep them in `CLAUDE.md`; a consumer written by `josh init` imports
// them from the package, and its own `CLAUDE.md` — the bootstrap note and the project's additions —
// stays loaded, because only the file the set was composed from is excluded.
function rules_sources(cwd: string): ReadonlyArray<string> {
	const imported = distributed_paths.CLAUDE_MD_IMPORT_LINE.replace(/^@/u, '')

	return [path.join(cwd, RULES_FILE), path.join(cwd, imported)]
}

function composed_from(lane_markdown: string, rules_path: string): string | undefined {
	const rules = document_section.read_optional(rules_path)

	return rules === undefined ? undefined : compose(lane_markdown, rules)
}

function composed_set(cwd: string, package_directory: string): LaneSet | undefined {
	const lane_markdown = document_section.read_optional(path.join(package_directory, LANE_DOCUMENT))

	if (lane_markdown === undefined) return undefined

	for (const rules_path of rules_sources(cwd)) {
		const text = composed_from(lane_markdown, rules_path)

		if (text !== undefined) return { text, rules_path }
	}

	return undefined
}

function composed_in(
	cwd: string,
	package_directory: string = PACKAGE_DIRECTORY,
): string | undefined {
	return composed_set(cwd, package_directory)?.text
}

// Named by its content and this account, so concurrent launches of the same text share one file and a
// changed `CLAUDE.md` never reuses a stale one. The name is predictable in a temp directory other
// accounts may write to, so an existing file is reused only when it is this account's own regular file
// holding exactly this text; anything else is replaced through `stamp_file`, which refuses another
// account's file and renames a new one into place whole. A file rather than the text itself, because
// the launcher refuses a line break in any argv element but the prompt.
function written(text: string): string | undefined {
	const file_path = stamp_file.stamp_path(PROMPT_FILE_PREFIX, text, PROMPT_FILE_SUFFIX)

	if (stamp_file.read_stamp_text(file_path) === text) return file_path

	try {
		return stamp_file.replace_text_stamp(file_path, text)
	} catch {
		return undefined
	}
}

function excluded_settings(rules_path: string, cwd: string): string {
	return JSON.stringify({ claudeMdExcludes: [rules_path, path.join(cwd, POINTER_FILE)] })
}

// No flags when the set cannot be composed or safely written: the child then loads `CLAUDE.md` as
// before, which costs tokens but never loses a rule.
function flags(cwd: string = process.cwd()): ReadonlyArray<string> {
	const set = composed_set(cwd, PACKAGE_DIRECTORY)
	const prompt_file = set === undefined ? undefined : written(set.text)

	if (set === undefined || prompt_file === undefined) return []

	return [PROMPT_FILE_FLAG, prompt_file, SETTINGS_FLAG, excluded_settings(set.rules_path, cwd)]
}

function tokens_of(text: string): string {
	return cost_tokens.estimate(text).toLocaleString('en-US')
}

// `read:set lane-child`'s resident line: what each lane request carries in place of the rules file.
function rules_tokens(rules_path: string): string {
	return tokens_of(document_section.read_optional(rules_path) ?? '')
}

function resident_line(cwd: string = process.cwd()): string {
	const set = composed_set(cwd, PACKAGE_DIRECTORY)
	const rules = rules_tokens(set?.rules_path ?? path.join(cwd, RULES_FILE))
	const lane_tokens = set === undefined ? 'not composed' : `${tokens_of(set.text)} tok`

	return `  resident: lane instructions ${lane_tokens} in place of ${RULES_FILE} ${rules} tok`
}

const lane_instructions = {
	PROMPT_FILE_FLAG,
	SETTINGS_FLAG,
	compose,
	composed_in,
	flags,
	resident_line,
}

export { lane_instructions }
