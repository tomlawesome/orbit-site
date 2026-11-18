# Secret-scan fixture for the translated-docs layout (#145)

`de-security.json` is a translated docs page in the layout where each section
carries its English fingerprint itself, as its first field (`"en"`, 16 lower-case
hex), instead of a table in `source.sections` keyed by section id.

A name ending in `key` beside a 16-hex value is the shape gitleaks' generic-api-key
rule looks for. This page has such an id (`rotating-the-document-key-encryption-key`)
next to a realistic random-looking `en`; the `scan:gitleaks` job (which reads git
history, so any committed file) must find nothing in it. Both values are random and secret-free. Do not edit them to
look like credentials; `tools/ci/translate-shape-test.mjs` (T48) keeps the file in
the new layout.
