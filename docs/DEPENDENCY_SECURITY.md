# Dependency security notes

## @tkomde/iohook

The project pins `@tkomde/iohook` to exactly `1.1.7` in `package.json`, `package-lock.json`, and npm `overrides`.

The package tarball is fetched from npm with integrity verification, but its install script can download native prebuilds from GitHub Releases. To prevent automatic native binary downloads or install-time updates, `.npmrc` sets:

```ini
ignore-scripts=true
```

Do not run install commands with `--ignore-scripts=false` unless you intentionally want npm lifecycle scripts to execute.
