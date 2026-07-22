# Security policy

## Reporting a vulnerability

Do not disclose vulnerabilities, private Site URLs, account emails, credentials, tokens, authorization codes, cookies, or captured content in a public issue.

Use GitHub's private vulnerability reporting feature for this repository. Include the affected revision, impact, reproduction steps, and a minimal proof of concept with all secrets and personal data removed.

## Supported version

Security fixes are applied to the latest release on the default branch.

## Deployment responsibilities

Each deployment is privately owned. Keep `OWNER_EMAIL` and `GEMINI_API_KEY` in OpenAI Sites server-side Secrets, revoke lost capture or agent keys from the Site UI, and remove unused OAuth connections. Never commit `.env*`, `.dev.vars*`, local configuration, or a populated deployment identifier copied from another owner.
