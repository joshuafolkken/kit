import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import node_path from 'node:path'

// joshuafolkken/kit#8685: joshuafolkken/kit#8676's plan named `ThemeDefinition` but not the file
// defining it, which its body named, and it launched beside joshuafolkken/kit#8673, which planned it.
// A throwaway repository holding that file, one its plan named by path, and one its body only cited.

const THEME_DEFS = 'scripts/run/board/run-board-theme-defs.ts'
const PANEL_DRAW = 'scripts/run/board/run-board-panel-draw.ts'
const NOTES = 'scripts/run/board/run-board-notes.ts'
const THEME_PLAN = `1.\`ThemeDefinition\` に口を足す\n2. \`${PANEL_DRAW}\` で描く\n`
const THEME_BODY = `読むべき関数: \`run-board-theme-defs.ts\`、\`${NOTES}\``
const FILES: ReadonlyArray<readonly [string, string]> = [
	[THEME_DEFS, 'interface ThemeDefinition {\n\tname: string\n}\n'],
	[PANEL_DRAW, 'const panel = 1\n'],
	[NOTES, 'function note(theme: ThemeDefinition): void {}\n'],
]

// The repository under `directory`, its git commands run from there so none reaches the checkout.
function board_repo(directory: string): string {
	execFileSync('git', ['init', '-q'], { cwd: directory })

	for (const [file, text] of FILES) {
		const target = node_path.join(directory, file)

		mkdirSync(node_path.dirname(target), { recursive: true })
		writeFileSync(target, text)
	}

	execFileSync('git', ['add', '.'], { cwd: directory })

	return directory
}

const plan_definitions_fixture = {
	board_repo,
	PANEL_DRAW,
	THEME_BODY,
	THEME_DEFS,
	THEME_PLAN,
}

export { plan_definitions_fixture }
