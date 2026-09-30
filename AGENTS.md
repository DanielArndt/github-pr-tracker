# AI Agent Guidelines & Rules

This document specifies mandatory rules and operational guidelines for all AI coding agents working in this repository.

---

## 1. Git Commit Message Standards (MANDATORY)

**Always use the [Conventional Commits](https://www.conventionalcommits.org/) specification for all git commit messages.**

### Commit Format

```text
<type>(<optional scope>): <description>

[optional body]

[optional footer(s)]
```

### Commit Types

- `feat`: A new feature or capability.
- `fix`: A bug fix.
- `docs`: Documentation changes only.
- `style`: Formatting, whitespace, semicolon changes (no code behavior change).
- `refactor`: Code changes that neither fix a bug nor add a feature.
- `perf`: Performance improvements.
- `test`: Adding, updating, or refactoring tests.
- `build`: Changes affecting build system, Makefile, schemas, dependencies.
- `ci`: Changes to CI/CD pipelines and scripts.
- `chore`: Maintenance tasks, repo tooling, configurations.

### Commit Rules

- **Imperative mood**: Write descriptions in the imperative (e.g., `feat: add toggle option`, NOT `feat: added toggle option` or `feat: adds toggle option`).
- **Lowercase**: Start the description with a lowercase letter.
- **No ending period**: Do not end the description line with a period.
- **Concise**: Keep the first line under 72 characters.
- **Optional scopes**: Use relevant scopes when applicable: `(prefs)`, `(classifier)`, `(graphql)`, `(menu)`, `(indicator)`, `(auth)`, `(schemas)`.
- Refer to [CONTRIBUTIONS.md](CONTRIBUTIONS.md) for full details and examples.

---

## 2. Testing & Verification

- Before committing or finishing any code modification, always verify existing and new tests pass and the code lints cleanly by running:
  ```bash
  make test
  make lint   # after `npm ci` once
  ```
- If introducing new logic or fixing bugs, ensure corresponding test coverage is added in `tests/`.

---

## 3. Code & Architecture Conventions

- **Platform**: GNOME Shell extension targeted at GNOME Shell 45–50+ using GJS and ES Modules.
- **Libraries**:
  - `Soup 3.0` for networking (GraphQL API calls).
  - `Secret 1` for credential storage (keyring).
  - `Gio`, `GLib`, `St`, `Clutter` for GNOME Shell UI and system interaction.
- **Security**: Never store tokens or sensitive credentials in plain text or GSettings. Always use the secret storage module (`src/api/keyring.js`).

---

## 4. GNOME Extension Best Practices (MANDATORY)

All code written or modified in this repository must strictly follow the upstream **[GNOME Extension Best Practices](https://gjs.guide/extensions/review-guidelines/best-practices.html)** and **[EGO Review Guidelines](https://gjs.guide/extensions/review-guidelines/review-guidelines.html)**. Refer to [CONTRIBUTIONS.md](CONTRIBUTIONS.md) for full details.

Mandatory rules:
- **No redundant `try-catch`**: Do not wrap standard operations (`destroy()`, `connect()`, `disconnect()`, `abort()`, `GLib.Source.remove()`) in `try-catch` blocks when they do not throw errors in normal execution.
- **No defensive checks or polyfills**: Target GNOME Shell 45–50+ directly. Do not use optional chaining (`?.()`) or function type checks (`=== 'function'`) for guaranteed methods or standard platform APIs.
- **Resource ownership & lifecycle**: Every class must manage and clean up its own resources (timeouts, signals, Soup sessions, `Gio.Cancellable`). Never use boolean flags like `this._destroyed` to guard against race conditions. In custom `destroy()`, follow the exact order: remove GLib sources, disconnect signals, release child references, and call `super.destroy()` last.
- **Timeout & source hygiene**: Always remove any existing GLib source directly adjacent to and before creating a new one (`if (this._sourceId) { GLib.Source.remove(this._sourceId); this._sourceId = null; }`).
- **Process isolation**: Strictly separate shell and preferences code. Shared utility modules imported by both `extension.js` and `prefs.js` must NEVER import `St`, `Clutter`, `Gtk`, `Gdk`, or `Adw`.
- **Minimal entry point & modularity**: Keep `extension.js` minimal and delegate logic to modular single-responsibility files. Place `enable()` and `disable()` next to each other.
- **UI standards**: Use `St.Icon` (or `icon_name`) for shell UI and `Gtk.Image` for preferences. Never use Unicode emojis as icons. Use `ui.BarLevel` or `St.Bin` rather than ASCII progress strings.
- **Settings schema**: Rely on `"settings-schema"` in `metadata.json` and call `this.getSettings()` without repeating schema IDs.
- **Code completeness & comments**: Never submit incomplete code or placeholder stubs. Write self-explanatory code with clear naming and avoid redundant line-by-line explanatory comments.
