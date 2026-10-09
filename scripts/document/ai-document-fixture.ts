import { readdirSync, readFileSync } from 'node:fs'
import node_path from 'node:path'
import { package_file } from '#scripts/claude/skill-fixture'
import { PLUGIN_SKILL_DIRECTORIES } from '#scripts/sync/plugin-skill-directories'
import { document_scan } from './document-scan'

// Where the rules live, for every marker suite that checks one is present.
//
// **There is one rule document, not three.** The rules are single-sourced in `CLAUDE.md`, and
// `AGENTS.md` and `GEMINI.md` are pointers to it — so a marker suite asserts each rule once.
//
// `AI_DOCS` stays an array rather than becoming a bare string. Twenty suites iterate it with
// `it.each`, and their case names, their failure messages and the shape of their assertions all
// read off it; collapsing it to a scalar would rewrite twenty files to say the same thing. It also
// leaves the door open should a second tool ever need rules of its own that genuinely differ.
const AI_DOCS: ReadonlyArray<string> = ['CLAUDE.md']

// The documents that carry no rules and only point at the one that does. Guarded by
// `ai-document-pointers.test.ts`, which is what stops a rule being pasted back into them.
const POINTER_DOCS: ReadonlyArray<string> = ['AGENTS.md', 'GEMINI.md', '.cursorrules']

// The page a person lands on first. It routes nobody's session, but it links into `docs/` and names
// commands, so the corpus-wide scans have to read it.
const README_DOC = 'README.md'

// The document the pointers name. Written once so the pointer suite and the pointers agree.
const CANONICAL_DOC = 'CLAUDE.md'
// The canonical workflow document: a small index over one file per topic under
// `prompts/collaboration-workflow/`, so an agent following a pointer reads one topic instead of the
// whole document.
//
// The marker suites read the whole corpus, which is why `read_repo_file(WORKFLOW_PROMPT)` is not
// what they call: a marker asserting a canonical rule exists does not care which topic file holds
// it, and making fifteen suites each name a file would turn every future re-grouping into a
// fifteen-file edit. Reading is cheap here — this is a test process, not a session.
const WORKFLOW_PROMPT = 'prompts/collaboration-workflow.md'
const WORKFLOW_PROMPT_DIRECTORY = 'prompts/collaboration-workflow'
// The delivery list names each rule; which suite pins a row is maintainer detail and lives here,
// so every row's marker suite asserts its suite path against this file.
const RULE_DELIVERY_RATIONALE = 'docs/maintainers/rule-delivery-rationale.md'
const CLAUDE_SETTINGS = '.claude/settings.json'
const ENV_EXAMPLE = '.env.example'
const MARKDOWN_EXTENSION = '.md'
const PROMPT_ROOT = 'prompts'
const DOCS_ROOT = 'docs'
// The only files under `docs/` an agent is routed to read — the four command references; the rest of
// `docs/` is reference a human browses, so the byte budget (`document/document-byte-budget.ts`)
// covers these alone.
const COMMAND_REFERENCE_DOCS: ReadonlyArray<string> = [
	'docs/josh-commands.md',
	'docs/josh-commands-automation.md',
	'docs/josh-commands-run.md',
	'docs/josh-commands-backlog.md',
]
// The user-facing label and run-state page. It took the label sections out
// of the backlog command reference, which an agent is routed to, so it stays under the same budget.
const LABEL_REFERENCE_DOC = 'docs/labels-and-run-states.md'

// Every markdown file under one root, recursively, as repository-relative paths. Deliberately not
// exported: the roots that matter are the ones `routing_documents` below composes, and handing out
// the raw walker invites a suite to rebuild that list and let the two drift.
function markdown_under(root: string): ReadonlyArray<string> {
	return readdirSync(package_file(root), { encoding: 'utf8', recursive: true })
		.filter((entry) => entry.endsWith(MARKDOWN_EXTENSION))
		.map((entry) => `${root}/${entry}`)
}

// The markdown under the distributed plugin skills only. Every skill directory lives under
// `.claude/skills/` on disk, but a skill kit no longer ships — `diag`, kit's own run-measurement
// skill — is not part of the surface a consumer loads, so the distribution guards must not walk it.
// Deriving the set from `PLUGIN_SKILL_DIRECTORIES` keeps it single-sourced
// with what the plugin actually distributes rather than with whatever happens to sit on disk.
function distributed_skill_markdown(): ReadonlyArray<string> {
	return PLUGIN_SKILL_DIRECTORIES.flatMap((directory) => markdown_under(directory))
}

// Every file that can route a reader somewhere — the rule document, every distributed skill, and
// every markdown file under `prompts/` and `docs/`. Two suites check citations against this set and
// each excludes a different handful from it; the *set* is what must not drift between them, since a
// directory dropped from one copy would take its citations out of that suite's reach silently.
function routing_documents(): ReadonlyArray<string> {
	return [
		...AI_DOCS,
		...distributed_skill_markdown(),
		...markdown_under(PROMPT_ROOT),
		...markdown_under(DOCS_ROOT),
	]
}

// Every document an agent reads in full during a session — the rule document, every distributed
// skill, every workflow prompt, the four routed `docs/` command references and the label page. `document/document-byte-budget.ts`
// walks this set to assert none has grown past its recorded ceiling and that the budget names
// exactly these files. Composed from the same roots as `routing_documents`, minus the rest of
// `docs/`, so the two cannot drift on the directories they share.
function agent_read_documents(): ReadonlyArray<string> {
	return [
		...AI_DOCS,
		...distributed_skill_markdown(),
		...markdown_under(PROMPT_ROOT),
		...COMMAND_REFERENCE_DOCS,
		LABEL_REFERENCE_DOC,
	].toSorted((left, right) => left.localeCompare(right))
}

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

// The index alone, straight from disk. `read_repo_file` deliberately answers its path with the whole
// concatenated corpus so the marker suites did not have to change, which is the opposite of what a
// suite measuring or quoting the index itself needs.
function read_index(): string {
	return readFileSync(package_file(WORKFLOW_PROMPT), 'utf8')
}

// Every prose document a reader can be routed to, plus the two pointers. This is the corpus the
// structural scans walk — the command-name, label-name and link-resolution checks that replaced the
// per-phrase marker suites. The pointers are included because a broken link
// or a stale command name in `AGENTS.md` / `GEMINI.md` is as wrong as one in the rules.
function all_documents(): ReadonlyArray<string> {
	return [...routing_documents(), ...POINTER_DOCS, README_DOC]
}

// The file exactly as it sits on disk. `read_repo_file` answers the workflow index with the whole
// concatenated corpus, which a scan reporting *which* file carries a defect must not see — it would
// attribute every topic file's reference to the index. The scans read each path for itself.
function read_document(relative_path: string): string {
	return readFileSync(package_file(relative_path), 'utf8')
}

// Link targets resolved to repository-relative paths, against the linking document's directory.
function linked_paths(from: string): Array<string> {
	const directory = node_path.dirname(from)

	return document_scan
		.link_targets(read_document(from))
		.map((target) => node_path.normalize(node_path.join(directory, target)))
}

// Prose is re-wrapped by the formatter, so a marker that happens to span a line break would fail on
// a reflow that changed nothing. Matching against collapsed whitespace pins the words, not the
// column they landed in. Every marker suite needs this, which is why it lives here rather than being
// re-declared once per suite.
function read_unwrapped(relative_path: string): string {
	return read_repo_file(relative_path).replaceAll(/\s+/gu, ' ')
}

// Every markdown file under the distributed skills, sorted so the concatenation below is stable
// whatever order the filesystem hands them back in. Derived from `PLUGIN_SKILL_DIRECTORIES`, so a
// skill kit no longer ships (e.g. `diag`) is left out of the rule surface.
function skill_documents(): ReadonlyArray<string> {
	return distributed_skill_markdown().toSorted((left, right) => left.localeCompare(right))
}

// The conditional rules — the workflow procedures, the post-update checks — live in the skills the
// always-loaded documents route to. A rule still has to exist exactly once and reach every AI, but
// "where it is written" is two places rather than one, so a marker suite reads the surface: the document plus EVERY distributed skill,
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
// span a line break would otherwise fail on a reflow that changed nothing. Two suites still collapse
// the surface inline (`epic-bundle-` / `epic-audit-document-rule`); new suites call this instead of
// adding a third copy, and the two are converted the next time one of them is edited.
function read_unwrapped_rule_surface(document_path: string): string {
	return read_rule_surface(document_path).replaceAll(/\s+/gu, ' ')
}

export {
	agent_read_documents,
	AI_DOCS,
	all_documents,
	CANONICAL_DOC,
	CLAUDE_SETTINGS,
	COMMAND_REFERENCE_DOCS,
	ENV_EXAMPLE,
	linked_paths,
	PROMPT_ROOT,
	read_document,
	read_index,
	read_repo_file,
	routing_documents,
	RULE_DELIVERY_RATIONALE,
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
