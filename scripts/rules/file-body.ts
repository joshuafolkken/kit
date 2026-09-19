import { existsSync } from 'node:fs'
import { time_shell } from '#scripts/time-runtime/time-shell'
import { bash_triggers } from './bash-triggers'
import { shell_segments } from './shell-segments'

// The trigger and the delivered text behind the `file-body` row of `delivered-rules.ts`
// (joshuafolkken/kit#2120). Group 3 of the three Bash-string gaps: a file's new body carried inline in
// a shell command, the form `CLAUDE.md` → "Never carry a file's new text inside a shell command" and
// `file-edits.md` forbid.
//
// **The detector existed for measurement and refused nothing.** `time-writes.ts` already knew a
// redirection and a heredoc write a file; nothing turned that knowledge into a refusal. This row does,
// and it keeps `file-edits.md`'s allow/deny table exactly: the one branch is whether the redirect target is an
// existing file, and a synchronous `stat` decides it — a new-file creation and a read-only heredoc stay
// silent, an existing-file rewrite is refused.
//
// **Three shapes, one row.** (1) A heredoc whose redirect or `tee` target already exists. (2) an
// interpreter reading a heredoc — or a `node -e` — whose body writes a file: the canonical `python3 -
// <<'PY' … open(f,'w') … PY`, which has no shell redirect to stat, is caught by its body instead. (3)
// an in-place `perl -0pi -e`. A read-only heredoc (`cat <<'EOF'`, a compute-only `python3 -`) writes
// nothing and stays silent — the enumeration's rule that a non-firing turn is a kept turn.
//
// **It fires on every occurrence** (`git-force.ts`): each inline body is paid for again, so
// refused-once-and-free-after would let the second rewrite through.

// A heredoc marker in any of its spellings: `<<EOF`, `<< 'EOF'`, `<<-"EOF"`. Its presence is what
// separates a body-carrying write from an ordinary redirect a run legitimately uses to extract text.
const HEREDOC = /<<-?\s*['"]?\w+/u
// The first physical line carries the command, its redirect and the heredoc marker; the body follows on
// the lines after it. The two are read separately so the redirect target is found on the command line
// and the write indicators are scanned in the body.
const LINE_BREAK = '\n'

function first_line(command: string): string {
	const [line] = command.split(LINE_BREAK)

	return line ?? ''
}

function has_heredoc(command: string): boolean {
	return HEREDOC.test(command)
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

// Shape 1: a heredoc write whose target already exists. The existence check is injected so the suite
// controls it without touching the real filesystem, the same way `lane-park.ts` injects the lane fact.
function writes_existing_file(command: string, has_file: (path: string) => boolean): boolean {
	if (!has_heredoc(command)) return false

	const target = redirect_target(first_line(command))

	return target !== undefined && has_file(target)
}

// The interpreters that carry a body to run rather than a region to read. `cat` / `grep` / `sed -n`
// are deliberately absent — a heredoc fed to them is the read-only form `file-edits.md` allows.
const BODY_INTERPRETERS: ReadonlySet<string> = new Set(['python', 'python3', 'ruby', 'perl', 'php'])
const NODE = 'node'
const NODE_EVAL = /(?:^|\s)(?:-e|--eval)\b/u

// A body that writes a file, in Python and Node spellings — split across two patterns so neither
// exceeds the regex-complexity ceiling. The named write calls: `writeFile` covers `writeFileSync`,
// `appendFile` covers its sync form, and `.write(` covers `.writelines(`.
const WRITE_CALL = /writeFile|appendFile|createWriteStream|\.write(?:lines)?\s*\(/u
// The mode-string and relocation forms: an `open(…, "w"|"a"|"x")`, `os.replace`, `shutil.copy` / `move`.
// A mode string of `r` alone (a read) matches none of these, so a compute- or read-only heredoc stays
// silent.
const WRITE_MODE = /open\s*\([^)]*['"][rbt+]*[wax]|os\.replace|shutil\.(?:copy|move)/u

function body_writes(command: string): boolean {
	return WRITE_CALL.test(command) || WRITE_MODE.test(command)
}

// Shape 2: an interpreter reading a heredoc, or a `node -e`, whose body writes.
function is_interpreter_write(segment: string, command: string): boolean {
	const leading = time_shell.leading_word(segment)

	if (BODY_INTERPRETERS.has(leading)) return has_heredoc(command) && body_writes(command)

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

// The interpreter and perl shapes are read per first-line segment, so a heredoc marker on the same line
// is judged against the command that opened it rather than against a later one in a chain.
function has_body_interpreter(command: string): boolean {
	return shell_segments
		.segments_of(first_line(command))
		.some((segment) => is_interpreter_write(segment, command) || is_in_place_perl(segment))
}

function carries_a_file_body(
	command: string,
	has_file: (path: string) => boolean = existsSync,
): boolean {
	return writes_existing_file(command, has_file) || has_body_interpreter(command)
}

// The instruction in the shape a refusal can carry: what the command is doing, the safe tool, and the
// file forms that stay allowed. The measured cost is named because it is the half that reads as
// surprising — the command body is billed on every later request of the run.
const FILE_BODY_REASON =
	"⛔ file body in a shell command: this carries a file's new text inline — a heredoc rewriting an " +
	'existing file, an interpreter (`python3 - <<`, `node -e`) whose body writes, or an in-place `perl ' +
	'-0pi -e`. `CLAUDE.md` forbids it because the command body is re-read on every later request of the ' +
	'run, so an editing script written early is billed for the rest of it (`file-edits.md` measured one ' +
	'run at ~2m45s spent retyping existing lines). Edit a region with the Edit tool (old / new), or pass ' +
	'a body by path (`--field body=@<path>`, `--body-file <path>`). A new-file creation (`cat > ' +
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
	is_in_place_perl,
	is_interpreter_write,
	writes_existing_file,
}

export { file_body }
