# 🛠 Development Guide

Welcome! This document provides instructions for contributing to the project. It covers setup, development workflows, testing, linting, formatting, and more.

---

## 📦 Prerequisites

This project uses [pnpm](https://pnpm.io/) as its package manager.

Enable and install `pnpm` via [Corepack](https://nodejs.org/api/corepack.html):

```bash
corepack enable pnpm
pnpm install
```

---

## 🚀 Development

Start all packages (tests, examples, and xstate) in development mode:

```bash
pnpm dev
```

---

## 🧪 Testing

Run all tests once:

```bash
pnpm test
```

Watch tests during development:

```bash
pnpm test:watch
```

---

## 🏗 Building

Compile all packages:

```bash
pnpm build
```

---

## ✅ Verify All

Run all checks (formatting, build, tests, lint):

```bash
pnpm verify
```

---

## ✨ Linting & Formatting

Lint all packages:

```bash
pnpm lint
```

Format code:

```bash
pnpm format
```

Check formatting:

```bash
pnpm format-check
```

---

## 📦 Changesets (Release Management)

This project uses [Changesets](https://github.com/changesets/changesets) for versioning and changelogs.

To create a new changeset (ideally in any PR):

```bash
pnpm changeset
```

Follow the interactive prompt to describe your changes.

To create a new release:

```bash
pnpm changeset version
```

and raise a PR. The new package will be automatically published after merge.

---

## 🧪 Running Examples

To run the `examples` package in dev mode:

```bash
pnpm examples
```

---

## 🧭 Notes

- This is a monorepo managed by `pnpm workspaces`.
- Shared scripts are run recursively using `pnpm -r`.
- For focused work, use filters:
  ```bash
  pnpm --filter <package-name> <command>
  ```
