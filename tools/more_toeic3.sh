#!/bin/sh
cd "$(dirname "$0")/.."
m() { python3 -I tools/curate_images.py more "$@"; }
m poster "Category:Posters on walls" "posters on a wall street"
m toast "Category:Toasts (drinking)" "raising glasses toast wedding"
m prescription "Category:Medical prescriptions" "pharmacist prescription counter"
m deadline "Category:Wall clocks" "calendar marked date"
m catalogue "Category:Mail order catalogs" "product catalog pages"
m budget "Category:Calculators" "household budget calculator bills"
m loan "Category:Loan offices" "bank loan office counter"
m debt "Category:Bills (invoices)" "unpaid bills stack"
m agenda "Category:Agendas" "meeting agenda printed paper"
m conflict "Category:Quarrels" "argument between coworkers"
m efficiency "Category:Assembly lines" "conveyor production line workers"
