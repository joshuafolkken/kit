import { readFileSync } from 'node:fs'
import { import_closure as walker } from '#scripts/lib/import-closure'
import { main_guard } from '#scripts/lib/main-guard'

// The import closure the two distribution guards need (joshuafolkken/kit#1997):
// `distribution-boundary.test.ts` walks the runtime seeds to prove they reach no report module, and
// `pack-boundary.test.ts` walks every distributed command's entry to prove its closure is packed. The
// walker itself is `scripts/lib/import-closure.ts`, which a runtime command shares
// (joshuafolkken/kit#7134).

// The judgment is `main-guard.ts`'s, which `lane:plan --imports` shares (joshuafolkken/kit#5928).
function has_main_guard(file: string): boolean {
	return main_guard.has_main_guard(readFileSync(file, 'utf8'))
}

const import_closure = { ...walker, has_main_guard }

export { import_closure }

export { SCRIPTS_DIR, TOOLS_DIR } from '#scripts/lib/import-closure'
