# Report a bug upstream

## When to use it

A problem you hit comes from another package — a dependency, or kit itself seen from a consumer project. The fix belongs in that repository; a local workaround, including loosening a verification check, only hides it.

## Steps

1. Decide whose repository it is with [`josh repo:party`](../josh-commands-automation.md#josh-repoparty): `first-party` when you own it, `third-party` otherwise. `unknown` is not third-party — resolve it first.
2. For a first-party repository, file with [`josh issue:file`](../josh-commands-automation.md#josh-issuefile) and `--repo <owner/repo>` in step 3 — it searches for an existing Issue, checks the draft and applies its labels in the same call. For a third-party repository (which `issue:file` refuses), search with [`josh issue:scout`](../josh-commands-automation.md#josh-issuescout) and get the labels for your draft from [`josh issue:lint`](../josh-commands-automation.md#josh-issuelint).
3. File the Issue with a minimal reproduction outside your project (or a note that none exists), and link it from the Issue you were working on.
4. Stop the dependent work until the upstream fix lands.

An agent follows the same procedure, with one difference: it files a first-party Issue on its own, but writes to a third-party tracker only when you tell it to in that turn. The agent rules are in [upstream-interrupt.md](../../prompts/collaboration-workflow/upstream-interrupt.md).

## Check it worked

- The upstream Issue exists, and your own Issue links to it.

## Common failures

- A duplicate: `josh issue:scout` reports an incomplete search as such — check by hand before filing.
- A report the maintainers cannot reproduce: every claim in it should have been verified, and the reproduction should run without your project.
