#!/bin/sh
# Last retry for the words left without a photo (toast, agenda, loan, debt, poster, catalogue).
cd "$(dirname "$0")/.."
m() { python3 -I tools/curate_images.py more "$@"; }
m poster "posters on wall street" "Category:Posters in the streets" "bulletin board posters" "concert posters wall"
m toast "people clinking glasses" "Category:Clinking glasses" "raising glasses toast celebration" "champagne toast party"
m debt "National Debt Clock" "Category:National Debt Clock" "credit card bills debt"
m loan "loans sign shop" "payday loan store" "Category:Pawnshops" "bank loan office sign"
m catalogue "person reading catalog" "Category:Seed catalogs" "stack of catalogues" "library card catalogue"
m agenda "meeting agenda printed" "Category:Agendas" "conference programme printed" "written agenda whiteboard meeting"
