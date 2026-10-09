# File edits do not carry the file's text in a command — rationale

This is maintainer-only rationale behind `prompts/collaboration-workflow/file-edits.md` — the
measurements and the arguments that justify the procedure's boundaries. No run reads it. Every
trigger, action, verdict and limit an agent follows stays in the procedure, and a change to this file
changes no rule.

## Measured cost of whole-file rewrites

Measured on the joshuafolkken/kit#1251 run (joshuafolkken/kit#1260):

| Turn                   | Output tokens | What it was                                                     |
| ---------------------- | ------------- | --------------------------------------------------------------- |
| Fixing review findings | 11,104        | Whole-file rewrites of two files; the run's largest single turn |
| Another turn, same run | 3,282         | A whole-file rewrite                                            |

At an effective generation rate of about 87 tokens per second, **this one run spent about 2 minutes
45 seconds retyping lines that already existed.**

## Measured breakdown of command text

The breakdown measured from the transcript of the joshuafolkken/kit#1144 run
(joshuafolkken/kit#1150):

| Kind                  | Share     |
| --------------------- | --------- |
| tool_result           | 37.7%     |
| **Bash command text** | **30.2%** |
| thinking              | 24.9%     |
| text                  | 4.7%      |

The 97,042 tokens of Bash command text over 427 calls broke down as:

| Kind                             | Calls | Tokens     | Share     |
| -------------------------------- | ----- | ---------- | --------- |
| File edits as `python3 - <<'PY'` | 145   | **79,317** | **81.7%** |
| git / gh / pnpm                  | 140   | 12,716     | 13.1%     |
| Reads and searches               | 110   | 3,215      | 3.3%      |
| Other                            | 32    | 1,794      | 1.8%      |

**The edit scripts alone took about a fifth of the whole session's context.** They averaged 547
tokens a call, the largest 1,200–1,800. What costs most is not the total but that each one is counted
twice and stays in the context for the rest of the run.

Re-measuring after the rule took effect is joshuafolkken/kit#1159.

## Why it is resident

The residency criterion (`residency.md`) comes down to one question:

> **Must the rule fire on a turn where no skill was loaded?**

Yes. File edits happen on turns where no workflow keyword was typed, and **no skill is loaded just
before an edit.** With the body in a skill, the rule would never fire — the same behavior as writing
the rule and then deleting it.

Even so, the resident side holds **only the trigger and the pointer**. These three points are what it
keeps, and they are enough to behave correctly:

1. Make a region-scoped edit with Edit; never write a region back through an interpreter or a heredoc
2. **Never widen Edit itself to the whole file** (joshuafolkken/kit#1260)
3. The criterion is whether the call carries the text wholesale, not which tool it is (a short
   `sed -i` is allowed)

The measurements, the allowed/refused table, the double-counting explanation, the three conditions
under which a whole-file rewrite is allowed, and **the concrete interpreter forms**
(`python3 - <<'PY'` / `node -e` / `cat > file <<'EOF'`) live in `file-edits.md` and are left out of
the resident side: they are the kind of text an agent behaves correctly without, and is more
convinced with. **Moving the concrete forms to the pointer target is a move, not a deletion** — the
resident "an interpreter or a heredoc" carries the prohibited category, and `file-edits.md`'s table
carries the individual forms.

## Marker tests

No suite pins the list below any more. joshuafolkken/kit#1260 added it as
`scripts/inline-edit-rule.test.ts`, and joshuafolkken/kit#1923 deleted that suite when phrase-pinning
tests gave way to structural document checks; `scripts/document/document-markers.test.ts`, which
replaced them, does not cover this rule. What is pinned today is the hook, not the wording:
`scripts/rules/file-body.test.ts` pins which commands carry a file body and that the refusal names
`file-edits.md`, and `scripts/rules/shell-body-rule.test.ts` pins that the `CLAUDE.md` file-edit line
is present. The list is kept as the record of what the deleted suite held (_the procedure_ in the list is
`file-edits.md`):

- The rule's trigger sentence and its criterion sentence are resident in `CLAUDE.md`
- The ban on whole-file rewrites ("never widen Edit to the whole file") is resident in `CLAUDE.md`
- The resident side points at the procedure
- The procedure holds the criterion, the allowed/refused table, the four `sed -i` conditions and the
  three conditions for a whole-file rewrite
- The three concrete interpreter forms (`python3 - <<'PY'` / `node -e` / `cat > file <<'EOF'`) are on
  neither the resident side nor the residency list, and are in the procedure
- The measurements (79,317 / 81.7% / 30.2% / 11,104 / 3,282) have not been pasted back onto the
  resident side or the residency list
- The residency lists (`.claude/skills/workflow-commands/SKILL.md` and
  `prompts/collaboration-workflow/residency.md`) name this rule
