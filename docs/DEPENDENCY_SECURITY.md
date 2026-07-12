# Dependency security notes

## Global input capture

macOS input capture is implemented by the repository-owned `window-addon` native module using read-only Core Graphics event taps. The application no longer installs or loads `@tkomde/iohook` or `iohook-macos` at runtime.

The addon is built locally from `packages/main/src/native-addon/window-addon.cpp`; no native input package is downloaded during application startup.

The package tarball is fetched from npm with integrity verification, but its install script can download native prebuilds from GitHub Releases. To prevent automatic native binary downloads or install-time updates, `.npmrc` sets:

```ini
ignore-scripts=true
```

Do not run install commands with `--ignore-scripts=false` unless you intentionally want npm lifecycle scripts to execute.
