import type { CommandEntry } from './josh-command-types'

// The document-reading and -editing command registry, split out of `josh-commands-ai.ts` so that file
// stays under its 300-code-line limit, exactly as `SPLIT_COMMANDS` was for the same reason.
// It is spread into
// `AI_COMMANDS` so the commands stay grouped under the 'AI tools' category. `read:files` and
// `edit:files` are the read/write halves of the round-trip fold.

/* eslint-disable @typescript-eslint/naming-convention */
const DOCUMENT_COMMANDS: Record<string, CommandEntry> = {
	'doc:section': {
		script: 'scripts/document/document-section-cli.ts',
		description: 'Print one section of a markdown document, for a `file.md` → "Heading" reference',
		category: 'AI tools',
		reference: ['<file> <heading>', 'automation', ['none']],
		is_bundled: true,
		usage: {
			examples: [
				{ arguments: '<file.md> "<heading>"' },
				{ arguments: 'backlogrun.md "The hand-off"' },
			],
		},
	},
	'read:set': {
		script: 'scripts/document/read-set-cli.ts',
		description: 'Print what an entry point reads before it starts, and what that read costs',
		category: 'AI tools',
		reference: ['[<entry>] [--json]', 'automation', ['none']],
		usage: {
			examples: [
				{ arguments: '', note: 'every entry point' },
				{ arguments: 'backlogrun', note: 'one of them' },
				{ arguments: 'backlogrun --json' },
			],
		},
	},
	'doc:read': {
		script: 'scripts/document/document-read-cli.ts',
		description:
			'Read a whole document safely: print it, or point at the Read tool when over the Bash cap',
		category: 'AI tools',
		reference: ['<file>', 'automation', ['none']],
		usage: {
			examples: [
				{ arguments: 'CLAUDE.md', note: 'under the cap: prints the document' },
				{ arguments: 'backlogrun.md', note: 'over the cap: prints a directive, no content' },
			],
		},
	},
	'read:files': {
		script: 'scripts/document/read-files-cli.ts',
		description: 'Read several files in one call so edit targets fold into one turn',
		category: 'AI tools',
		reference: ['<path> [<path> ...]', 'automation', ['none']],
		usage: {
			examples: [
				{
					arguments: 'a.ts b.ts c.ts',
					note: 'under the cap: prints each file under its own header',
				},
				{
					arguments: 'a.ts big.ts',
					note: 'over the cap: prints a directive to Read them in one turn, no content',
				},
			],
		},
	},
	'edit:files': {
		script: 'scripts/document/edit-files-cli.ts',
		description: 'Apply several content-addressed edits from a plan in one call',
		category: 'AI tools',
		reference: ['<plan-path | ->', 'automation', ['none']],
		usage: {
			examples: [
				{
					arguments: 'plan.txt',
					note: 'applies every block in the plan, one line per edit reporting the outcome',
				},
				{ arguments: "- <<'EDITS'", note: 'plan from stdin, then EDITS' },
			],
		},
	},
}
/* eslint-enable @typescript-eslint/naming-convention */

export { DOCUMENT_COMMANDS }
