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

## Submitting Pull Requests

1. **Branch Naming**: Use descriptive branch names like `feat/team-review-toggle` or `fix/graphql-null-check`.
2. **Test Coverage**: When adding features or fixing bugs, add corresponding unit tests in `tests/`.
3. **Check Build**: Ensure `make test` and `make lint` run cleanly without errors.
4. **Commit Messages**: Ensure all commits follow the Conventional Commits specification.
5. **PR Description**: Clearly describe what changes were made, why they are needed, and how they were tested.
