import type { CommandEntry } from './josh-command-types'

// The document-reading and -editing command registry, split out of `josh-commands-ai.ts` so that file
// stays under its 300-code-line limit, exactly as `SPLIT_COMMANDS` was for the same reason
// (joshuafolkken/kit#2162, joshuafolkken/kit#2218, joshuafolkken/kit#2366). It is spread into
// `AI_COMMANDS` so the commands stay grouped under the 'AI tools' category. `read:files` and
// `edit:files` are the read/write halves of the round-trip fold (joshuafolkken/kit#2202 / #2366).

/* eslint-disable @typescript-eslint/naming-convention */
const DOCUMENT_COMMANDS: Record<string, CommandEntry> = {
	'doc:section': {
		script: 'scripts/document/document-section-cli.ts',
		description: 'Print one section of a markdown document, for a `file.md` → "Heading" reference',
		category: 'AI tools',
		reference: ['<file> <heading>', 'automation', ['none']],
	},
	'read:set': {
		script: 'scripts/document/read-set-cli.ts',
		description: 'Print what an entry point reads before it starts, and what that read costs',
		category: 'AI tools',
		reference: ['[<entry>] [--json]', 'automation', ['none']],
	},
	'doc:read': {
		script: 'scripts/document/document-read-cli.ts',
		description:
			'Read a whole document safely: print it, or point at the Read tool when over the Bash cap',
		category: 'AI tools',
		reference: ['<file>', 'automation', ['none']],
	},
	'read:files': {
		script: 'scripts/document/read-files-cli.ts',
		description: 'Read several files in one call so edit targets fold into one turn',
		category: 'AI tools',
		reference: ['<path> [<path> ...]', 'automation', ['none']],
	},
	'edit:files': {
		script: 'scripts/document/edit-files-cli.ts',
		description: 'Apply several content-addressed edits from a plan in one call',
		category: 'AI tools',
		reference: ['<plan-path>', 'automation', ['none']],
	},
}
/* eslint-enable @typescript-eslint/naming-convention */

export { DOCUMENT_COMMANDS }
