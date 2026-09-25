# GitHub PR Tracker (GNOME Shell Extension)

A GNOME Shell extension (compatible with GNOME Shell 45–50+) that tracks pull requests for your GitHub account using the GitHub GraphQL API, organizing them into clear actionable categories with precise status reason badges.

---

## Features

- **Categorized PR Sections**:
  - ⚠️ **Action Required**: Pull requests authored by you that need your attention:
    - Reviewers requested changes (`CHANGES_REQUESTED`)
    - Failing required CI checks (`isRequired === true` & failed)
    - Merge conflicts with the target branch
    - Unresolved review comments/threads
  - 💬 **Needs My Review**: Pull requests from others where:
    - Review was requested directly from you
    - You previously reviewed and the PR is awaiting follow-up / author re-request
  - ✓ **Ready to Merge**: Approved pull requests authored by you with passing required CI checks and no conflicts.
  - ⏳ **Waiting on Review**: Open, non-draft pull requests authored by you that are awaiting review from others.
  - 📝 **Draft PRs**: Your open draft pull requests.
- **Informative PR Cards**:
  - Displays Repository (`owner/repo`), PR number (`#123`), Title, Author, and time elapsed.
  - Displays 1–2 word reason pills (e.g. `Changes Requested`, `CI Failed`, `Conflicts`, `Unresolved Comments`) with support for multiple simultaneous reasons.
  - Clicking any pull request directly opens it in your default web browser.
- **GNOME Shell Design Compliant**:
  - Top bar panel indicator uses theme-neutral, non-distracting monochrome pill badges (`⚠️ 2`, `💬 3`, `✓ 1`) matching GNOME Shell aesthetics.
  - Automatically hides badges when counts are zero, displaying only the subtle GitHub icon.
- **Secure Credential Storage**:
  - GitHub Personal Access Tokens are stored securely in your system keyring using `libsecret` (Secret Service API), never in plain text configuration files.
- **Customizable Filtering**:
  - Include/exclude repositories using glob patterns (e.g. `canonical/*`, `owner/repo`).
  - Toggle ignoring archived repositories and repository forks.
- **Configurable Polling**:
  - Background polling interval configurable between 1 and 60 minutes (default 5 minutes).
  - Manual "Refresh now" button in the menu footer.

---

## Installation

### Prerequisites
- GNOME Shell 45, 46, 47, 48, 49, or 50
- `gjs` (1.80+)
- `libsecret-1` (GNOME Keyring)
- `libsoup-3.0`

### Building & Installing

Clone the repository and run:

```bash
make install
```

This compiles GSettings schemas, packages the extension, installs it to `~/.local/share/gnome-shell/extensions/github-pr-tracker@dan.arndt.ca`, and compiles schemas in place.

After installing for the first time, log out and log back in (or on X11 press `Alt+F2`, type `r`, and hit `Enter`) to let GNOME Shell register the new extension.

Then enable the extension:
```bash
gnome-extensions enable github-pr-tracker@dan.arndt.ca
```

---

## Setup & Configuration

1. Generate a GitHub Personal Access Token:
   - Go to [GitHub Settings → Developer Settings → Personal Access Tokens](https://github.com/settings/tokens).
   - Ensure the token has the `repo` scope (for private repositories) or `public_repo` (for public-only repositories) and `read:org`.
2. Open extension preferences:
   ```bash
   gnome-extensions prefs github-pr-tracker@dan.arndt.ca
   ```
   (Or click the gear icon in the extension's dropdown menu footer).
3. Paste your token into the **Personal Access Token** field and click **Save**.
4. Click **Test Connection** to verify that your account is detected and authenticated.

---

## Development & Testing

Run unit tests covering classification, reason calculations, filtering, and preferences:

```bash
make test
```

Clean build artifacts:

```bash
make clean
```

---

## License

Copyright (C) 2026 Daniel Arndt

This program is free software: you can redistribute it and/or modify it under the terms of the GNU General Public License as published by the Free Software Foundation, either version 2 of the License, or (at your option) any later version. See [LICENSE](LICENSE) for the full text.
