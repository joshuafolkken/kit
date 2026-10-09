import { platform } from 'node:os'

const REQUIRED_STATUS_LENGTH = 2
const STAGED_STATUS_INDEX = 1
const UNTRACKED_FILE_PREFIX = '??'
const SEPARATOR_LINE = '────────────────────────────────────────'
const GIT_COMMAND_UNIX = '/usr/bin/git'
// git's machine-readable output, asked for by the readers that parse rather than display. It lives
// here rather than beside either of them because `status` and `worktree_list` now sit in different
// modules and a copy in each is a second answer to one question.
const PORCELAIN_FLAG = '--porcelain'
// The untracked-files mode every porcelain status reading passes (`git-command.ts` carries why it is
// passed and why it is `all`), shared so another module's own reading cannot drift from it.
const UNTRACKED_FILES_FLAG = '--untracked-files=all'
// The git binary a spawn runs in place of the platform's own. The spawn path
// is absolute, so a `git` placed in front on `PATH` never stands in for it: the unit suite's network
// guard shimmed `git` that way, and `josh ship`'s tests fetched and merged the default branch into the
// checkout they ran in without the guard ever seeing the call. The guard names its shim here instead.
const GIT_BINARY_KEY = 'JOSH_GIT_BINARY'

function get_git_command(): string {
	if (platform() === 'win32') return String.raw`"C:\Program Files\Git\cmd\git.exe"`

	return GIT_COMMAND_UNIX
}

function get_git_command_for_spawn(): string {
	const binary = process.env[GIT_BINARY_KEY]

	if (binary !== undefined && binary !== '') return binary

	if (platform() === 'win32') return String.raw`C:\Program Files\Git\cmd\git.exe`

	return GIT_COMMAND_UNIX
}

const git_utilities = {
	get_git_command,
	get_git_command_for_spawn,
}

export {
	GIT_BINARY_KEY,
	REQUIRED_STATUS_LENGTH,
	STAGED_STATUS_INDEX,
	UNTRACKED_FILE_PREFIX,
	SEPARATOR_LINE,
	PORCELAIN_FLAG,
	UNTRACKED_FILES_FLAG,
	git_utilities,
}
