---
name: connect-bookmark-site
description: Connect or reconnect Codex to a user's private Bookmark Site over its read-only Streamable HTTP MCP endpoint. Use when the user asks to install, connect, update, repair, or verify a Bookmark Site connection, or provides a Bookmark Site URL for Codex.
---

# Connect Bookmark Site

Connect the user's Codex installation directly to their own Site. Use OAuth; never request, copy, print, or store a Site token, authorization code, cookie, API key, or owner email.

## Connect

1. Obtain the user's Bookmark Site URL. Accept either its HTTPS origin or its `/mcp` URL. Do not ask again when it is already present in the task.
2. Normalize the endpoint:
   - Reject URLs containing a username, password, query, or fragment.
   - Require `https://`, except that loopback `http://localhost`, `127.0.0.1`, or `[::1]` is valid for local development.
   - Convert an origin URL to `<origin>/mcp`. Reject unrelated non-root paths.
3. Verify the deployment without credentials. Fetch `<origin>/.well-known/oauth-protected-resource` and require JSON whose `resource` equals the normalized MCP URL and whose authorization server is the same origin. A `401` from `/mcp` is expected before login.
4. Require the `codex` CLI. Inspect the existing entry with:

   ```bash
   codex mcp get bookmark-site --json
   ```

   If the entry already uses the normalized URL, keep it. If it points elsewhere, state the old and new origins and ask before replacing it because replacement clears that connection's stored OAuth session. After confirmation, run `codex mcp logout bookmark-site` and `codex mcp remove bookmark-site`; tolerate a missing login.
5. Add the remote server when needed:

   ```bash
   codex mcp add bookmark-site --url https://example.chatgpt.site/mcp
   ```

   Substitute only the verified endpoint; never use the example URL literally.
6. Start the OAuth flow:

   ```bash
   codex mcp login bookmark-site --scopes knowledge:read
   ```

   Pause while the user completes ChatGPT sign-in and approves access in the browser. Never ask them to paste anything back into the conversation.
7. Confirm `codex mcp get bookmark-site --json` shows the expected URL. Tell the user to start a new task so Codex loads the newly connected tools, then test with `list_recent_bookmarks`.

## Repair

- If discovery metadata is missing or mismatched, stop: the supplied URL is not a compatible Bookmark Site or its deployment is incomplete.
- If OAuth is denied, preserve the MCP entry and let the user retry `codex mcp login bookmark-site`; do not fall back to asking for a bearer token.
- If the MCP tools do not appear after successful login, start a new Codex task or restart the desktop app before changing configuration.
- Keep the server name `bookmark-site` stable so reconnecting updates one known entry instead of accumulating duplicates.

When shell execution is unavailable, give the exact `codex mcp add` and `codex mcp login` commands with the verified endpoint and stop. Do not claim the connection succeeded.
