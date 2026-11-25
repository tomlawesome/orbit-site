# Release YYYY-MM-DD

Copy this file to `docs/releases/YYYY-MM-DD.md` (`YYYY-MM-DD-N.md` for a second release on
one day) and fill it in. Steps are in `docs/releasing.md`. Every step has exactly one line
in the form shown; the text after the second colon must not be empty.

The blob id of the guide this record was written from:
`git rev-parse HEAD:docs/releasing.md`

guide-blob: <blob id>

A line says one of three things: `done: <evidence>`, `not needed: <owner decision>` or
`after merge: <what is to be done>`.

step 1: done: <evidence>
step 2: done: <evidence>
step 3: not needed: <owner decision>
step 4: done: <evidence>
step 5: done: <evidence>
step 6: after merge: <what>
step 7: after merge: <what>
step 8: after merge: <what>
step 9: not needed: <owner decision>

Commit the record with `git commit --trailer "Signed-off-by: <your name>"`; the name below
must be the author of the last commit that touched this file.

Signed-off-by: <your name>
