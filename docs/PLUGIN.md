# Bookmark Site Codex plugin

The repo includes a Codex plugin that provides a safe, repeatable connection workflow and starter prompts.

## Install from GitHub

1. Add this repository as a marketplace source:

   ```bash
   codex plugin marketplace add madebypan/chatgpt-bookmark-site
   ```

2. Restart the ChatGPT desktop app.
3. Open **Plugins**, select the **ChatGPT Bookmark Site** source, and install **Bookmark Site**.
4. Start a new Codex task and choose **Connect or update my private Bookmark Site**.
5. Provide only the public Site URL. The skill verifies OAuth metadata, registers `<site-origin>/mcp`, and starts `codex mcp login` with the `knowledge:read` scope.
6. Finish ChatGPT sign-in and approval in the browser. Never paste a token, code, cookie, API key, or owner email into the task.
7. Start one more task so the new MCP tools load, then ask: **Show the latest items in my Bookmark Site.**

## Why the MCP URL is not bundled

Each installation points to a different private Site. Embedding one deployment URL in a public plugin would either leak an owner's hostname or send every user to the wrong server. The plugin therefore bundles the connection skill; the skill creates a per-user remote MCP entry with Codex's built-in OAuth credential store.

## Remove the connection

```bash
codex mcp logout bookmark-site
codex mcp remove bookmark-site
```

Removing the plugin does not silently delete a separately authorized MCP connection. Remove both when you no longer want Codex to access the Site.
