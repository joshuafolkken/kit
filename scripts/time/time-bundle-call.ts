import { cost_blocks } from '#scripts/cost/cost-blocks'
import { json_value } from '#scripts/json-value'
import { time_shell } from './time-shell'

const { BASH_TOOL } = cost_blocks

// What one call has to say about itself before anything can ask whether it could have gone out
// beside another (joshuafolkken/kit#1344).
//
// `time-round-trips.ts` counts how many times a run stopped, and `time-density.ts` says the count is
// too high while the run is still going. Neither can say **which** of those stops were avoidable, and
// that is the number joshuafolkken/kit#1344 was filed for: the estimate it carries — 33 of 136 round
// trips — was arithmetic on a target density, not a reading of what the run actually did.
//
// **Two facts, and both have to be read while the input is in hand.** A span keeps no input, for the
// reason `time-spans.ts` states beside `marker`: the tool's input is what decides the answer, and by
// the time anything aggregates, the input is gone. So this module answers at parse time and the span
// carries the answers, exactly as it already carries the phase marker.
//
// **The kind is an allow-list, never a deny-list.** A tool nobody classified must not count as
// bundleable merely because nobody excluded it — that is the direction that inflates the very figure
// this exists to establish. A missed entry under-reports, which is a floor; a wrong inclusion
// over-reports, which is a claim.
//
// **The targets are what makes a dependency visible without reading any output.** A call's result is
// deliberately not retained anywhere in this pipeline, so "did this call need that one's answer" can
// only be asked of the inputs. Two calls naming the same path — or one naming a directory the other
// reads inside of — are treated as ordered, which catches the search-then-read pair that is the most
// common real dependency in these transcripts. It also treats an unrelated pair that happens to share
// a path as ordered, which is the conservative half of the same rule.

// The tools whose calls are independent of one another by nature: they read, or they write a region
// of a file the harness applies in the order the turn issued them. Everything absent — `Task`,
// `Skill`, `AskUserQuestion`, `TodoWrite` — is either a delegation whose result the next call needs,
// or a stop for a person.
const BUNDLEABLE_TOOLS = new Set(['Edit', 'Glob', 'Grep', 'Read', 'WebFetch', 'WebSearch', 'Write'])

// The shell commands that inspect. A `Bash` call is bundleable only when its leading command — the
// word `time-spans.ts` already reads to label the row — is one of these.
//
// **`gh` is here because the Issue names `gh` queries as one of the three shapes that went out one
// per turn**, and its writes are excluded by the word scan below rather than by leaving the command
// out entirely. `git` is deliberately absent: `git status` and `git switch` are one word apart, and no
// reading of the leading word can tell them apart.
const READ_COMMANDS = new Set([
	'awk',
	'basename',
	'cat',
	'comm',
	'cut',
	'diff',
	'dirname',
	'du',
	'echo',
	'file',
	'find',
	'gh',
	'grep',
	'head',
	'jq',
	'ls',
	'nl',
	'printf',
	'pwd',
	'realpath',
	'rg',
	// **`sed -i` is deliberately not excluded.** An in-place edit is what `Edit` does, and `Edit` is on
	// the allow-list above — a turn may issue several of them, so rejecting the shell spelling of the
	// same thing would exclude a call the tool form counts. Two in-place edits of the *same* file are
	// caught by the target test instead, which is where that ordering actually lives.
	'sed',
	'sort',
	'stat',
	'tail',
	'tree',
	'uniq',
	'wc',
	'which',
])

// Any of these anywhere in the command disqualifies it, whatever the leading word was. A chain is
// labelled by its first segment — `cat a && rm b` reads as `Bash: cat` — so the leading word alone
// says nothing about what the rest of the line does.
//
// **The `gh` write verbs are in the same set rather than a second one.** A scan that finds `create`
// inside a `grep` pattern rejects that call too, which is a call under-counted rather than a mutation
// counted as a read — the direction every rule in this module leans.
//
// **A redirection is deliberately absent.** `echo x > file` writes a file, which is what `Write` does,
// and `Write` is on the allow-list above — a turn may issue several of them, so rejecting the shell
// spelling of the same thing would exclude a call the tool form counts. What is rejected is work that
// changes state *other calls in the same turn would have to be ordered against*: the filesystem
// removals, and the `gh` verbs that write to GitHub.
const MUTATION_WORDS = new Set([
	'--field',
	'--method',
	'--raw-field',
	'-F',
	'-X',
	'-delete',
	'-exec',
	'-f',
	'add',
	'chmod',
	'chown',
	'close',
	'comment',
	'cp',
	'create',
	'dd',
	'delete',
	'edit',
	'git',
	'install',
	'kill',
	'ln',
	'merge',
	'mkdir',
	'mv',
	'node',
	'npm',
	'npx',
	'pkill',
	'pnpm',
	'remove',
	'rm',
	'scp',
	'secret',
	'set',
	'ssh',
	'sudo',
	'tee',
	'touch',
	'truncate',
	'tsx',
	'upload',
	'wget',
])

// The input fields whose value *is* a target. Deliberately not every string field: `old_string`,
// `new_string` and `content` carry file bodies, and tokenizing those would pull every path the file
// happens to mention into the call's target set — where it would make unrelated calls look ordered.
const TARGET_FIELDS = ['file_path', 'notebook_path', 'path', 'url']

// How many targets one call contributes. A `find` line naming twenty paths says nothing more about
// what it depends on than its first few do, and the set is carried on every span of a run.
const MAX_TARGETS = 8

const WORD_PATTERN = /[\s'"=(),;:|&]+/u
// The extension a path-shaped word may end in. Tested on the suffix alone rather than as an anchored
// alternation over the whole word, which backtracks super-linearly on a long token.
const EXTENSION_PATTERN = /^[A-Za-z]+$/u
const MAX_EXTENSION = 5
const AFTER_DOT = 1
// A dot at index 0 is a dotfile, not an extension, and `lastIndexOf` answers -1 for no dot at all.
const FIRST_INDEX = 0
// Trimmed with `startsWith` / `endsWith` rather than a regex: an unanchored `[…]+$` backtracks
// super-linearly on a long token, and the two forms that actually occur are one leading `./` and one
// trailing separator.
const CURRENT_DIRECTORY = './'
const LAST_CHARACTER = -1
const FLAG_PREFIX = '-'
const PATH_SEPARATOR = '/'
const MIN_TARGET_LENGTH = 3

// What a span carries so the sequences can be found later.
interface BundleFacts {
	is_bundleable: boolean
	targets: ReadonlyArray<string>
}

// A function rather than a shared constant, so no two calls end up holding one `targets` array —
// belt and braces beside the `ReadonlyArray` above, which is what actually stops a writer. The two
// span constants in `time-spans.ts` are module-level and would otherwise share one array between
// every model and human span of a run.
function not_bundleable(): BundleFacts {
	return { is_bundleable: false, targets: [] }
}

function words_of(command: string): Array<string> {
	return command.split(WORD_PATTERN).filter((word) => word !== '')
}

// **A word is compared verbatim, never lower-cased or stripped of its flag dash.** `-X` is a flag and
// `-x` is a different one, and folding case would put both in one bucket. It does **not** keep a read
// out of the set: `-f` and `-F` are in it for `gh`, so `grep -F 'literal' path` is rejected too — a
// call under-counted, which is the direction this module leans everywhere.
function has_mutation(command: string): boolean {
	return words_of(command).some((word) => MUTATION_WORDS.has(word))
}

// `./scripts/x.ts` and `scripts/x.ts` are the same file, and a trailing slash on a directory is
// noise. Normalized here so the prefix comparison downstream is a plain string test rather than a
// path library's.
function normalize(word: string): string {
	const head = word.startsWith(CURRENT_DIRECTORY) ? word.slice(CURRENT_DIRECTORY.length) : word

	return head.endsWith(PATH_SEPARATOR) ? head.slice(0, LAST_CHARACTER) : head
}

// Path-shaped: it holds a separator, or it ends in a short extension. Either is enough to be worth
// comparing; a bare word like `scripts` is not, because it collides with prose.
function has_extension(word: string): boolean {
	const dot = word.lastIndexOf('.')

	if (dot <= FIRST_INDEX) return false

	const suffix = word.slice(dot + AFTER_DOT)

	return suffix.length <= MAX_EXTENSION && EXTENSION_PATTERN.test(suffix)
}

function is_target(word: string): boolean {
	if (word.startsWith(FLAG_PREFIX) || word.length < MIN_TARGET_LENGTH) return false

	return word.includes(PATH_SEPARATOR) || has_extension(word)
}

function targets_in(text: string): Array<string> {
	return words_of(text)
		.map((word) => normalize(word))
		.filter((word) => is_target(word))
		.slice(0, MAX_TARGETS)
}

function field_text(input: unknown, field: string): string {
	if (!json_value.is_record(input)) return ''

	const value = input[field]

	return typeof value === 'string' ? value : ''
}

// A non-`Bash` tool names its target in a field, so the value is taken whole rather than tokenized: a
// path containing a space is one target, and splitting it would produce two that match nothing.
function tool_targets(input: unknown): Array<string> {
	return TARGET_FIELDS.map((field) => normalize(field_text(input, field)))
		.filter((value) => value !== '')
		.slice(0, MAX_TARGETS)
}

// The facts for a call that is not `Bash`. The tool name decides the kind; the input decides the
// targets, and a tool that is not bundleable still has none read — nothing ever asks.
function tool_facts(name: string, input: unknown): BundleFacts {
	if (!BUNDLEABLE_TOOLS.has(name)) return not_bundleable()

	return { is_bundleable: true, targets: tool_targets(input) }
}

// The facts for a `Bash` call. The leading command comes from `time-shell.ts` rather than from a
// second reader here — the two answers have to be the same one, or a call could be labelled by one
// command and classified by another.
function bash_facts(command: string): BundleFacts {
	if (!READ_COMMANDS.has(time_shell.leading_word(command)) || has_mutation(command)) {
		return not_bundleable()
	}

	return { is_bundleable: true, targets: targets_in(command) }
}

// The facts for one call named the way a caller holding a raw tool invocation names it — a tool and
// its input, with nothing unwrapped yet (joshuafolkken/kit#1390).
//
// **It exists so the live guard and the parser cannot disagree about what a call is.** `time-spans.ts`
// reaches the two functions above directly because it has already read the shell command out of the
// input for the row's label; a `PreToolUse` payload has no such head start, and a second place
// remembering that `Bash` is the one tool whose input needs unwrapping is exactly the drift that would
// let a call be refused as bundleable and then counted as not.
function call_facts(name: string, input: unknown): BundleFacts {
	if (name !== BASH_TOOL) return tool_facts(name, input)

	return bash_facts(time_shell.bash_command(input))
}

const time_bundle_call = {
	MAX_TARGETS,
	not_bundleable,
	bash_facts,
	call_facts,
	tool_facts,
	// Exported for the batching guard's own word scan (joshuafolkken/kit#1390), so the two scanners
	// cannot come to disagree about where one word of a shell line ends and the next begins.
	words_of,
}

export type { BundleFacts }
export { time_bundle_call }
