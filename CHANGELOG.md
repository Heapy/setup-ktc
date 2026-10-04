# Changelog

## Unreleased

- Cache Kotlin/Native data by default, respecting `KONAN_DATA_DIR` and the existing
  restore-only policy. Disable it with `cache-konan: false` or `cache: false`.

## 1.0.1

License changed to Apache-2.0. Earlier MIT releases remain unchanged.

## 1.0.0

Initial release: verified version selection, Windows/macOS/Linux installation,
branch-aware cache reuse, restore-only PR defaults, and cache round-trip CI.
