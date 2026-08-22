import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { read_spawn_stderr, read_spawn_stdout } from '#scripts/spawn-exit'
import { execaSync } from 'execa'
import { doctor_logic } from './doctor-logic'

const JOSH_BIN = 'josh'
const GIT_TIMEOUT_MS = 2000
const NOT_A_REPOSITORY_MESSAGE = 'not a git repository'
const NPM_VERSION_UPDATES_DISABLED = 'open-pull-requests-limit: 0'
const DEPENDABOT_CONFIG_PATH = '.github/dependabot.yml'
const ECOSYSTEM_KEY = 'package-ecosystem:'
const NPM_ECOSYSTEM = 'npm'
const AUTO_MERGE_WORKFLOW_PATH = '.github/workflows/dependabot-auto-merge.yml'
// The command that needs the repository's "Allow auto-merge" setting, and the only thing in the
// workflow that does. Matching it rather than the filename is what keeps the report tied to the
// prerequisite: a file of that name which never calls `--auto` creates no prerequisite, and a
// consumer's own auto-merge workflow which does creates the same one kit's does
// (joshuafolkken/kit#834).
const AUTO_MERGE_COMMAND = 'gh pr merge --auto'
const YAML_COMMENT_PREFIX = '#'

// Resolve the `josh` that the shell would run — the first match on PATH, via the platform's
// lookup command (`where` on Windows, `which` elsewhere). Undefined when the lookup fails or
// prints nothing (no `josh` on PATH, e.g. inside the kit repo where only `pnpm josh` runs).
function resolve_path_josh(): string | undefined {
	const lookup = doctor_logic.path_lookup_command(process.platform)
	const result = execaSync(lookup, [JOSH_BIN], { reject: false })

	return doctor_logic.first_path_line(read_spawn_stdout(result))
}

// Resolve the pnpm-global `josh` bin path. Undefined when pnpm is missing or the global bin does
// not contain a `josh` (kit not installed globally). `pnpm bin -g` prepends a `[WARN]` line to
// stdout inside a project, so the bin directory is extracted via first_path_line.
function resolve_pnpm_global_josh(): string | undefined {
	const result = execaSync('pnpm', ['bin', '-g'], { reject: false })
	const bin_directory = doctor_logic.first_path_line(read_spawn_stdout(result))
	if (bin_directory === undefined) return undefined
	const candidate = path.join(bin_directory, JOSH_BIN)

	return existsSync(candidate) ? candidate : undefined
}

// Whether the working directory is provably *outside* a git work tree. Purely local — no network,
// and it does not depend on `gh` being installed or authenticated, which is what makes it usable to
// decide whether a repository-scoped check applies at all (joshuafolkken/kit#805).
//
// An empty root from a successful run is not an answer, so it is undetermined rather than inside.
function classify_top_level(top_level: string): GitTopLevel {
	return top_level === '' ? { state: 'undetermined' } : { state: 'inside', top_level }
}

// Only `fatal: not a git repository` proves absence. Exit 128 alone does not: git returns it inside
// a repository for dubious ownership (`safe.directory`), a corrupt `.git`, or a broken config. An
// undefined exit code is a spawn failure or a timeout — git never answered at all.
function classify_git_failure(exit_code: number | undefined, stderr: string): GitTopLevel {
	if (exit_code === undefined) return { state: 'undetermined' }

	return stderr.includes(NOT_A_REPOSITORY_MESSAGE)
		? { state: 'outside' }
		: { state: 'undetermined' }
}

// The repository root, or a reason there is none. `--show-toplevel` is used rather than
// `--is-inside-work-tree` because the caller needs the root itself: the config file that decides
// applicability lives at a fixed path relative to it, and resolving that path against the working
// directory instead would skip the check in every subdirectory of a consumer repository.
//
// `outside` and `undetermined` are kept apart deliberately: only proof of absence may skip the
// caller's check, because reporting an unknown as a clean result is the false all-clear
// joshuafolkken/kit#805 exists to remove. See the two classifiers above for what proves what.
function resolve_git_top_level(): GitTopLevel {
	const result = execaSync('git', ['rev-parse', '--show-toplevel'], {
		reject: false,
		timeout: GIT_TIMEOUT_MS,
		// git translates its messages, so the match below would fail under any non-English locale and
		// the spurious warning would come back. `C` pins the output this code was written against.
		env: { LC_ALL: 'C', LANGUAGE: 'C' },
		extendEnv: true,
	})

	if (result.exitCode === 0) return classify_top_level(read_spawn_stdout(result).trim())

	return classify_git_failure(result.exitCode, read_spawn_stderr(result))
}

// Whether one line is the setting itself rather than prose about it. kit's own template explains the
// option in a comment containing the same literal, so a substring search over the file would match
// that comment — and any file that quotes it. The line must be indented (it sits under an `updates:`
// entry) and must be exactly the mapping, which a `#` comment never is. Scanned line by line rather
// than matched with an anchored regex, which backtracks super-linearly on this shape.
function is_version_updates_disabled_line(line: string): boolean {
	if (!line.startsWith(' ') && !line.startsWith('\t')) return false

	return line.trim() === NPM_VERSION_UPDATES_DISABLED
}

// A Dependabot `updates:` entry begins with the ecosystem key; the limit must belong to the npm one.
function is_entry_start(line: string): boolean {
	return line.trimStart().startsWith(`- ${ECOSYSTEM_KEY}`)
}

function is_npm_entry_start(line: string): boolean {
	return is_entry_start(line) && line.includes(NPM_ECOSYSTEM)
}

// The lines belonging to the npm `updates:` entry, in order. An entry runs until the next one starts.
function npm_entry_lines(lines: ReadonlyArray<string>): Array<string> {
	const start = lines.findIndex((line) => is_npm_entry_start(line))
	if (start === -1) return []
	const rest = lines.slice(start + 1)
	const end = rest.findIndex((line) => is_entry_start(line))

	return end === -1 ? rest : rest.slice(0, end)
}

// Whether the npm entry disables version updates. Scoped to that entry rather than matched across
// the whole file: a project that sets the same limit on, say, its `docker` entry has not received
// kit's change and must not be warned about it.
function has_npm_version_updates_disabled(content: string): boolean {
	return npm_entry_lines(content.split('\n')).some((line) => is_version_updates_disabled_line(line))
}

// The nearest ancestor of `start` holding `relative_path`, or nothing. Searching upward rather than
// testing `start` alone is what keeps the check alive in a subdirectory when git could not report
// the repository root — a `safe.directory` refusal, for instance, which `classify_git_failure`
// deliberately routes to `undetermined` precisely so the check survives.
//
// `boundary` stops the walk at the repository root when one is known. Without it a repository nested
// under a kit consumer would inherit the parent's files and be warned about a prerequisite that
// belongs to a different project.
function find_project_file(
	start: string,
	relative_path: string,
	boundary: string | undefined,
): string | undefined {
	const candidate = path.join(start, relative_path)
	if (existsSync(candidate)) return candidate
	if (start === boundary) return undefined
	const parent = path.dirname(start)

	return parent === start ? undefined : find_project_file(parent, relative_path, boundary)
}

// Whether a distributed artifact is present *and* carries the marker that creates the prerequisite.
// Existence alone is never enough: any project may ship a file of the same name, and warning there
// would advertise an enabling command for a repository that never consumed kit.
//
// The read is guarded even though existence was just checked: a permission error, a directory in the
// file's place, or a race between the two calls would otherwise throw out of `josh doctor` and abort
// a command whose whole contract is that this check never fails it. An unreadable file cannot prove
// the prerequisite applies, so it reads as absent.
function has_marked_project_file(
	start: string,
	relative_path: string,
	boundary: string | undefined,
	is_marked: (content: string) => boolean,
): boolean {
	const file_path = find_project_file(start, relative_path, boundary)
	if (file_path === undefined) return false

	try {
		return is_marked(readFileSync(file_path, 'utf8'))
	} catch {
		return false
	}
}

// Whether the project has received kit's `.github/dependabot.yml`. The npm entry's
// `open-pull-requests-limit: 0` is what creates the prerequisite (joshuafolkken/kit#803), so that is
// what is matched.
function has_distributed_dependabot_config(start: string, boundary?: string): boolean {
	return has_marked_project_file(start, DEPENDABOT_CONFIG_PATH, boundary, (content) =>
		has_npm_version_updates_disabled(content),
	)
}

// Whether one line runs the command rather than merely mentioning it. kit's own template explains
// the prerequisite in a comment containing the same literal, so a substring search over the file
// would match that comment — and any file that quotes it. The same distinction the npm
// version-updates check draws above, for the same reason.
function is_auto_merge_command_line(line: string): boolean {
	const trimmed = line.trimStart()

	return !trimmed.startsWith(YAML_COMMENT_PREFIX) && trimmed.includes(AUTO_MERGE_COMMAND)
}

// Whether the project runs a Dependabot auto-merge workflow. `gh pr merge --auto` is what needs the
// repository's "Allow auto-merge" setting, so that is what is matched (joshuafolkken/kit#834).
function has_auto_merge_workflow(start: string, boundary?: string): boolean {
	return has_marked_project_file(start, AUTO_MERGE_WORKFLOW_PATH, boundary, (content) =>
		content.split('\n').some((line) => is_auto_merge_command_line(line)),
	)
}

// Where a repository-scoped check stands: inside a repository (with its root), provably outside
// one, or unable to tell.
type GitTopLevel =
	{ state: 'inside'; top_level: string } | { state: 'outside' } | { state: 'undetermined' }

const doctor_io = {
	GIT_TIMEOUT_MS,
	resolve_path_josh,
	resolve_pnpm_global_josh,
	has_distributed_dependabot_config,
	has_auto_merge_workflow,
	resolve_git_top_level,
}

export type { GitTopLevel }
export { doctor_io }
