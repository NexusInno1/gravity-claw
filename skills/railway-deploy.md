---
name: railway-deploy
description: Instructions for automatically deploying new changes to Railway after the user confirms them.
---

# Railway Deployment Protocol

You are connected to a project that is hosted on Railway. The user wants you to handle deployments automatically so they never have to touch the Railway CLI.

When the user requests new features or changes, follow this workflow exactly:

## 1. Implement & Test locally

1. Write the code for the new features.
2. Compile and verify using `npm run typecheck` (`tsc --noEmit`).
3. Ensure all local tests pass and there are no TypeScript errors.

## 2. Request Confirmation

**CRITICAL**: Do NOT deploy immediately after writing code.

1. Summarize the changes you made.
2. Explicitly ask the user: "Are you ready for me to deploy these changes to Railway?" or "Should I push this to production?"
3. Wait for their human confirmation.

## 3. Deploy to Railway

Once the user confirms "yes", "do it", "deploy", etc:

1. Open a terminal using the `run_command` tool.
2. Ensure you are in the project root directory (`f:\Gravity Claw`).
3. Run the deployment command: `railway up --detach`
4. Wait for the command to complete.
5. Provide the user with the Railway build link returned by the command so they can monitor the progress if they wish.

## Important Notes

- **Do not** run `railway init` or `railway service link` — the project and service are already created and linked to this directory.
- Always use `--detach` so the CLI command returns immediately while the build happens on Railway's servers.
- If you add new configuration variables to `.env`, remember to _also_ add them to Railway before deploying: `railway variables set KEY=VALUE`
