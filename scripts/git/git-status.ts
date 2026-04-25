import { animation_helpers, type AnimationOptions } from './animation-helpers'
import { REQUIRED_STATUS_LENGTH, STAGED_STATUS_INDEX, UNTRACKED_FILE_PREFIX } from './constants'
import { git_command } from './git-command'

const WARNING_ICON = '🔔'
const PACKAGE_JSON_FILE = 'package.json'
const STATUS_PREFIX_LENGTH = 2
const VERSION_NOT_UPDATED = 'Not updated'

function is_untracked_file(line: string): boolean {
	return line.startsWith(UNTRACKED_FILE_PREFIX)
}

function is_unstaged_file(line: string): boolean {
	return line.length >= REQUIRED_STATUS_LENGTH && line[STAGED_STATUS_INDEX] !== ' '
}

function parse_status_lines(status_output: string): Array<string> {
	return status_output
		.split(/\r?\n/u)
		.map((line) => line.trimEnd())
		.filter((line) => line.length > 0)
}

function has_unstaged_files(status_output: string): boolean {
	const lines = parse_status_lines(status_output)
	const has_untracked = lines.some((line) => is_untracked_file(line))
	const has_unstaged = lines.some((line) => is_unstaged_file(line))

	return has_untracked || has_unstaged
}

function is_staged_file(line: string): boolean {
	if (line.length < REQUIRED_STATUS_LENGTH) {
		return false
	}

	if (is_untracked_file(line)) {
		return false
	}

	const [staged_status] = line

	return staged_status !== ' '
}

function has_unstaged_changes(line: string): boolean {
	return line.length >= REQUIRED_STATUS_LENGTH && line[STAGED_STATUS_INDEX] !== ' '
}

function has_all_files_staged(status_output: string): boolean {
	const lines = parse_status_lines(status_output)

	if (lines.length === 0) {
		return true
	}

	return lines.every((line) => !has_unstaged_changes(line))
}

function extract_filename(line: string): string {
	return line.slice(STATUS_PREFIX_LENGTH).trim()
}

function is_package_json_staged(status_output: string): boolean {
	const lines = parse_status_lines(status_output)

	return lines.some((line) => {
		if (!is_staged_file(line)) {
			return false
		}

		const filename = extract_filename(line)

		return filename === PACKAGE_JSON_FILE
	})
}

function create_status_check_config(
	has_warning: (result: boolean) => boolean,
	error_message: string,
	result_formatter: (result: boolean) => string,
): AnimationOptions<boolean> {
	return {
		icon_selector: (result) => (has_warning(result) ? WARNING_ICON : undefined),
		error_message,
		result_formatter,
	}
}

function is_version_updated_in_diff(diff_output: string): boolean {
	const version_pattern = /^[+-].*"version"\s*:/u

	return diff_output.split(/\r?\n/u).some((line) => version_pattern.test(line))
}

async function check_unstaged(): Promise<boolean> {
	const config = create_status_check_config(
		(has_unstaged) => has_unstaged,
		'Failed to check unstaged files',
		(has_unstaged) => (has_unstaged ? 'Found' : 'None'),
	)

	return await animation_helpers.execute_with_animation(
		'Checking unstaged files...',
		async () => {
			const status_output = await git_command.status()

			return has_unstaged_files(status_output)
		},
		config,
	)
}

async function check_all_staged(): Promise<boolean> {
	const config = create_status_check_config(
		(all_staged) => !all_staged,
		'Failed to check staged files',
		(all_staged) => (all_staged ? 'All staged' : 'Not all staged'),
	)

	return await animation_helpers.execute_with_animation(
		'Checking if all files are staged...',
		async () => {
			const status_output = await git_command.status()

			return has_all_files_staged(status_output)
		},
		config,
	)
}

async function check_package_json_staged(): Promise<boolean> {
	const config = create_status_check_config(
		(is_staged) => !is_staged,
		'Failed to check package.json staging status',
		(is_staged) => (is_staged ? 'Staged' : 'Not staged'),
	)

	return await animation_helpers.execute_with_animation(
		'Checking if package.json is staged...',
		async () => {
			const status_output = await git_command.status()

			return is_package_json_staged(status_output)
		},
		config,
	)
}

async function check_package_json_version(): Promise<boolean> {
	const config = create_status_check_config(
		(is_updated) => !is_updated,
		'Failed to check package.json version update',
		(is_updated) => (is_updated ? 'Updated' : VERSION_NOT_UPDATED),
	)

	return await animation_helpers.execute_with_animation(
		'Checking if package.json version is updated...',
		async () => {
			const diff_output: string = await git_command.diff_cached(PACKAGE_JSON_FILE)

			return is_version_updated_in_diff(diff_output)
		},
		config,
	)
}

async function check_branch_version(): Promise<boolean> {
	const config = create_status_check_config(
		(is_updated) => !is_updated,
		'Failed to check branch version update',
		(is_updated) => (is_updated ? 'Already updated' : VERSION_NOT_UPDATED),
	)

	return await animation_helpers.execute_with_animation(
		'Checking if version is already updated on this branch...',
		async () => {
			const diff_output: string = await git_command.diff_main(PACKAGE_JSON_FILE)

			return is_version_updated_in_diff(diff_output)
		},
		config,
	)
}

function list_untracked_files(status_output: string): Array<string> {
	return parse_status_lines(status_output)
		.filter((line) => is_untracked_file(line))
		.map((line) => extract_filename(line))
}

const git_status = {
	check_unstaged,
	check_all_staged,
	check_package_json_staged,
	check_package_json_version,
	check_branch_version,
	list_untracked_files,
}

export { git_status }
