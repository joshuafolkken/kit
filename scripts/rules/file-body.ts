import { existsSync } from 'node:fs'
import { time_shell } from '#scripts/time-runtime/time-shell'
import { bash_triggers } from './bash-triggers'
import { shell_segments } from './shell-segments'

// The trigger and the delivered text behind the `file-body` row of `delivered-rules.ts`.
// Group 3 of the three Bash-string gaps: a file's new body carried inline in
// a shell command, the form `prompts/collaboration-workflow/file-edits.md` forbids.
//
// **The detector existed for measurement and refused nothing.** `time-writes.ts` already knew a
// redirection and a heredoc write a file; nothing turned that knowledge into a refusal. This row does,
// and it keeps `file-edits.md`'s allow/deny table exactly: the one branch is whether the redirect target is an
// existing file, and a synchronous `stat` decides it — a new-file creation and a read-only heredoc stay
// silent, an existing-file rewrite is refused.
//
// **Four shapes, one row.** (1) A heredoc whose redirect or `tee` target already exists. (2) an
// interpreter reading a heredoc — or a `node -e` — whose body writes a file: the canonical `python3 -
// <<'PY' … open(f,'w') … PY`, which has no shell redirect to stat, is caught by its body instead. (3)
// an in-place `perl -0pi -e`. (4) a heredoc creating an interpreter script whose body writes. Each is
// read on every command line, not only the first. A read-only heredoc (`cat <<'EOF'`, a compute-only
// `python3 -`) writes nothing and stays silent — the enumeration's rule that a non-firing turn is a
// kept turn.
//
// **It fires on every occurrence** (`git-force.ts`): each inline body is paid for again, so
// refused-once-and-free-after would let the second rewrite through.

// A heredoc marker in any of its spellings: `<<EOF`, `<< 'EOF'`, `<<-"EOF"`, with its delimiter captured.
// Its presence is what separates a body-carrying write from an ordinary redirect a run legitimately uses
// to extract text. A here-string (`<<<`) and an arithmetic shift (`$((1<<2))`) carry no body, so a third
// `<` on either side and a digit delimiter are excluded.
const HEREDOC = /(?<!<)<<(?!<)-?\s*['"]?([A-Z_a-z]\w*)/u
const LINE_BREAK = '\n'

function has_heredoc(command: string): boolean {
	return HEREDOC.test(command)
}

// The lines the shell reads as commands — every physical line outside a heredoc body — each paired with
// the heredoc body it opened. A command, its redirect and its heredoc marker share one of these; the body
// follows up to the delimiter line. Reading only the first physical line missed the interpreter a run
// opened after a `cd <lane>` line, so every command line is read, a body line is
// never mistaken for one, and a write is judged only in the body its own command opened.
interface CommandLine {
	text: string
	body: string
}

interface LineScan {
	lines: ReadonlyArray<CommandLine>
	delimiter: string | undefined
}

function with_body_line(lines: ReadonlyArray<CommandLine>, line: string): Array<CommandLine> {
	const opener = lines.at(-1)

	if (opener === undefined) return [...lines]

	return [...lines.slice(0, -1), { ...opener, body: `${opener.body}${line}${LINE_BREAK}` }]
}

function scan_line(scan: LineScan, line: string): LineScan {
	if (scan.delimiter === undefined) {
		return { lines: [...scan.lines, { text: line, body: '' }], delimiter: HEREDOC.exec(line)?.[1] }
	}

	if (line.trim() === scan.delimiter) return { ...scan, delimiter: undefined }

	return { ...scan, lines: with_body_line(scan.lines, line) }
}

function command_lines(command: string): ReadonlyArray<CommandLine> {
	let scan: LineScan = { lines: [], delimiter: undefined }

	for (const line of command.split(LINE_BREAK)) scan = scan_line(scan, line)

	return scan.lines
}

// A file redirect (`> path`, `>> path`) or a `tee path`, with the target captured. A descriptor
// redirect (`2>&1`) and an append-to-fd are excluded — the `&` after `>` marks them.
const FILE_REDIRECT = /(?:^|\s)>>?\s*(?!&)("[^"]+"|'[^']+'|\S+)/u
const TEE_TARGET = /\btee\s+(?:-a\s+)?(?!-)("[^"]+"|'[^']+'|\S+)/u
const QUOTES = /^['"]|['"]$/gu

function redirect_target(line: string): string | undefined {
	const target = FILE_REDIRECT.exec(line)?.[1] ?? TEE_TARGET.exec(line)?.[1]

	return target === undefined ? undefined : target.replaceAll(QUOTES, '')
}

// The interpreters that carry a body to run rather than a region to read. `cat` / `grep` / `sed -n`
// are deliberately absent — a heredoc fed to them is the read-only form `file-edits.md` allows.
const BODY_INTERPRETERS: ReadonlySet<string> = new Set([
	'python',
	'python3',
	'ruby',
	'perl',
	'php',
	'node',
])
const NODE = 'node'
const NODE_EVAL = /(?:^|\s)(?:-e|--eval)\b/u

// A body that writes a file, in Python and Node spellings — split across two patterns so neither
// exceeds the regex-complexity ceiling. The named write calls: `writeFile` covers `writeFileSync`,
// `appendFile` covers its sync form, and `.write(` covers `.writelines(` and Python's path-object
// `.write_text(` / `.write_bytes(`.
const WRITE_CALL = /writeFile|appendFile|createWriteStream|\.write(?:lines|_text|_bytes)?\s*\(/u
// The mode-string and relocation forms: an `open(…, "w"|"a"|"x")`, `os.replace`, `shutil.copy` / `move`.
// A mode string of `r` alone (a read) matches none of these, so a compute- or read-only heredoc stays
// silent.
const WRITE_MODE = /open\s*\([^)]*['"][rbt+]*[wax]|os\.replace|shutil\.(?:copy|move)/u

function body_writes(body: string): boolean {
	return WRITE_CALL.test(body) || WRITE_MODE.test(body)
}

// A script file for one of the body interpreters. Creating one is a new-file creation, but a script
// whose body writes is the interpreter rewrite moved one call later — `cat > edit.py <<EOF` then
// `python3 edit.py` carries the same replacement text.
const SCRIPT_FILE = /\.(?:py|rb|pl|php|js|mjs|cjs)$/u

// Shapes 1 and 4: a heredoc write whose target already exists, or whose target is a script that writes.
// The existence check is injected so the suite controls it without touching the real filesystem, the
// same way `lane-park.ts` injects the lane fact.
function is_heredoc_write(line: CommandLine, has_file: (path: string) => boolean): boolean {
	const target = has_heredoc(line.text) ? redirect_target(line.text) : undefined

	if (target === undefined) return false
	if (has_file(target)) return true

	return SCRIPT_FILE.test(target) && body_writes(line.body)
}

// Shape 2: an interpreter reading a heredoc, or a `node -e`, whose body writes.
function is_interpreter_write(segment: string, body: string): boolean {
	const leading = time_shell.leading_word(segment)

	if (!BODY_INTERPRETERS.has(leading)) return false
	if (has_heredoc(segment)) return body_writes(body)

	return leading === NODE && NODE_EVAL.test(segment) && body_writes(segment)
}

// Shape 3: an in-place `perl` edit — `-i`, `-pi`, `-0pi`. A lowercase `i` in the flag cluster is the
// in-place switch; the capital `-I` (an include path) is not, so the pattern keys on the lowercase.
const PERL = 'perl'
const PERL_IN_PLACE = /^-[A-Za-z0-9]*i/u
const WHITESPACE = /\s+/u

function is_in_place_perl(segment: string): boolean {
	if (time_shell.leading_word(segment) !== PERL) return false

	return segment.split(WHITESPACE).some((word) => PERL_IN_PLACE.test(word))
}

// The interpreter and perl shapes are read per command-line segment, so a heredoc marker is judged
// against the command that opened it rather than against a later one in a chain.
function has_body_interpreter(line: CommandLine): boolean {
	return shell_segments
		.segments_of(line.text)
		.some((segment) => is_interpreter_write(segment, line.body) || is_in_place_perl(segment))
}

function carries_a_file_body(
	command: string,
	has_file: (path: string) => boolean = existsSync,
): boolean {
	return command_lines(command).some(
		(line) => is_heredoc_write(line, has_file) || has_body_interpreter(line),
	)
}

// The instruction in the shape a refusal can carry: what the command is doing, the safe tool, and the
// file forms that stay allowed. The measured cost is named because it is the half that reads as
// surprising — the command body is billed on every later request of the run.
const FILE_BODY_REASON =
	"⛔ file body in a shell command: this carries a file's new text inline — a heredoc rewriting an " +
	'existing file, an interpreter (`python3 - <<`, `node -e`) whose body writes, a script file (`cat > ' +
	'edit.py <<EOF`) whose body writes, or an in-place `perl -0pi -e`. `CLAUDE.md` forbids it because ' +
	'the command body is re-read on every later request of the run, so an editing script written early ' +
	'is billed for the rest of it (`file-edits.md` measured one run at ~2m45s spent retyping existing ' +
	'lines). Edit a region with the Edit tool (old / new); a change scattered so widely that the ' +
	'partial edits would carry more than the file is rewritten whole with the Write tool, never a ' +
	'heredoc. Pass a body by path (`--field body=@<path>`, `--body-file <path>`). A new-file creation (`cat > ' +
	'<new-file> <<EOF`), a read-only heredoc (`cat <<EOF`), and a short `sed -i` stay allowed. **This ' +
	'rule fires on every occurrence, not once per run.**'

const ROW = {
	id: 'file-body',
	is_trigger: bash_triggers.on_bash_command((command: string) => carries_a_file_body(command)),
	reason: FILE_BODY_REASON,
	decide: (): boolean => true,
}

const file_body = {
	FILE_BODY_REASON,
	ROW,
	carries_a_file_body,
}

export { file_body }
