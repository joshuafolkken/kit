#!/usr/bin/env tsx
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { base_tree } from '#scripts/git/base-tree'
import { change_base } from '#scripts/git/change-base'
import { git_spawn } from '#scripts/git/git-spawn'
import { COMMAND_TIMEOUT_MS } from '#scripts/lib/timeouts'
import type { Hunk } from '#scripts/test/test-pinned-logic'
import { execa } from 'execa'
import { prose_stale_read } from './prose-stale-read'
import { prose_stale_scan } from './prose-stale-scan'
import { review_interaction } from './review-interaction'
import { review_untouched_readers } from './review-untouched-readers'
import { selfcheck_commands, type ProbeResult, type Runner } from './selfcheck-commands'
import { selfcheck_report, type Sections } from './selfcheck-report'

// `josh review:selfcheck` — the self-check's questions 2, 4 and 10 (`prompts/review.md`) in one call
// (joshuafolkken/kit#5540): `prose:stale`'s scan, the readers outside the diff `review:brief` lists, and
// each `pnpm josh …` an added line writes run in a scratch worktree at HEAD with the change copied in.
// The diff runs from the change base to the working tree; an untracked file counts as wholly added.
// Exit 0 pass, 1 a stale mention or a failed command, 2 when the base or a search could not be read.

const USAGE = 'usage: josh review:selfcheck'
const NO_BASE = 'review:selfcheck: no change base — fetch the default branch, then re-run'
const TREE_PREFIX = 'josh-selfcheck-'
// The parent `pnpm josh` run's own script context, which would pin the child to the lane's root.
const INHERITED_SCRIPT_KEY = /^(?:npm_|INIT_CWD$|PNPM_SCRIPT_SRC_DIR$)/u
// `process.argv` holds the runtime and the script before the command's own arguments.
const FIRST_ARGUMENT = 2

async function untracked_hunks(root: string): Promise<Array<Hunk>> {
	const listed = await git_spawn.read(['-C', root, 'ls-files', '--others', '--exclude-standard'])
	const files = listed.split('\n').filter((file) => file !== '')

	return await Promise.all(
		files.map(async (file) => {
			const text = await readFile(path.join(root, file), 'utf8')
			const new_lines = text.split('\n')

			return { file, new_start: 1, new_count: new_lines.length, old_lines: [], new_lines }
		}),
	)
}

async function change_hunks(root: string, base: string): Promise<Array<Hunk>> {
	return [...(await prose_stale_read.read_hunks(root, base)), ...(await untracked_hunks(root))]
}

function child_environment(): NodeJS.ProcessEnv {
	const entries = Object.entries(process.env).filter(([key]) => !INHERITED_SCRIPT_KEY.test(key))

	return Object.fromEntries(entries)
}

async function exec(args: ReadonlyArray<string>, cwd: string): Promise<ProbeResult> {
	const result = await execa('pnpm', ['josh', ...args], {
		cwd,
		input: '',
		all: true,
		reject: false,
		extendEnv: false,
		env: child_environment(),
		timeout: COMMAND_TIMEOUT_MS,
	})

	return { exit_code: result.timedOut ? undefined : result.exitCode, output: result.all }
}

function runner_in(tree: string): Runner {
	return {
		tree,
		exec,
		is_path: (argument) =>
			/[./]/u.test(argument) && !argument.startsWith('-') && existsSync(path.join(tree, argument)),
	}
}

// The scratch tree is a worktree at HEAD with every changed file copied in; it is removed after.
async function run_commands(
	root: string,
	hunks: ReadonlyArray<Hunk>,
): Promise<Sections['commands']> {
	const commands = selfcheck_commands.extract(hunks)

	if (commands.length === 0) return { lines: [], failed: 0 }

	const present = [...new Set(hunks.map((hunk) => hunk.file))].filter((file) =>
		existsSync(path.join(root, file)),
	)

	return await base_tree.with_tree(TREE_PREFIX, 'HEAD', async ({ tree }) => {
		await base_tree.copy_in(tree, present)

		return await selfcheck_commands.run(commands, runner_in(tree))
	})
}

async function sections(root: string, base: string): Promise<Sections> {
	const hunks = await change_hunks(root, base)
	const paths = [...new Set(hunks.map((hunk) => hunk.file))]
	const stale = prose_stale_scan.report(await prose_stale_read.references(root, hunks))
	const readers = await review_untouched_readers.read({ root, base, paths })
	const interaction = review_interaction.due_paths(paths, root)

	return { stale, readers, interaction, commands: await run_commands(root, hunks) }
}

function refuse(message: string): number {
	console.error(message)

	return selfcheck_report.FAILED_EXIT
}

async function run(argv: ReadonlyArray<string>): Promise<number> {
	if (argv.length > 0) return refuse(USAGE)

	const base = await change_base.resolved()

	if (base === undefined) return refuse(NO_BASE)

	const root = await git_spawn.read(['rev-parse', '--show-toplevel'])
	const { text, exit_code } = selfcheck_report.report(await sections(root, base))

	console.info(text)

	return exit_code
}

// A git call that throws exits 2, never 1's "found".
async function guarded(argv: ReadonlyArray<string>): Promise<number> {
	try {
		return await run(argv)
	} catch (error) {
		return refuse(`review:selfcheck: ${String(error)}`)
	}
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exitCode = await guarded(process.argv.slice(FIRST_ARGUMENT))
}

const selfcheck_cli = { change_hunks, child_environment, guarded, run, sections, untracked_hunks }

export { selfcheck_cli }
