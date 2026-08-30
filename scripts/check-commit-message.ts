#!/usr/bin/env tsx
import { readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { git_command } from './git/git-command'

interface CheckResult {
	success: boolean
	message: string
}

const PARENT_SEGMENT = '..'
const COMMIT_MESSAGE_FILE_NAME = 'COMMIT_EDITMSG'
// Only for a checkout git could not answer for; every real invocation has git's own answer.
const FALLBACK_GIT_DIRECTORY = '.git'

// Containment, decided after resolving — not a prefix of the spelling handed in. `path.relative`
// answers how to walk from the directory to the file, so a path that climbs back out of it starts
// with `..`, and one that never entered it comes back absolute. A string prefix would accept
// `<dir>/../../etc/passwd`, which is the whole file this guard refuses to read.
function is_inside(directory: string, resolved_path: string): boolean {
	const relative = path.relative(directory, resolved_path)

	return relative !== '' && !relative.startsWith(PARENT_SEGMENT) && !path.isAbsolute(relative)
}

// joshuafolkken/kit#1106: the guard used to be a prefix test — the path had to *start* with `.git/`,
// which is only the shape the main work tree produces. A linked work tree gets an absolute
// `<repo>/.git/worktrees/<name>/COMMIT_EDITMSG`, which shares no prefix with it, so the guard threw
// before the real check ran and no commit inside a work tree could succeed.
//
// The directories are asked of git rather than assumed to be named `.git`, because the name is not a
// property of a repository: a bare repository's git directory is the repository, and
// `--separate-git-dir` puts it anywhere at all. Matching a `.git` segment instead would refuse both,
// reproducing this defect one case over — and it would accept any path that merely passes through
// some `.git` directory, which is wider than what the guard is for.
function is_safe_commit_message_path(
	file_path: string,
	git_directories: ReadonlyArray<string>,
): boolean {
	const resolved = path.resolve(file_path)

	return (
		git_directories.some((directory) => is_inside(directory, resolved)) ||
		is_inside(os.tmpdir(), resolved)
	)
}

// Where git would have written the message, for a run that was passed no path. The work tree's own
// git directory rather than a literal `.git/`: in a linked work tree that name is a *file*, so the
// relative spelling this used to hardcode ends the run at ENOTDIR — the same defect as the guard's,
// on the branch the guard does not reach (joshuafolkken/kit#1106).
function default_commit_message_path(git_directories: ReadonlyArray<string>): string {
	return path.join(git_directories[0] ?? FALLBACK_GIT_DIRECTORY, COMMIT_MESSAGE_FILE_NAME)
}

async function get_commit_message(): Promise<string> {
	const FILE_INDEX = 2
	const commit_message_file = process.argv.at(FILE_INDEX)
	const git_directories = await git_command.git_directories()
	const message_path = commit_message_file ?? default_commit_message_path(git_directories)

	if (
		commit_message_file !== undefined &&
		!is_safe_commit_message_path(commit_message_file, git_directories)
	) {
		throw new Error(
			`Commit message file must be inside a git directory or the system temp dir: ${commit_message_file}`,
		)
	}

	try {
		return readFileSync(message_path, 'utf8').trim()
	} catch (error) {
		throw new Error(`Failed to read commit message file: ${message_path}`, { cause: error })
	}
}

function extract_issue_number(branch_name: string): string | undefined {
	const branch_pattern = /^(\d+)-[\da-z-]+$/u
	const match = branch_pattern.exec(branch_name)

	return match?.[1]
}

function create_error_message(issue_number: string, branch: string, message: string): string {
	return (
		`🚫 Error: Commit message must include #${issue_number}\n` +
		`   Current branch: ${branch}\n` +
		`   Commit message: ${message}\n` +
		`   Please include #${issue_number} in your commit message\n`
	)
}

async function check_commit_message(): Promise<CheckResult> {
	const current_branch = await git_command.branch()
	const issue_number = extract_issue_number(current_branch)

	if (issue_number === undefined) {
		return {
			success: true,
			message: `✅ Branch format check passed: '${current_branch}' (no issue number required)`,
		}
	}

	const commit_message = await get_commit_message()

	if (!commit_message.includes(`#${issue_number}`)) {
		return {
			success: false,
			message: create_error_message(issue_number, current_branch, commit_message),
		}
	}

	return {
		success: true,
		message: `✅ Commit message check passed: Found #${issue_number}`,
	}
}

async function main(): Promise<void> {
	const result = await check_commit_message()

	console.info(result.message)

	if (!result.success) process.exit(1)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main()

export { check_commit_message, extract_issue_number, is_safe_commit_message_path }

export type { CheckResult }
