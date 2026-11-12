// What makes a module unsafe to import, judged on its source text alone: a main guard, which fires a
// second main inside a bundle (joshuafolkken/kit#4186), or a top-level `main()` that runs on import
// (joshuafolkken/kit#5912). `main-guard-boundary.test.ts` shares the guard check over every imported
// module; `lane:plan --imports` asks both before a lane writes the import (joshuafolkken/kit#5928).

// A statement at the start of a line, so a comment or a string that only names `process.argv[1]` or
// `main()` is neither. The call is top-level alone or as the first statement of a top-level `try`, the
// shape `epic.ts` had.
const MAIN_GUARD = /^if \(process\.argv\[1\] ===/mu
const UNCONDITIONAL_MAIN = /^(?:try \{\n\s+)?(?:await |void )?main\(/mu

const GUARD_REASON = 'main guard'
const UNCONDITIONAL_REASON = 'unconditional main()'

function has_main_guard(source: string): boolean {
	return MAIN_GUARD.test(source)
}

// Why a module with `source` cannot be imported, or undefined when it can.
function import_blocker(source: string): string | undefined {
	if (has_main_guard(source)) return GUARD_REASON
	if (UNCONDITIONAL_MAIN.test(source)) return UNCONDITIONAL_REASON

	return undefined
}

const main_guard = { GUARD_REASON, UNCONDITIONAL_REASON, has_main_guard, import_blocker }

export { main_guard }
