#!/bin/sh
cd "$(dirname "$0")/.."
m() { python3 -I tools/curate_images.py more "$@"; }
m angry "Category:Anger" "Category:Angry people"
m scared "Category:Fear" "Category:Frightened people"
m worried "Category:Worry" "Category:Sad people"
m confused "Category:Confusion" "Category:Thinking"
m grateful "Category:Gratitude" "Category:Hugging"
m trust "Category:Trust" "Category:Trust falls"
m anxiety "Category:Anxiety" "Category:Stress (psychological)"
m neighbor "Category:Neighbors" "Category:Neighborhood parties"
m husband "Category:Married couples" "Category:Couples (people)"
m wife "Category:Elderly couples" "Category:Married couples"
m paint "Category:People painting" "Category:Children painting" "Category:House painters"
