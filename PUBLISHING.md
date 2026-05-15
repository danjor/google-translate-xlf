# Publishing to npm

This guide explains how to publish a new version of `xlf-translate-auto` to the npm registry.

## Prerequisites

1.  **npm account**: You must have an account on [npmjs.com](https://www.npmjs.com/).
2.  **Permissions**: You must be an owner or have publishing permissions for the `xlf-translate-auto` package.
3.  **Clean state**: Ensure all your changes are committed and your working directory is clean.

## Publishing Steps

### 1. Run Tests

Before publishing, always ensure that all tests pass:

```bash
npm test
```

### 2. Increment Version

Use `npm version` to increment the version number in `package.json`. This command also creates a git commit and a tag for the new version.

- For a patch release (e.g., 1.1.1 -> 1.1.2):
  ```bash
  npm version patch
  ```
- For a minor release (e.g., 1.1.1 -> 1.2.0):
  ```bash
  npm version minor
  ```
- For a major release (e.g., 1.1.1 -> 2.0.0):
  ```bash
  npm version major
  ```

### 3. Publish to npm

Log in to your npm account if you haven't already:

```bash
npm login
```

Then, publish the package:

```bash
npm publish
```

### 4. Push to GitHub

Push the new commit and the newly created tag to GitHub:

```bash
git push origin master --tags
```

*(Note: Replace `master` with your default branch name if it's different, e.g., `main`.)*

## Summary Checklist

- [ ] Tests passed (`npm test`)
- [ ] Version incremented (`npm version <type>`)
- [ ] Published to npm (`npm publish`)
- [ ] Pushed to GitHub (`git push --tags`)
