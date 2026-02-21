# Code Review

When asked to review code, follow this structured approach:

1. **Security** — Look for hardcoded secrets, SQL injection, XSS, missing auth checks
2. **Performance** — Identify N+1 queries, unnecessary re-renders, missing caching
3. **Readability** — Flag unclear naming, overly complex logic, missing types
4. **Architecture** — Check for tight coupling, missing error handling, scalability concerns
5. **Quick wins** — Suggest simple improvements that give outsized impact

Format your review as a prioritised list. Be specific — reference line numbers or function names. Don't just say "this could be better" — say what to change and why.
