#!/bin/sh
set -eu
freshclam || true
exec node server.mjs

