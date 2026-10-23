# claude-craft

A Claude Code plugin marketplace with one plugin, `craft`.

`craft` carries authored skills, a plain answering style, and a hooks module that guards
shell commands and file edits. See the plugin's own README for the list.

## Layout

```
.claude-plugin/marketplace.json   the catalog
plugins/craft/                    the plugin — see its own README
```

## Try it without installing

```bash
git clone https://github.com/Apna-Mart/claude-craft.git
claude --plugin-dir claude-craft/plugins/craft
```

## Install it

```bash
claude plugin marketplace add Apna-Mart/claude-craft
claude plugin install craft@apna-mart
```

Or from inside a session:

```bash
/plugin marketplace add Apna-Mart/claude-craft
/plugin install craft@apna-mart
```

## Get the most out of craft

Add this to `~/.claude/CLAUDE.md`:

```markdown
- Load the matching `craft:` skills before the first edit. Any code loads `craft:coding-best-practices`; a bug fix also loads `craft:testing-best-practices` first.
- Load `craft:minimize-diff` only when I name it.
- Branches: `<type>/<scope>-<description>`, lowercase, at most 50 characters. Commits: `<type>(<scope>): <description>`.
- Before the first edit, write `Done when: <result> — checked by: <check>`, and run that check before saying done.
```

## Tests

```bash
claude plugin test plugins/craft
```
