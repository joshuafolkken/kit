# The guards' shared shell tokenizer — rationale

The guards read a Bash line through `scripts/rules/shell-tokens.ts`, a hand-written tokenizer, and `scripts/rules/shell-segments.ts` cuts the line where that tokenizer puts a control operator or a compound command's opening word (joshuafolkken/kit#7334). The other modules that parse a line move onto it in later children of the same epic.

## Why not a parser package

`pnpm josh pkg:scout shell tokenizer split quote` (2026-11-12) named two shell candidates: `shell-quote@1.12.0` and `shlex@3.0.0`. Both were rejected because of what they return:

- No offsets. A guard cuts the typed line at the offsets the quote-blanked line puts each separator, so a `;` in quotes is text while the segment keeps its quotes (`quote_aware_commands_of`, `piped-verification.ts`). `shell-quote`'s `parse` returns argv with the quotes removed, and `shlex` splits words only, with no operators. Neither gives a position in the line.
- Expansion. `parse('case $x in a) echo hi;; esac')` returns `["case","","in","a",{op:")"},"echo","hi",{op:";;"},"esac"]`: `$x` is expanded from the environment to `""`, so the guard would judge the hook process's environment instead of the line as typed.
- A redirection split into operators. `2>&1` comes back as `"2"`, `{op:">&"}`, `"1"`. The guards keep a redirection's `&` in its word, so it never reads as a background `&`.

Reaching the same cut would need both a wrapper that maps the tokens back to offsets and a second reading of the quotes. That is two parsers where one was asked for.

## `guard_startup`

`guard_startup` runs on every PreToolUse call (`josh-commands-rationale.md` → "`josh metrics`' durations"). These figures were measured on the development machine on 2026-11-12. Each is the fastest of nine runs fed `{}`, as in `metrics-duration-probe.ts`. Each reading was taken beside a bare `node` start, because the machine's noise (about ±3 ms) was larger than any difference:

| Reading                                                | Fastest | Bare `node` beside it |
| ------------------------------------------------------ | ------- | --------------------- |
| `pretool-guard` hook before this change                | 26.8 ms | 28.7 ms               |
| `pretool-guard` hook after this change                 | 28.8 ms | 27.2 ms               |
| `node` plus `require('shell-quote/parse')`             | 30.6 ms | 32.7 ms               |
| `node` plus `require('shell-quote/parse')`, second run | 32.0 ms | 29.9 ms               |

- `shell-quote`: loading it was within the noise of a bare start, at most about 2 ms. To be adopted, it would have to join `INLINED_PACKAGES` in `scripts/build/build-hooks.ts` like the other hook dependencies (#5641). It was rejected for its output, not its cost.
- The hand-written tokenizer adds one regular expression and a few small functions to a module already in the `pretool-guard` bundle. It adds no import, and its startup increment is within the same noise.

## What the cut reads

- One operator per control operator, longest first: `;;`, `;;&` and `;&` end a `case` arm as one cut, so an arm no longer leaves an empty segment between two `;`.
- A compound opener is a cut. A `{` at a command's start or after `name()` opens a group or a function body, so `f() { rm -rf x; }` yields `rm -rf x` as a segment a rule anchored at `^rm` reads. A word ending in `)` right after `case … in`, or after an arm's `;;`, is a pattern, so the arm's command starts a segment too.
- An arm's pattern may start the line after `in` or `;;`: the newlines between are passed over when looking for them.
- Not read yet: a pattern spelled with `|` (`a|b)`), `function f {` and a subshell body `f() ( … )`. `implementation-shell.ts` still refuses those as an unread body.
