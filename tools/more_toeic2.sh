#!/bin/sh
cd "$(dirname "$0")/.."
m() { python3 -I tools/curate_images.py more "$@"; }
m cooperation "Category:Cooperation" "people helping each other carry"
m pressure "Category:Occupational stress" "stressed businessman head in hands"
m efficiency "fast assembly workers factory line" "Category:Productivity"
m conflict "Category:Arguments" "two people arguing quarrel"
m commute "Category:Commuters" "rush hour commuters train station"
