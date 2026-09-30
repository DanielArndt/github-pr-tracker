# Contributing to GitHub PR Tracker

Thank you for your interest in contributing to GitHub PR Tracker! We welcome contributions, bug fixes, feature suggestions, and documentation improvements.

---

## Commit Message Guidelines

This project strictly follows the **[Conventional Commits](https://www.conventionalcommits.org/)** specification (v1.0.0).
All commit messages—whether authored by human contributors or automated agents—must adhere to this format.

### Commit Format

```text
<type>(<optional scope>): <description>

[optional body]

[optional footer(s)]
```

### Commit Types

| Type | Description |
| :--- | :--- |
| `feat` | A new feature or user-facing functionality |
| `fix` | A bug fix |
| `docs` | Documentation-only changes (README, CONTRIBUTIONS, code comments) |
| `style` | Code formatting, missing semicolons, whitespace (no functional changes) |
| `refactor` | Code restructuring that neither fixes a bug nor adds a feature |
| `perf` | Performance improvements |
| `test` | Adding or updating tests (`tests/`, classifier tests, mock fixtures) |
| `build` | Build system, Makefile, schema compilation, packaging changes |
| `ci` | Continuous integration and deployment configuration |
| `chore` | Routine tasks, dependency updates, repo maintenance |

### Commit Rules

1. **Imperative Mood**: Use the imperative mood in the subject line (e.g., `add toggle option`, not `added toggle option` or `adds toggle option`).
2. **Case**: Start the description with a lowercase letter.
3. **No Trailing Period**: Do not end the subject line with a period or punctuation.
4. **Length**: Keep the subject line concise (under 72 characters).
5. **Scopes**: Use optional scopes to indicate the modified component when applicable, such as:
   - `(prefs)`: Extension preferences and settings dialog (`prefs.js`, schemas)
   - `(classifier)`: PR categorization and status logic (`src/models/prItem.js`)
   - `(graphql)`: GitHub GraphQL client and queries (`src/api/githubClient.js`)
   - `(menu)`: Popup menu and UI cards (`src/ui/menuView.js`)
   - `(indicator)`: Top panel indicator and badges (`src/ui/indicator.js`)
   - `(auth)`: Keyring and authentication handling (`src/api/keyring.js`)
6. **Breaking Changes**: Mark breaking changes by appending a `!` before the colon (e.g. `feat(api)!: migrate to GraphQL v5 API`) or including `BREAKING CHANGE:` in the footer.

### Examples

- `feat: add toggle option for including team review requests (default: off)`
- `fix(graphql): handle null values when fetching branch protection status checks`
- `refactor(classifier): streamline status reason pill computation`
- `test(classifier): add unit tests for team review classification`
- `docs: add CONTRIBUTIONS.md and AGENTS.md guidelines`

---

## Development & Testing Workflow

### Prerequisites

- GNOME Shell (45–50+)
- `gjs` (1.80+)
- `libsecret-1` (GNOME Keyring)
- `libsoup-3.0`
- `make`

### Running Tests

Before submitting changes, make sure all test suites pass:

```bash
make test
```

The preferences test opens a GTK window, so it needs a graphical session; on a headless machine run `xvfb-run -a make test`.

### Linting

The code is checked with [ESLint](https://eslint.org/). Install it once with Node.js 20.19 or later, then run the linter:

```bash
npm ci
make lint
```

CI runs both `make lint` and `make test` on every pull request.

### Building & Local Installation

Install the extension into your local GNOME Shell environment for testing:

```bash
make install
```

To clean build artifacts:

```bash
make clean
```

---

## GNOME Extension Best Practices & Review Guidelines

All code in this repository must strictly adhere to the upstream **[GNOME Extension Best Practices](https://gjs.guide/extensions/review-guidelines/best-practices.html)** and the **[EGO Review Guidelines](https://gjs.guide/extensions/review-guidelines/review-guidelines.html)**. These standards ensure high code quality, prevent memory leaks, maintain process isolation, and facilitate extensions.gnome.org (EGO) reviews.

### 1. Maintainership & Code Completeness

- Every contribution must represent complete, fully functional, and tested logic—never submit incomplete code, placeholder stubs, or empty lifecycle methods.
- The project is maintained by JavaScript/GJS practitioners; code should be idiomatic modern ES Modules / GJS.

### 2. Lifecycle, Destruction & Resource Management

- **Strict Resource Ownership**: Every class must manage its own resources. If a class connects a GObject signal, creates a GLib timeout, allocates a `Soup.Session`, or instantiates a `Gio.Cancellable`, that same class must clean it up in its `destroy()` method. Avoid "spaghetti cleanup" where one class allocates and another cleans up.
- **No Destruction Flags**: Do not use boolean flags like `this._destroyed` or `this._enabled` to guard against race conditions or improper lifecycle calls. Once `destroy()` is called, the instance should be nulled out and never accessed again.
- **Destruction Order**: In custom `destroy()` methods, clean up in the following order:
  1. Remove active timeouts and GLib sources (`GLib.Source.remove()`).
  2. Disconnect all signal handlers.
  3. Release child references and resources.
  4. Call `super.destroy()` as the final step.

```javascript
// Correct destruction pattern
destroy() {
    if (this._sourceId) {
        GLib.Source.remove(this._sourceId);
        this._sourceId = null;
    }
    if (this._signalId && this._object) {
        this._object.disconnect(this._signalId);
        this._signalId = null;
    }
    if (this._cancellable) {
        this._cancellable.cancel();
        this._cancellable = null;
    }
    this._childComponent?.destroy();
    this._childComponent = null;

    super.destroy();
}
```

### 3. GLib Source & Timeout Hygiene

- Always remove any existing GLib source/timer before creating a new one, and place the removal check directly next to the creation call.
- Reset the stored source ID to `null` immediately upon removal or when the source callback returns `GLib.SOURCE_REMOVE`.

```javascript
// Bad: Source removal separated from creation or omitted
this._sourceId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 5, () => { ... });

// Correct: Source removed immediately before creation
if (this._sourceId) {
    GLib.Source.remove(this._sourceId);
    this._sourceId = null;
}
this._sourceId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 5, () => {
    // ...
    return GLib.SOURCE_CONTINUE;
});
```

### 4. Avoid Unnecessary `try-catch` Wrappers

- Do not wrap standard operations in `try-catch` blocks if they never throw unhandled exceptions during normal execution.
- Standard methods such as `destroy()`, `connect()`, `disconnect()`, `abort()`, and `GLib.Source.remove()` do not throw errors when used properly.

```javascript
// Bad
if (this._sourceId) {
    try {
        GLib.Source.remove(this._sourceId);
    } catch (e) {
    }
    this._sourceId = null;
}

// Correct
if (this._sourceId) {
    GLib.Source.remove(this._sourceId);
    this._sourceId = null;
}
```

### 5. Avoid Defensive Polyfilling & Unnecessary Checks

- Target the supported GNOME Shell versions (45–50+) cleanly.
- Do not use optional chaining (`?.()`) or function type checks (`typeof this.method === 'function'`) for guaranteed methods or built-in standard APIs.

```javascript
// Bad: Redundant defensive check for guaranteed method
if (typeof this.updateUI === 'function') {
    this.updateUI();
}

// Correct
this.updateUI();
```

### 6. Process Isolation

GNOME Shell extensions run across two distinct process environments:
- **Shell Process** (`extension.js` and `src/ui/`): Runs inside the GNOME Shell compositor process with access to `St`, `Clutter`, `Meta`, and `Shell`.
- **Preferences Process** (`prefs.js`): Runs as an out-of-process GTK4 application with access to `Gtk` and `Adw`.

**Rules:**
- Shared utility modules (such as `src/models/`, `src/api/`, `src/utils/`) imported by both processes must **never** import `St`, `Clutter`, `Gtk`, `Gdk`, or `Adw`.
- Keep modules cleanly segregated by directory (e.g., `src/ui/` for Shell UI, `prefs.js` for preferences).

### 7. Modular Architecture & Minimal Entry Points

- **Minimal Entry Point**: Keep `extension.js` minimal. Delegate domain logic, UI creation, and API communication to modular classes under `src/`.
- **Adjacent Lifecycle Methods**: Keep `enable()` and `disable()` methods next to each other in the extension entry point class so that reviewers can easily verify symmetry of initialization and teardown.
- **Settings Schema ID**: Define `settings-schema` in `metadata.json` and call `this.getSettings()` in the entry point without passing hardcoded schema IDs.

### 8. UI Elements & Progress Display

- **Icons**: Use `St.Icon` (or `icon_name`) for GNOME Shell UI and `Gtk.Image` for preferences. Never use Unicode emojis as UI icons.
- **Progress**: Use standard Shell UI components (such as `ui.BarLevel` or custom `St.Bin` widgets) rather than ASCII art progress bars (e.g. `█░░`).

### 9. Subprocesses & D-Bus Communication

- Avoid spawning external shell processes where native GJS/GLib/Gio APIs exist.
- Use asynchronous Gio APIs or D-Bus for communicating with system services or external background processes to avoid blocking the Shell main loop.

### 10. Code Style, Comments & Formatting

- **Self-Documenting Code**: Use clear, descriptive variable and function names. Avoid redundant comments that explain basic JavaScript syntax or narrate code line-by-line.
- **Line Length**: Keep line lengths reasonable (under 200 characters) to avoid horizontal scrolling in EGO review tools.
- **Code Duplication**: Extract common logic into modular helper functions rather than duplicating code blocks.

---

## Submitting Pull Requests

1. **Branch Naming**: Use descriptive branch names like `feat/team-review-toggle` or `fix/graphql-null-check`.
2. **Best Practices**: Ensure all code complies with the [GNOME Extension Best Practices](#gnome-extension-best-practices--review-guidelines).
3. **Test Coverage**: When adding features or fixing bugs, add corresponding unit tests in `tests/`.
4. **Check Build**: Ensure `make test` and `make lint` run cleanly without errors.
5. **Commit Messages**: Ensure all commits follow the Conventional Commits specification.
6. **PR Description**: Clearly describe what changes were made, why they are needed, and how they were tested.
