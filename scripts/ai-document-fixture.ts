import { readdirSync, readFileSync } from 'node:fs'
import { package_file, SKILL_ROOT } from './skill-fixture'

// Where the rules live, for every marker suite that checks one is present.
//
// **There is one rule document, not three.** `AGENTS.md` and `GEMINI.md` used to be near-identical
// copies of `CLAUDE.md`, so every marker suite asserted the same rule three times and every rule
// change had to be written three times. joshuafolkken/kit#963 single-sourced the rules into
// `CLAUDE.md` and turned the other two into pointers to it — the clone the rules themselves
// prohibit, removed from the documents that state the prohibition.
//
// `AI_DOCS` stays an array rather than becoming a bare string. Twenty suites iterate it with
// `it.each`, and their case names, their failure messages and the shape of their assertions all
// read off it; collapsing it to a scalar would rewrite twenty files to say the same thing. It also
// leaves the door open should a second tool ever need rules of its own that genuinely differ.
const AI_DOCS: ReadonlyArray<string> = ['CLAUDE.md']

// The documents that carry no rules and only point at the one that does. Guarded by
// `ai-document-pointers.test.ts`, which is what stops a rule being pasted back into them.
const POINTER_DOCS: ReadonlyArray<string> = ['AGENTS.md', 'GEMINI.md']

// The document the pointers name. Written once so the pointer suite and the pointers agree.
const CANONICAL_DOC = 'CLAUDE.md'
// The canonical workflow document. joshuafolkken/kit#965 split it into one file per topic under
// `prompts/collaboration-workflow/`, leaving this path as a small index — an agent following a
// pointer now reads one topic instead of the whole document, and pays for that one topic on every
// remaining turn of the session rather than all of them.
//
// The marker suites read the whole corpus, which is why `read_repo_file(WORKFLOW_PROMPT)` is not
// what they call: a marker asserting a canonical rule exists does not care which topic file holds
// it, and making fifteen suites each name a file would turn every future re-grouping into a
// fifteen-file edit. Reading is cheap here — this is a test process, not a session.
const WORKFLOW_PROMPT = 'prompts/collaboration-workflow.md'
const WORKFLOW_PROMPT_DIRECTORY = 'prompts/collaboration-workflow'
const CLAUDE_SETTINGS = '.claude/settings.json'
const ENV_EXAMPLE = '.env.example'
const MARKDOWN_EXTENSION = '.md'

// The index plus every topic file, in name order so the concatenation is stable.
function workflow_prompt_files(): ReadonlyArray<string> {
	const entries = readdirSync(package_file(WORKFLOW_PROMPT_DIRECTORY), { encoding: 'utf8' })

	return entries
		.filter((entry) => entry.endsWith(MARKDOWN_EXTENSION))
		.map((entry) => `${WORKFLOW_PROMPT_DIRECTORY}/${entry}`)
		.toSorted((left, right) => left.localeCompare(right))
}

function read_workflow_prompt(): string {
	const index = readFileSync(package_file(WORKFLOW_PROMPT), 'utf8')
	const topics = workflow_prompt_files().map((path) => readFileSync(package_file(path), 'utf8'))

	return [index, ...topics].join('\n')
}

function read_repo_file(relative_path: string): string {
	if (relative_path === WORKFLOW_PROMPT) return read_workflow_prompt()

	return readFileSync(package_file(relative_path), 'utf8')
}

// Prose is re-wrapped by the formatter, so a marker that happens to span a line break would fail on
// a reflow that changed nothing. Matching against collapsed whitespace pins the words, not the
// column they landed in. Every marker suite needs this, which is why it lives here rather than being
// re-declared once per suite (joshuafolkken/kit#951).
function read_unwrapped(relative_path: string): string {
	return read_repo_file(relative_path).replaceAll(/\s+/gu, ' ')
}

// Every markdown file under the distributed skills, sorted so the concatenation below is stable
// whatever order the filesystem hands them back in.
function skill_documents(): ReadonlyArray<string> {
	const entries = readdirSync(package_file(SKILL_ROOT), { encoding: 'utf8', recursive: true })

	return entries
		.filter((entry) => entry.endsWith(MARKDOWN_EXTENSION))
		.map((entry) => `${SKILL_ROOT}/${entry}`)
		.toSorted((left, right) => left.localeCompare(right))
}

// joshuafolkken/kit#854 moved the conditional rules — the workflow procedures, the post-update
// checks — out of the always-loaded documents and into the skills those documents route to. A rule
// still has to exist exactly once and reach every AI, but "where it is written" is now two places
// rather than one, so a marker suite reads the surface: the document plus EVERY distributed skill,
// not only the ones that document names. A suite reading the document alone would report the
// routing itself as the rule going missing.
//
// Taking every skill is the deliberate half of the trade. It keeps this list from being a second
// place to remember a skill, at the cost of coupling the negative assertions to skills they were
// not written about — a future skill that uses a retired phrase in prose fails a suite naming the
// AI documents. The message will point at the wrong file; the phrase it names is still the one to
// look for, and adding it here is one line.
//
// The per-document iteration is kept even though `AI_DOCS` now holds one entry. It is what makes a
// resident marker fail on the document it went missing from rather than on the concatenation of
// everything, and it is the seam a second rule document would slot into.
function rule_surface_documents(document_path: string): ReadonlyArray<string> {
	return [document_path, ...skill_documents()]
}

function read_rule_surface(document_path: string): string {
	return rule_surface_documents(document_path)
		.map((path) => read_repo_file(path))
		.join('\n')
}

// The rule-surface counterpart of `read_unwrapped`, for the same reason: a marker that happens to
// span a line break would otherwise fail on a reflow that changed nothing. Three suites predate it
// and still collapse the surface inline (`epic-plan-` / `epic-bundle-` / `epic-audit-document-rule`);
// migrating them is a change to files no current issue touches, so new suites call this instead of
// adding a fourth copy and the three are converted the next time one of them is edited.
function read_unwrapped_rule_surface(document_path: string): string {
	return read_rule_surface(document_path).replaceAll(/\s+/gu, ' ')
}

export {
	AI_DOCS,
	CANONICAL_DOC,
	CLAUDE_SETTINGS,
	ENV_EXAMPLE,
	read_repo_file,
	read_rule_surface,
	read_unwrapped_rule_surface,
	POINTER_DOCS,
	read_unwrapped,
	read_workflow_prompt,
	rule_surface_documents,
	skill_documents,
	WORKFLOW_PROMPT,
	WORKFLOW_PROMPT_DIRECTORY,
	workflow_prompt_files,
}
