# Releasing Boba Tiger Hours Tracker

This guide explains how to build and release new versions of the Boba Tiger Hours Tracker app.

**Quick overview:** Version 1.0.0 will be built locally. From version 1.0.1 onward, releases are automated via GitHub—just bump the version, commit, create a git tag, and push it.

---

## Part 1: Create the GitHub Repository

The app needs a home on GitHub for auto-updates to work. This is a one-time setup.

1. Go to https://github.com/new
2. Fill in the repository name as exactly: `boba-tiger-hours-tracker`
3. Set visibility to **Public** (source code is visible, but the app is local-only and stores no client data online)
4. Do **NOT** check any of these boxes:
   - "Add a README file"
   - "Add .gitignore"
   - "Choose a license"
   
   (The project already has all three locally; GitHub's defaults would conflict.)

5. Click the green **Create repository** button at the bottom.

Done. You now have an empty GitHub repo waiting for your code.

---

## Part 2: Connect Your Local Project to GitHub

Run these commands in your project folder (e.g., `C:\Users\abhis\Desktop\boba-tiger-hours-tracker\boba-tiger-hours-tracker`):

1. Add GitHub as the remote:
   ```
   git remote add origin https://github.com/YOUR_USERNAME/boba-tiger-hours-tracker.git
   ```
   Replace `YOUR_USERNAME` with your GitHub username.

2. Rename your branch to `main` (GitHub's default):
   ```
   git branch -M main
   ```

3. Push all your commits to GitHub:
   ```
   git push -u origin main
   ```

Your code is now on GitHub.

---

## Part 3: Enable Auto-Updates (Required)

The app looks for updates from GitHub, but it needs to know which repository to check. This is a one-time configuration.

1. Open `package.json` in a text editor.

2. Find the `"build"` section, then look for `"publish"`:
   ```json
   "publish": {
     "provider": "github",
     "owner": "REPLACE_WITH_YOUR_GITHUB_USERNAME",
     "repo": "boba-tiger-hours-tracker"
   }
   ```

3. Replace `REPLACE_WITH_YOUR_GITHUB_USERNAME` with your actual GitHub username. For example, if your GitHub username is `JohnDoe`, it should look like:
   ```json
   "publish": {
     "provider": "github",
     "owner": "JohnDoe",
     "repo": "boba-tiger-hours-tracker"
   }
   ```

4. Save the file, then commit and push:
   ```
   git add package.json
   git commit -m "Set GitHub publish owner for auto-updates"
   git push
   ```

**Why this matters:** If you skip this step, the installed app will never find updates—it will be looking for updates in a repository that doesn't exist.

---

## Part 4: Releasing Version 1.0.0 (Tomorrow)

Version 1.0.0 is released **locally** (not through GitHub Actions) because the repository is brand new.

1. Open a terminal in the project folder.

2. Build the Windows installer:
   ```
   npm run dist
   ```
   This creates a `.exe` installer file inside the `release/` folder (e.g., `release/Boba Tiger Hours Tracker 1.0.0.exe`).

3. Send the `.exe` file to your client:
   - Email it directly, or
   - Put it on a USB drive, or
   - Use any other method you prefer.

4. Direct your client to read `docs/CLIENT_INSTALL_GUIDE.md`—it explains the Windows SmartScreen warning they'll see (the app is unsigned, which is normal for small apps).

**That's it.** Version 1.0.0 is live. GitHub Actions takes over starting with version 1.0.1.

---

## Part 5: Releasing Future Versions (1.0.1 and Later)

Once version 1.0.0 is installed, all future releases are automated. Here's the process:

### 5.1 Make Your Code Changes

Write your code changes and commit them as normal:
```
git add .
git commit -m "Your commit message here"
git push
```

### 5.2 Bump the Version Number

1. Open `package.json`.
2. Find the `"version"` field (currently `"1.0.0"`).
3. Bump it according to semantic versioning:
   - **Patch** (bug fixes): `1.0.1`, `1.0.2`, etc.
   - **Minor** (new features): `1.1.0`
   - **Major** (breaking changes): `2.0.0`
   
   For example, if you've added a new feature, change `"1.0.0"` to `"1.1.0"`.

4. Save the file and commit:
   ```
   git commit -am "Bump version to 1.1.0"
   ```

### 5.3 Create a Git Tag and Push It

The tag name **must** start with a lowercase `v` followed by the version number. This triggers the automated release.

```
git tag v1.1.0
git push origin v1.1.0
```

**That's it.** GitHub Actions automatically:
- Builds the Windows installer on GitHub's servers
- Creates a new Release on your GitHub repository
- Makes the installer available for download

### 5.4 Monitor the Build (Optional)

1. Go to your GitHub repository on the web.
2. Click the **Actions** tab.
3. You'll see a workflow run named after your tag (e.g., "Release v1.1.0").
4. The build typically takes 5–10 minutes. Once it's green (✓), the release is live.

### 5.5 Existing Installations Get Notified

Every copy of the app installed by your client will automatically check for updates (typically a few seconds after it launches, or when they click Help → Check for Updates). They'll be prompted to download and install the new version.

---

## Part 6: Quick Reference & Troubleshooting

### I forgot to bump the version before tagging

Don't worry, just delete the tag and try again:

```
git tag -d v1.1.0                 # Delete the tag locally
git push origin --delete v1.1.0   # Delete it on GitHub
```

Then:
1. Edit `package.json` and set the correct version.
2. Commit it: `git commit -am "Bump version to 1.1.0"`
3. Push: `git push`
4. Create the tag: `git tag v1.1.0`
5. Push the tag: `git push origin v1.1.0`

### I skipped Part 3 (auto-updates config)

The installed app will never find updates. Here's the fix:

1. Edit `package.json` and replace `REPLACE_WITH_YOUR_GITHUB_USERNAME` with your GitHub username.
2. Commit and push: `git commit -am "Fix GitHub username for updates"` then `git push`
3. Create and push a new release tag (e.g., `v1.0.1`) as described in Part 5.
4. Future versions will update correctly. (Users with v1.0.0 will need to manually update once with the installer.)

### The GitHub Actions build failed

1. Go to your GitHub repository → **Actions** tab.
2. Click on the failed workflow run.
3. Click **Build and publish release** step to see the error log.
4. Common issues:
   - The `package.json` version doesn't match the tag name (e.g., tag is `v1.1.0` but `package.json` says `1.0.9`). Fix this, delete the tag, and try again.
   - A typo in the GitHub username in `package.json`. Fix it, commit, push, then re-run the release.

### My client got a SmartScreen warning

That's expected—see `docs/CLIENT_INSTALL_GUIDE.md` for an explanation and reassurance text to give them. It's because the app is unsigned (requires a code-signing certificate from Microsoft, which costs money).

---

## Summary

- **v1.0.0:** Built locally with `npm run dist`, sent to the client manually.
- **v1.0.1+:** Bump version → Commit → Create git tag → Push tag → Automated build on GitHub → Auto-update available.

Questions? Check this file or the GitHub Actions workflow logs.
