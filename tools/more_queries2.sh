#!/bin/sh
cd "$(dirname "$0")/.."
m() { python3 -I tools/curate_images.py more "$@"; }
m trust "trust fall exercise" "father holding baby hands"
m anxiety "anxious woman" "stressed student exam"
m failure "disappointed football player" "sad athlete losing"
m honesty "lost wallet returned" "lost and found box"
m paint "house painter painting wall roller" "girl painting picture watercolor" "man painting fence"
m angry "man shouting angry expression" "angry boy face" "furious woman"
m scared "scared woman unsplash" "fear face child hiding eyes" "frightened child"
m worried "worried woman unsplash" "worried face hand on forehead" "pensive worried man"
m confused "confused woman unsplash" "confused face question" "puzzled man"
m grateful "thankful woman hands heart" "receiving gift happy elderly" "gratitude thank you hug"
