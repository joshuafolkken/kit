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

// The tools that write. **Kept here rather than in the guard** (joshuafolkken/kit#1509): the guard
// held its own copy, and the sequence builder had no way to ask at all — so a run of edits to one
// file was read as a chain of dependent calls and no sequence ever formed. One answer, one place.
const WRITING_TOOLS: ReadonlySet<string> = new Set(['Edit', 'Write', 'NotebookEdit'])

// A shell line that writes even though its leading word reads. `sed` is the one that matters — it is
// in `READ_COMMANDS` because `sed -n` is a read, so `sed -i` would otherwise be classified as one.
const WRITING_WORDS: ReadonlySet<string> = new Set(['dd', 'sed', 'tee'])

const REDIRECTION = '>'

// The one bundleable shell spelling of an edit. `sed -n` prints and `sed -i` rewrites, so the flag is
// the whole of the difference.
const IN_PLACE_COMMAND = 'sed'
const IN_PLACE_FLAG = '-i'
const LONG_IN_PLACE_FLAG = '--in-place'

// What a span carries so the sequences can be found later.
interface BundleFacts {
	is_bundleable: boolean
	targets: ReadonlyArray<string>
	// Whether the call **certainly** rewrites what it names. **Two writes to one file do not depend on
	// each other** — the text is already held, so both belong in one turn — while a write after a read
	// of the same file genuinely does. `time-bundles.ts` reads this to tell the two apart
	// (joshuafolkken/kit#1509).
	is_writing: boolean
	// Whether the call **might** write, which is a different question and needs the opposite bias.
	//
	// **The two were one field and that was a defect.** Refusing a write leaves a turn half applied, so
	// the refusal test must over-call a line a write: a read wrongly excluded costs one un-refused
	// call. The dependency test needs the opposite — a read wrongly called a write would have its
	// dependency *removed*, so `sed -n '1,200p' x.ts` twice would read as a bundleable pair when the
	// second may well have needed the first. Same bias, opposite consequences, so they are two fields.
	may_write: boolean
}

// A function rather than a shared constant, so no two calls end up holding one `targets` array —
// belt and braces beside the `ReadonlyArray` above, which is what actually stops a writer. The two
// span constants in `time-spans.ts` are module-level and would otherwise share one array between
// every model and human span of a run.
function not_bundleable(): BundleFacts {
	return { is_bundleable: false, targets: [], is_writing: false, may_write: false }
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

// **The conservative half.** A redirection writes whatever follows it, and the three words above
// write their argument. Kept wider than `has_mutation` deliberately, because it feeds the refusal
// test: over-calling a line a write costs one un-refused call, while under-calling it risks refusing
// an edit whose siblings would then land alone. It matches `>` as a character rather than a token, so
// `awk '$1 > 5'` is caught too — a call allowed that could have been refused, which is the safe
// direction here and **only** here.
function may_write_command(command: string): boolean {
	if (command.includes(REDIRECTION)) return true

	return words_of(command).some((word) => WRITING_WORDS.has(word))
}

// **The certain half**, which the dependency test reads and which therefore may not over-call. The
// one shell line that certainly rewrites a file *and* is bundleable is the in-place `sed`: `sed` is on
// the read list because `sed -n` prints, so the flag is what separates the two spellings. Everything
// else answers `false` — a genuine write missed here only leaves a sequence broken the way it already
// was, while a read caught here would have its dependency removed, which is the failure that matters
// (joshuafolkken/kit#1509).
// `-i`, `-i.bak` and `--in-place` are all the same flag: GNU takes the backup suffix glued to the
// short form, and `words_of` splits `--in-place=.bak` at the `=`. Matched by prefix so all three read
// alike — `sed` has no other flag starting `-i`, so the prefix cannot widen this past in-place edits.
function is_in_place_flag(word: string): boolean {
	return word.startsWith(IN_PLACE_FLAG) || word.startsWith(LONG_IN_PLACE_FLAG)
}

function is_in_place_edit(command: string): boolean {
	if (time_shell.leading_word(command) !== IN_PLACE_COMMAND) return false

	return words_of(command).some((word) => is_in_place_flag(word))
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
	// A tool names what it does, so here the two questions have the same answer.
	const writes = { is_writing: WRITING_TOOLS.has(name), may_write: WRITING_TOOLS.has(name) }

	if (!BUNDLEABLE_TOOLS.has(name)) return { ...not_bundleable(), ...writes }

	return { is_bundleable: true, targets: tool_targets(input), ...writes }
}

// The facts for a `Bash` call. The leading command comes from `time-shell.ts` rather than from a
// second reader here — the two answers have to be the same one, or a call could be labelled by one
// command and classified by another.
//
// **The quoted spans come off before the targets are read** (joshuafolkken/kit#1611). `words_of`
// treats a quote as a separator rather than as a boundary, and `/` is not a separator at all — so
// `sed -i '' 's/old/new/' scripts/one.ts` yielded `s/old/new` beside the real path, and
// `investigation-reads.ts` then held a file that no edit could ever name pending for the rest of the
// run. **The write half of the same line already did this**, in `time-writes.ts` → `write_segment`;
// only the read half was left scanning the raw line, and the two halves of one `sed -i` disagreeing
// about what it named is the whole of the over-count.
//
// **It is done here rather than inside `targets_in`, which stays a plain tokenizer.** Both of its
// callers are shell lines and both now strip first, so the invariant its export comment states — one
// extraction, read and written alike — holds at the boundary instead of being hidden inside it.
//
// **`has_mutation` deliberately still reads the raw line.** Unquoting there would let a mutating word
// hide inside a quoted argument and make the call look bundleable, which is the loosening direction;
// this one only ever removes targets.
function bash_facts(command: string): BundleFacts {
	const writes = { is_writing: is_in_place_edit(command), may_write: may_write_command(command) }

	if (!READ_COMMANDS.has(time_shell.leading_word(command)) || has_mutation(command)) {
		return { ...not_bundleable(), ...writes }
	}

	return { is_bundleable: true, targets: targets_in(time_shell.unquoted(command)), ...writes }
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
	// Exported for `time-writes.ts` (joshuafolkken/kit#1472), which asks what a call *wrote* rather
	// than what it named. The extraction is the same one either way — a second copy of it would let a
	// path be recognized as a target when read and missed when written.
	targets_in,
	tool_targets,
	// Exported for the batching guard's own word scan (joshuafolkken/kit#1390), so the two scanners
	// cannot come to disagree about where one word of a shell line ends and the next begins.
	words_of,
}

export type { BundleFacts }
export { time_bundle_call }
