import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

// joshuafolkken/kit#1063: nothing stopped a new `gh <noun> <verb>` spawn from being added.
//
// joshuafolkken/kit#1022 moved kit's GitHub calls to REST because `gh issue …` / `gh label …` /
// `gh pr …` / `gh repo …` all go through GraphQL, which a cloud session is answered 403 for. That
// epic's survey counted `exec_gh_command` call sites, so a direct `execa` / `execaSync` spawn was
// never counted at all — three were found mid-run and one file (`scripts-ai/issue-prep.ts`) was
// missed entirely, which is why joshuafolkken/kit#1042 could report the migration finished while
// `josh issue <N>` still 403'd.
//
// This scanner is the mechanical check that survey did not have. It reads **every** `.ts` file
// under `scripts/` and `scripts-ai/`, and anything it finds whose first argument is not `api` fails
// unless it is named in `ALLOWED_SPAWNS` below.
//
// **It parses rather than greps.** A regex over the text has to decide for itself what is code and
// what is a comment or a string, and it gets that wrong in both directions: a `/*` inside a string
// literal opens a comment that never closes, blanking real code for hundreds of lines, while a
// command quoted in prose is reported as a spawn. Both were measured on the first draft of this
// file. The TypeScript parser already knows the difference, so the scan walks its syntax tree and
// no heuristic is left to be wrong.
//
// What counts as launching `gh`:
//
// - a call to one of `SPAWN_FUNCTIONS` whose first argument resolves to `'gh'` — the `(file, args)`
//   shape, where the subcommand is the first element of the argument array;
// - the same call with a whole command string (`execSync('gh issue view 1')`), where the
//   subcommand is the word after `gh`;
// - execa's `` $`gh …` `` tagged template.
//
// A binary name is resolved through a string literal, a template literal with no substitution, and
// a `const` or `let` bound to either **anywhere in the same file** — `const GH = 'gh'` then
// `execa(GH, […])` is the evasion a literal-only scan misses. So is the spawn function's own name:
// `const exec_file_async = promisify(execFile)` is how a real `gh repo view` call hid in
// `scripts-ai/telegram-test.ts` from joshuafolkken/kit#1022's survey and from this guard's own
// first draft.
//
// **A binary this file cannot resolve is skipped, not reported**, and that is a deliberate limit
// rather than an oversight. `execa(resolve_bin(), […])` and a name imported from another module
// need the type checker to follow, and reporting every unresolvable binary instead would mean an
// allowlist entry for each of the dozen spawns here that launch `pnpm`, `git`, `sh` or `tsx` — an
// inventory nobody would read, which is a worse guard than a narrower one. An unresolvable
// *argument list* is different and **is** reported as `<dynamic>`: the binary is known to be `gh`
// there, so the only open question is which subcommand.
//
// This module is excluded from the published package (`package.json` → `files`), because it is used
// only by its own test and imports `typescript`, a devDependency.
//
// **Scope is code spawns only.** A distributed document that *instructs* an agent to type a `gh`
// command is joshuafolkken/kit#1064's problem; widening this guard to `prompts/` or `.claude/`
// would couple two deliverables that were deliberately kept independent.

const SCRIPTS_DIR = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(SCRIPTS_DIR, '..')

const SCANNED_DIRECTORIES: ReadonlyArray<string> = ['scripts', 'scripts-ai']
const TS_EXTENSION = '.ts'

const GH_BINARY = 'gh'
const GH_COMMAND_PREFIX = `${GH_BINARY} `
const API_SUBCOMMAND = 'api'
// Stands for an argument list built somewhere else — `to_gh_api_args(request)`, a spread, a
// variable. It is reported rather than ignored: "I could not tell" is the answer that let
// joshuafolkken/kit#1022's survey pass, so it needs an allowlist entry naming why it is safe.
const DYNAMIC_SUBCOMMAND = '<dynamic>'

// The functions that launch a binary by name. `execa` / `execaSync` are what kit uses; the node
// built-ins are here so that reaching for one of them is not a way around the guard.
const SPAWN_FUNCTIONS: ReadonlySet<string> = new Set([
	'execa',
	'execaSync',
	'execaNode',
	'exec',
	'execSync',
	'execFile',
	'execFileSync',
	'spawn',
	'spawnSync',
])
// execa's script tag: `` $`gh pr merge` ``.
const SCRIPT_TAG = '$'

// What the failure message tells the reader to do. Held here rather than in the test so a second
// caller cannot word it differently.
const GUIDANCE = [
	'Replace it with a REST request — `git_gh_exec.exec_gh_api` (or `exec_gh_api_sync` where the',
	'caller cannot await), through the helpers in `scripts/git/git-gh-issue-*.ts` and',
	'`scripts/git/git-gh-pr-*.ts`. If it genuinely is not an API call, add it to ALLOWED_SPAWNS in',
	'`scripts/gh-subcommand-guard.ts` together with the reason it is allowed.',
].join(' ')

interface AllowedSpawn {
	file: string
	subcommand: string
	reason: string
}

// The spawns that are not API calls, each with why it cannot be one. Every other `gh` spawn in the
// repository must start with `api`.
const ALLOWED_SPAWNS: ReadonlyArray<AllowedSpawn> = [
	{
		file: 'scripts/fix-gh-packages.ts',
		subcommand: 'auth',
		reason:
			'`gh auth token` prints the credential the local CLI already holds. It contacts no GitHub endpoint, so there is no REST request it could be expressed as.',
	},
	{
		file: 'scripts/git/git-gh-check.ts',
		subcommand: '--version',
		reason:
			'`gh --version` is the probe that decides whether the CLI is installed at all. It runs before every API call and contacts nothing.',
	},
	{
		file: 'scripts/git/git-gh-exec.ts',
		subcommand: DYNAMIC_SUBCOMMAND,
		reason:
			'This file is the REST layer. Its spawns forward the argument list `to_gh_api_args` built, and that builder puts `api` first unconditionally — pinned by `git-gh-exec.test.ts` and `git-gh-exec-sync.test.ts` rather than by reading the call site.',
	},
]

interface GhSpawn {
	file: string
	line: number
	subcommand: string
}

// What one file's own declarations say: which identifiers hold a plain string, and which name a
// spawn function under another name.
interface Collected {
	values: Map<string, string>
	aliases: Set<string>
}

interface Scope {
	values: ReadonlyMap<string, string>
	aliases: ReadonlySet<string>
}

function visit(node: ts.Node, on_node: (node: ts.Node) => void): void {
	on_node(node)
	ts.forEachChild(node, (child) => {
		visit(child, on_node)
	})
}

function callee_name(expression: ts.Node): string | undefined {
	if (ts.isIdentifier(expression)) return expression.text

	return ts.isPropertyAccessExpression(expression) ? expression.name.text : undefined
}

function names_spawn_function(node: ts.Node): boolean {
	const name = callee_name(node)

	return name !== undefined && SPAWN_FUNCTIONS.has(name)
}

// `const exec_file_async = promisify(execFile)` and `const run = execaSync` both launch a binary
// under a name the set above does not contain. The first of those was a real `gh repo view` spawn
// that joshuafolkken/kit#1022's survey never counted, and that the first draft of this guard did
// not see either (joshuafolkken/kit#1063).
function is_spawn_alias(initializer: ts.Expression): boolean {
	if (!ts.isCallExpression(initializer)) return names_spawn_function(initializer)

	return initializer.arguments.some((argument) => names_spawn_function(argument))
}

function record_declaration(declaration: ts.VariableDeclaration, collected: Collected): void {
	const { name, initializer } = declaration
	if (initializer === undefined || !ts.isIdentifier(name)) return

	if (ts.isStringLiteralLike(initializer)) {
		collected.values.set(name.text, initializer.text)

		return
	}

	if (is_spawn_alias(initializer)) collected.aliases.add(name.text)
}

// What the file's own declarations say. Collected in its own pass because a declaration may sit
// below the call that uses it.
function collect_scope(tree: ts.SourceFile): Scope {
	const collected: Collected = { values: new Map<string, string>(), aliases: new Set<string>() }

	visit(tree, (node) => {
		if (ts.isVariableDeclaration(node)) record_declaration(node, collected)
	})

	return collected
}

function to_string_value(node: ts.Expression, scope: Scope): string | undefined {
	if (ts.isStringLiteralLike(node)) return node.text

	return ts.isIdentifier(node) ? scope.values.get(node.text) : undefined
}

function is_spawn_call(expression: ts.LeftHandSideExpression, scope: Scope): boolean {
	const name = callee_name(expression)

	return name !== undefined && (SPAWN_FUNCTIONS.has(name) || scope.aliases.has(name))
}

// The word after `gh` in a whole command string, for the spellings that take one.
function to_command_subcommand(command: string): string {
	const [word] = command.slice(GH_COMMAND_PREFIX.length).trim().split(/\s+/u, 1)

	return word === undefined || word === '' ? DYNAMIC_SUBCOMMAND : word
}

// The first element of the argument array, which is the subcommand in the `(file, args)` shape.
function to_argument_subcommand(args: ReadonlyArray<ts.Expression>, scope: Scope): string {
	const [list] = args
	if (list === undefined || !ts.isArrayLiteralExpression(list)) return DYNAMIC_SUBCOMMAND
	const [first] = list.elements
	const value = first === undefined ? undefined : to_string_value(first, scope)

	return value ?? DYNAMIC_SUBCOMMAND
}

function to_gh_subcommand(
	command: string,
	args: ReadonlyArray<ts.Expression>,
	scope: Scope,
): string | undefined {
	if (command === GH_BINARY) return to_argument_subcommand(args, scope)

	return command.startsWith(GH_COMMAND_PREFIX) ? to_command_subcommand(command) : undefined
}

function from_call(node: ts.CallExpression, scope: Scope): string | undefined {
	if (!is_spawn_call(node.expression, scope)) return undefined
	const [binary, ...rest] = node.arguments
	const command = binary === undefined ? undefined : to_string_value(binary, scope)
	if (command === undefined) return undefined

	return to_gh_subcommand(command, rest, scope)
}

// `` $`gh …` `` and `` $({ reject: false })`gh …` `` — the tag is the identifier in the first form
// and a call on it in the second.
function from_tagged_template(node: ts.TaggedTemplateExpression): string | undefined {
	const { tag } = node
	if (callee_name(ts.isCallExpression(tag) ? tag.expression : tag) !== SCRIPT_TAG) return undefined
	const { template } = node
	const head = ts.isNoSubstitutionTemplateLiteral(template) ? template.text : template.head.text

	return head.startsWith(GH_COMMAND_PREFIX) ? to_command_subcommand(head) : undefined
}

function subcommand_of(node: ts.Node, scope: Scope): string | undefined {
	if (ts.isCallExpression(node)) return from_call(node, scope)

	return ts.isTaggedTemplateExpression(node) ? from_tagged_template(node) : undefined
}

function line_of(tree: ts.SourceFile, node: ts.Node): number {
	return tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1
}

// Every `gh` spawn in one file, whatever shape it is written in.
function find_gh_spawns(source: string, file: string): Array<GhSpawn> {
	const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
	const scope = collect_scope(tree)
	const spawns: Array<GhSpawn> = []

	visit(tree, (node) => {
		const subcommand = subcommand_of(node, scope)

		if (subcommand !== undefined) spawns.push({ file, line: line_of(tree, node), subcommand })
	})

	return spawns
}

function is_allowed(spawn: GhSpawn): boolean {
	if (spawn.subcommand === API_SUBCOMMAND) return true

	return ALLOWED_SPAWNS.some(
		(entry) => entry.file === spawn.file && entry.subcommand === spawn.subcommand,
	)
}

function describe_violation(spawn: GhSpawn): string {
	return `${spawn.file}:${String(spawn.line)} spawns \`gh ${spawn.subcommand}\` — ${GUIDANCE}`
}

function to_posix(entry: string): string {
	return entry.split(path.sep).join('/')
}

function source_files(directory: string): Array<string> {
	return readdirSync(path.join(REPO_ROOT, directory), { recursive: true, encoding: 'utf8' })
		.filter((entry) => entry.endsWith(TS_EXTENSION))
		.map((entry) => `${directory}/${to_posix(entry)}`)
}

function scan_file(file: string): Array<GhSpawn> {
	return find_gh_spawns(readFileSync(path.join(REPO_ROOT, file), 'utf8'), file)
}

function scan_directory(directory: string): Array<GhSpawn> {
	return source_files(directory).flatMap((file) => scan_file(file))
}

function scan_repository(): Array<GhSpawn> {
	return SCANNED_DIRECTORIES.flatMap((directory) => scan_directory(directory))
}

const gh_subcommand_guard = {
	find_gh_spawns,
	is_allowed,
	describe_violation,
	source_files,
	scan_repository,
	ALLOWED_SPAWNS,
	SCANNED_DIRECTORIES,
	API_SUBCOMMAND,
	DYNAMIC_SUBCOMMAND,
	GUIDANCE,
}

export type { GhSpawn }
export { gh_subcommand_guard }
