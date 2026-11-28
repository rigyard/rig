# Fixtures

This directory holds the two bug-fix fixtures of the eval `rule:bug-fix-callers`, with their primary graders. They are the files that produced the recorded fx3 and fx4b cells in `history.jsonl`. `test/eval-fixture.test.ts` checks that their hashes equal the hashes of those cells.

A rig maintainer wrote both fixtures for these evals. They are small synthetic projects, not tasks from a public benchmark. To run a trial, follow "Run a trial by hand" in [CONTRIBUTING.md](../CONTRIBUTING.md).

## Layout

```
fixtures/
  .gitattributes        turns off line-ending conversion, so a checkout keeps the bytes that the hashes cover
  rule.txt              the text that the rule arm puts in the project instruction file
  <fx>/
    fixture/            the project tree that the agent works in
    grader/check.ts     the primary grader, copied into the work dir only after the trial
    prompt.txt          the task prompt, one line
```

`rule.txt` is 187 bytes with the trailing newline. Its sha256 is `4e8c5d3f01c69c929959d1d9e19c5e77ce0c8fac49459fa38930994f51db42ff`. The `none` arm has no instruction file.

## fx3: member directory

The project lists club members in name order. The list sorts names by their character codes, so names that start with an accented letter, such as Émile, Óscar and Ángel, come after Zoe. The prompt reports only the wrong order of the list. Two other functions depend on the same order: the lookup by name runs a binary search over the sorted list, and the merge of two branch lists compares names the same way. A fix that changes only the list order breaks both of them.

The grader has 4 tests. One checks that the list puts accented names with their base letter. Three check the other callers: plain names are still found, every listed member can be looked up by name and an unknown name is not found, and merging two ordered lists in either order gives the directory order. A trial passes only if all 4 tests pass.

## fx4b: storefront

The project is a checkout service on top of an async key-value store. Each read and each write waits for the next event loop turn. Stock reservation reads the stock, waits, then writes the new value, so two checkouts that run at the same time can both take the last unit. The prompt reports only the double sale. The loyalty points award does the same read, wait, write sequence, and so do the stock release and the add-to-cart step.

The grader has 4 tests, each with an 8 second timeout. Two check the reported behavior: two carts that check out the last unit together sell it once, and six concurrent reservations of one unit against a stock of three succeed exactly three times. Two check the shared cause: eight concurrent awards of 5 points add up to 40, and three concurrent checkouts that fail on an out-of-stock item leave the other stock unchanged and do not hang. A trial passes only if all 4 tests pass. On the untouched fixture the last test passes and the other three fail.

The fx4b runs also used a secondary grader with 5 tests. Its result was descriptive only. It is not published here.

## Hashes

`node scripts/eval-fixture.ts hash <fx>` prints both hashes.

- `grader_sha256` is the sha256 of `grader/check.ts`.
- `fixture_sha256` is the sha256 of a text with one line per file of `fixture/`, `.git` excluded. Each line is `<sha256 of the file bytes>  ./<relative path>`, with two spaces. Each line ends in a newline. The lines are sorted by the lower-cased relative path in byte order, and ties are broken by the path in byte order. So `package.json` comes before `README.md`.

| Fixture | `fixture_sha256` | `grader_sha256` |
| --- | --- | --- |
| fx3 | `1dc4cff312ea7ccf47c95c2acd721cbfb959d78e90ff88dbae780ae72debfd5b` | `2a63cd895b5f963abbb56ec7120083b124a8383c6c84afa0f0239daf9859d695` |
| fx4b | `e7b90d2411894ded157629570babf3c3df5c503f30d230be465cf8f595073565` | `f8a946000b8d25b51ab6825eafee1bad017dbac975973a6b6a3fdfe0b5aa02e3` |

For these two trees this shell line gives the same value. The script is the reference.

```sh
cd evals/fixtures/fx3/fixture
find . -type f | LC_ALL=C sort -f | while read -r f; do printf '%s  %s\n' "$(shasum -a 256 "$f" | cut -d' ' -f1)" "$f"; done | shasum -a 256
```

A changed fixture or grader starts a new trend group. Do not edit these files. A new version goes into a new fixture id.
