#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { git_gh_command } from '#scripts/git/git-gh-command'
import type { IssueRead } from '#scripts/git/git-gh-issue-read'
import { bounded_pool } from '#scripts/lib/bounded-pool'
import { z } from 'zod'
import { issue_cite, type CiteTarget } from './issue-cite'

// `josh issue:cite <N> [<N> ...] [--repo <owner/repo>]` — the paste-ready citation line for every
// Issue named, in one call (joshuafolkken/kit#2220).
//
// It answers the cost that made the bare `#N` cheaper than the correct citation: the title each line
// needs used to be a per-Issue `gh api` read, and naming several Issues at once — a backlog listing, a
// lane status report — meant several round trips before a single correct line could be written. The
// numbers go in together and the titles come back together, so the correct form is now the cheap one.
//
// **A token that is not a number refuses the whole invocation**, exactly as `issue:read` does: an
// argument the parser cannot read is a mistake, and dropping it answers fewer Issues than were asked
// for while still exiting zero. **A number that resolves to nothing, or a read that failed, is named
// as a failure line** rather than silently missing — the reader is told which numbers have no citation
// instead of subtracting the printed lines from what was asked.

const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const ARGV_OFFSET = 2
// The same bound `issue:read` puts on its batch read: every read is a `gh` process, and an unbounded
// fan-out is answered with secondary rate limiting rather than with titles.
const READ_CONCURRENCY = 8
const TITLE_FIELD = 'title'
const LINE_SEPARATOR = '\n'
const USAGE = 'Usage: josh issue:cite <issue-number|owner/repo#N> [ ... ] [--repo <owner/repo>]'

const title_schema = z.looseObject({ title: z.string() })

type LineResult = { kind: 'ok'; line: string } | { kind: 'fail'; line: string }

// The title out of the one-field read, or `undefined` for an empty or unparseable one — an empty title
// is not a summary, so it is reported as a read that produced nothing rather than cited as a blank.
function parse_title(json: string): string | undefined {
	try {
		const title = title_schema.parse(JSON.parse(json)).title.trim()

		return title === '' ? undefined : title
	} catch {
		return undefined
	}
}

// A read's outcome as one line: the citation on success, the matching failure line otherwise. The
// classification is the reader's own — `missing` will not change on a retry, `unreadable` may.
function to_line(target: CiteTarget, slug: string, read: IssueRead): LineResult {
	if (read.kind === 'missing') return { kind: 'fail', line: issue_cite.missing_line(target) }
	if (read.kind !== 'read') return { kind: 'fail', line: issue_cite.unreadable_line(target) }

	const title = parse_title(read.json)
	if (title === undefined) return { kind: 'fail', line: issue_cite.unreadable_line(target) }

	return { kind: 'ok', line: issue_cite.citation_line(slug, target.number, title) }
}

// The repository the link names: the target's own when it is qualified, the local one otherwise. A
// bare number with no local repository has no link to build, so it fails rather than citing a
// repository it could not read.
async function cite_target(
	target: CiteTarget,
	local_slug: string | undefined,
): Promise<LineResult> {
	const slug = target.repo ?? local_slug
	if (slug === undefined) return { kind: 'fail', line: issue_cite.no_repo_line(target) }

	const read = await git_gh_command.issue_view_json_classified(
		target.number,
		TITLE_FIELD,
		target.repo,
	)

	return to_line(target, slug, read)
}

// Every positional as a target, or `undefined` if any one of them is not a number — the invocation is
// refused whole so a mistyped argument never silently loses its citation.
function parse_targets(
	positionals: ReadonlyArray<string>,
	default_repo: string | undefined,
): ReadonlyArray<CiteTarget> | undefined {
	const targets: Array<CiteTarget> = []

	for (const token of positionals) {
		const target = issue_cite.parse_target(token, default_repo)
		if (target === undefined) return undefined
		targets.push(target)
	}

	return targets.length === 0 ? undefined : targets
}

// The local `owner/repo`, read once and only when a bare target needs it: a run that names every
// target with a repository never makes the request.
async function local_slug_for(targets: ReadonlyArray<CiteTarget>): Promise<string | undefined> {
	const has_bare_target = targets.some((target) => target.repo === undefined)

	return has_bare_target ? await git_gh_command.repo_get_name_with_owner() : undefined
}

// Citations to stdout so the block stays paste-ready; failures to stderr so each unanswered number is
// named without landing in what gets pasted. A failure sets a non-zero exit.
function report(results: ReadonlyArray<LineResult>): number {
	const lines = results.filter((result) => result.kind === 'ok').map((result) => result.line)
	const failures = results.filter((result) => result.kind === 'fail').map((result) => result.line)

	if (lines.length > 0) console.info(lines.join(LINE_SEPARATOR))
	for (const failure of failures) console.error(failure)

	return failures.length === 0 ? SUCCESS_EXIT_CODE : FAILURE_EXIT_CODE
}

async function run(args: ReadonlyArray<string>): Promise<number> {
	const parsed = parseArgs({
		args: [...args],
		options: { repo: { type: 'string' } },
		allowPositionals: true,
	})
	const targets = parse_targets(parsed.positionals, parsed.values.repo)

	if (targets === undefined) {
		console.error(USAGE)

		return FAILURE_EXIT_CODE
	}

	const local_slug = await local_slug_for(targets)
	const results = await bounded_pool.bounded_map(
		targets,
		READ_CONCURRENCY,
		async (target) => await cite_target(target, local_slug),
	)

	return report(results)
}

async function main(args: ReadonlyArray<string>): Promise<void> {
	process.exitCode = await run(args)
}

const issue_cite_cli = {
	USAGE,
	main,
	parse_targets,
	parse_title,
	report,
	run,
	to_line,
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export { issue_cite_cli }
