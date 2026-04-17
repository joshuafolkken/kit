import { platform } from 'node:os'

const REQUIRED_STATUS_LENGTH = 2
const STAGED_STATUS_INDEX = 1
const UNTRACKED_FILE_PREFIX = '??'
const SEPARATOR_LINE = '────────────────────────────────────────'
const GIT_COMMAND_UNIX = '/usr/bin/git'

function get_git_command(): string {
	if (platform() === 'win32') {
		return String.raw`"C:\Program Files\Git\cmd\git.exe"`
	}

	return GIT_COMMAND_UNIX
}

function get_git_command_for_spawn(): string {
	if (platform() === 'win32') {
		return String.raw`C:\Program Files\Git\cmd\git.exe`
	}

	return GIT_COMMAND_UNIX
}

const git_utilities = {
	get_git_command,
	get_git_command_for_spawn,
}

export {
	REQUIRED_STATUS_LENGTH,
	STAGED_STATUS_INDEX,
	UNTRACKED_FILE_PREFIX,
	SEPARATOR_LINE,
	git_utilities,
}
