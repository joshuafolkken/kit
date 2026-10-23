import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { file_content } from '#scripts/sync/file-content'
import {
	DEFAULT_RELEASE_AGE_MINUTES,
	release_window,
	type ReleaseWindow,
} from '#scripts/version/release-window'

// Dependabot's `cooldown` is the workspace's `minimumReleaseAge` restated in days, so a freshly
// published action or package waits out the same window pnpm and Safe Chain enforce (kit #4023).
// The edit is line-based and touches only each entry's `cooldown` block: a consumer's own keys and
// the file's comments survive, which a YAML round trip would discard.
const DEPENDABOT_FILE = path.join('.github', 'dependabot.yml')
const MINUTES_PER_DAY = 1440
// Dependabot accepts `default-days` from 1 to 90.
const MIN_DAYS = 1
const MAX_DAYS = 90
// pnpm's exclusions name npm packages, so only the npm entry receives them.
const NPM_ECOSYSTEM = 'npm'
const UPDATES_PATTERN = /^updates:\s*(?:#.*)?$/u
const ECOSYSTEM_PATTERN = /^\s*(?:-\s+)?package-ecosystem:\s*['"]?([\w-]+)/u
const TOP_LEVEL_KEY_PATTERN = /^[^\s#-]/u
const COOLDOWN_KEY = 'cooldown:'

interface UpdateEntry {
	start: number
	end: number
	key_indent: string
}

function cooldown_days(minutes: number | undefined): number {
	const days = Math.ceil((minutes ?? DEFAULT_RELEASE_AGE_MINUTES) / MINUTES_PER_DAY)

	return Math.min(MAX_DAYS, Math.max(MIN_DAYS, days))
}

function quote(value: string): string {
	return `'${value.replaceAll("'", "''")}'`
}

function cooldown_lines(ecosystem: string, window: ReleaseWindow, indent: string): Array<string> {
	const lines = ['cooldown:', `  default-days: ${String(cooldown_days(window.minutes))}`]

	if (ecosystem === NPM_ECOSYSTEM && window.exclusions.length > 0) {
		lines.push('  exclude:', ...window.exclusions.map((name) => `    - ${quote(name)}`))
	}

	return lines.map((line) => `${indent}${line}`)
}

function indent_width(line: string): number {
	return line.length - line.trimStart().length
}

function is_blank(line: string | undefined): boolean {
	return line?.trim() === ''
}

function trim_trailing_blanks(lines: ReadonlyArray<string>): Array<string> {
	const trimmed = [...lines]
	while (trimmed.length > 1 && is_blank(trimmed.at(-1))) trimmed.pop()

	return trimmed
}

function is_comment(line: string | undefined): boolean {
	return line?.trimStart().startsWith('#') === true
}

// A blank line, or a comment left of `width`: it may sit inside a block or head the next one.
function is_detached(line: string | undefined, width: number): boolean {
	return is_blank(line) || (is_comment(line) && indent_width(line ?? '') < width)
}

// The first key line at or after `from` that sits left of `width`, or `limit`.
function block_stop(
	lines: ReadonlyArray<string>,
	from: number,
	width: number,
	limit: number,
): number {
	const relative = lines
		.slice(from, limit)
		.findIndex((line) => !is_blank(line) && !is_comment(line) && indent_width(line) < width)

	return relative === -1 ? limit : from + relative
}

// The block runs to the next key line left of `width`. A comment left of `width` in the middle stays
// inside, while the run of such comments right before that key belongs to what follows.
function block_end(
	lines: ReadonlyArray<string>,
	from: number,
	width: number,
	limit: number,
): number {
	const stop = block_stop(lines, from, width, limit)
	let end = stop

	for (let index = stop - 1; index >= from && is_detached(lines[index], width); index -= 1) {
		if (!is_blank(lines[index])) end = index
	}

	return end
}

// The next top-level key. A list written flush with `updates:` and a comment at column 0 both still
// belong to it, so neither ends the list.
function updates_end(lines: ReadonlyArray<string>, updates: number): number {
	const relative = lines.slice(updates + 1).findIndex((line) => TOP_LEVEL_KEY_PATTERN.test(line))

	return relative === -1 ? lines.length : updates + 1 + relative
}

function find_entries(lines: ReadonlyArray<string>, updates: number): Array<UpdateEntry> {
	const limit = updates_end(lines, updates)
	const starts = lines
		.map((line, index) => ({ index, item: /^(\s*-\s+)\S/u.exec(line)?.[1] }))
		.filter(({ index, item }) => index > updates && index < limit && item !== undefined)
	const item_width = Math.min(...starts.map(({ item }) => item?.indexOf('-') ?? 0))

	return starts
		.filter(({ item }) => item?.indexOf('-') === item_width)
		.map(({ index, item = '' }) => ({
			start: index,
			end: block_end(lines, index + 1, item.length, limit),
			key_indent: ' '.repeat(item.length),
		}))
}

// The entry's own `cooldown:` key, either on a key line or on the item line itself (`- cooldown:`).
function is_cooldown_key(line: string, index: number, key_indent: string): boolean {
	const is_key_line = index === 0 || line.startsWith(key_indent)

	return is_key_line && line.slice(key_indent.length).startsWith(COOLDOWN_KEY)
}

// An entry that opened with `- cooldown:` hands its item marker to the next key once the block goes.
function promote_first_key(rest: ReadonlyArray<string>, marker: string): Array<string> {
	const first = rest.findIndex((line) => !is_blank(line) && !line.trimStart().startsWith('#'))

	return rest.map((line, index) =>
		index === first ? `${marker}${line.slice(marker.length)}` : line,
	)
}

function without_cooldown(entry: ReadonlyArray<string>, key_indent: string): Array<string> {
	const start = entry.findIndex((line, index) => is_cooldown_key(line, index, key_indent))
	if (start === -1) return [...entry]
	const rest = entry.slice(block_end(entry, start + 1, key_indent.length + 1, entry.length))
	if (start > 0) return [...entry.slice(0, start), ...rest]

	return promote_first_key(rest, (entry.at(0) ?? '').slice(0, key_indent.length))
}

function rewrite_entry(
	entry: ReadonlyArray<string>,
	key_indent: string,
	window: ReleaseWindow,
): Array<string> {
	const ecosystem = entry.map((line) => ECOSYSTEM_PATTERN.exec(line)?.[1]).find(Boolean)
	if (ecosystem === undefined) return [...entry]
	const body = trim_trailing_blanks(without_cooldown(entry, key_indent))
	const trailing = entry.slice(trim_trailing_blanks(entry).length)

	return [...body, ...cooldown_lines(ecosystem, window, key_indent), ...trailing]
}

function merge_cooldown(existing: string, window: ReleaseWindow): string {
	const lines = existing.split('\n')
	const updates = lines.findIndex((line) => UPDATES_PATTERN.test(line))
	if (updates === -1) return existing

	for (const { start, end, key_indent } of find_entries(lines, updates).toReversed()) {
		lines.splice(start, end - start, ...rewrite_entry(lines.slice(start, end), key_indent, window))
	}

	return lines.join('\n')
}

function sync_dependabot_cooldown(root: string): boolean {
	const config_path = path.join(root, DEPENDABOT_FILE)
	if (!existsSync(config_path)) return false
	const existing = readFileSync(config_path, 'utf8')
	const merged = merge_cooldown(existing, release_window.read_release_window(root))
	if (merged === existing) return false
	file_content.write_contained(config_path, merged)

	return true
}

const dependabot_cooldown = { cooldown_days, merge_cooldown, sync_dependabot_cooldown }

export { dependabot_cooldown }
