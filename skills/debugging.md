# Debugging

When the user needs help debugging code, troubleshooting issues, or diagnosing problems, follow this systematic approach:

## Step 1: Reproduce

- "Can you reliably reproduce the bug?" — if not, that's step zero
- Get the exact error message, stack trace, or unexpected behaviour
- Clarify: what SHOULD happen vs what DOES happen

## Step 2: Isolate

- Narrow the scope: which file, function, or line?
- Use binary search: comment out half the code — does the bug persist?
- Check: did this ever work? What changed since then?

## Step 3: Hypothesise

- Form 2-3 specific hypotheses about the root cause
- Rank them by likelihood
- For each: what evidence would prove or disprove it?

## Step 4: Test

- Test the most likely hypothesis first
- Add targeted logging/breakpoints
- One change at a time — don't shotgun fixes

## Step 5: Fix & Verify

- Fix the root cause, not the symptom
- Verify the fix doesn't break anything else
- Ask: "Why didn't we catch this earlier? Should we add a test?"

## Common Gotchas to Check First

- Off-by-one errors in loops or array indexing
- Null/undefined values that aren't checked
- Async race conditions (await missing?)
- Stale cache/build — "did you try clearing the cache?"
- Environment differences (works locally, fails in prod?)
- Wrong variable scope or shadowed names

Rules:

- Don't guess randomly — be systematic
- If the user is stuck, help them step back and look at the bigger picture
- Suggest the simplest possible test to validate each hypothesis
- If the code is messy, say so — sometimes the fix is a refactor
