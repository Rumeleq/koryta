"""Apply facts_labeling_rules.md to all 100 GT facts (single-annotator pass).

Writes extraction_gt_reviewed.jsonl/.csv with human_label + gt_label (my
rulebook label) + rule + reason, and prints a confusion matrix and the change
list. Does NOT overwrite extraction_gt.jsonl.
"""

import collections
import csv
import json

# id -> (rulebook_label, reason). Reason cites the section that decided it.
J = {
    "0DktbqggLFYxjpLTASSD": ("insufficient", "subj 'Tomasz S.' not named in span (§2)"),
    "0NQgE2G26qttdumivIIj": ("correct", "name+role+org in span"),
    "27hRbkNTE10gJtzrlG5e": ("correct", "name+role+org in span"),
    "2HBZC8QCf1adENupY6CH": ("insufficient", "subj 'Emilia H.' not named in span ('żona Czarneckiego') (§2)"),
    "2WvIvrQws1VpdysGCv7a": ("correct", "name+role+org in span"),
    "3C7DQeCSEetfGAHnnOu3": ("correct", "name+role+org in span"),
    "4OkXT2lRrpnzytUAmynb": ("correct", "name+role in span, NABU expands to org"),
    "4QKMxBewmTcmwFwIxg2i": ("incorrect", "role 'leader' & org English; span is Polish 'CzSSD' (§1)"),
    "4f5kBx1zPq88dktLIkbt": ("correct", "name+role+org in span"),
    "4nErC3KGlx1XtzyHjhWz": ("correct", "name+role in span (org in truncated tail)"),
    "6g1G52TsBNxZRvx7A1GZ": ("correct", "name+role+org in span"),
    "7UxvjY15QxqiAClxXc35": ("correct", "name+role+org in span"),
    "8YknmhCUM0Lzykv9kXG9": ("insufficient", "subj 'Konrad R.' not named in span (§2)"),
    "8yeiVM9DRNa8uTony61a": ("correct", "name+role+org in span"),
    "9Ko2Plz1nyIWYcUr2pva": ("correct", "name+role in span; ULC in span"),
    "AzkSHSxMCiEH4Brn5nhq": ("correct", "'premier Mateusz Morawiecki' in span"),
    "BHAHtApCr3ne70gNylfA": ("correct", "name+role+ULC in span"),
    "BUyVuFPvCqh1BHpiAhNP": ("correct", "name+role+org in span"),
    "CfK20MXAoFNPtOjqOmMj": ("correct", "name+role; Collegium Humanum in span"),
    "Cgog5U3iQ1wYIj3yvDpn": ("incorrect", "org 'Federacja Rosyjska' not in span (only 'wicepremier'), ungrounded (§3)"),
    "EIEK5X1heetn7dx7Wq5B": ("insufficient", "subj 'Konrad R.' not named in span (§2)"),
    "Ef3XFTLVKVysJlr3BUCd": ("correct", "'wiceprzewodniczącą PE Ewę Kaili' in span"),
    "EqhJuqOj802qiFd49qE7": ("correct", "name+role+org in span"),
    "F7mZ1hQqjVgTgCJcmyeF": ("correct", "name+role+org in span"),
    "GJBHvOpZGPHUplIgR41m": ("correct", "name+role+org in span"),
    "GvzSm3EeSdbGS849HRaL": ("correct", "name+role+org in span"),
    "HFMUXyMKCOphjVWVJdUA": ("correct", "name+role+org in span"),
    "HKdEmCxBUsS4wcEyvY61": ("correct", "name+role+org in span"),
    "HWAaoCo2pLNhrxhZpC7I": ("correct", "name+role+org in span"),
    "IWjIpS42QiPcIUt59rC2": ("incorrect", "role 'szef grupy przestępczej' not in span; crime-group ≠ employment@Amica (§3)"),
    "J4BgENJsfhXef3SLpspK": ("incorrect", "org 'Federacja Rosyjska' not in span, ungrounded (§3)"),
    "KtebLfZna8tzjpvFgZmb": ("correct", "name+role+org in span"),
    "L5DbF5p03Y71hEPlcDrY": ("correct", "name+role; PSP=Straż Pożarna in span"),
    "M3EMTwodfSghI97BciKi": ("correct", "'wiceminister zdrowia Janusz Cieszyński' in span"),
    "N2UNHgwoGUK6XqVgKNct": ("correct", "name+role+org in span"),
    "N3J60fctsrEB24L5Q1BW": ("correct", "'prezes KGHM Marcin Chludziński' in span"),
    "Nl6sezKYhZ9qsvxbqtew": ("correct", "name+role+org in span"),
    "OyrUDLdg3cLBgGNZyw1W": ("correct", "name+role senator in span (org entailed)"),
    "PTPLMVOkE4tksRZEVSGT": ("correct", "name+role+Fundusz Sprawiedliwości in span"),
    "PlZAHojLhcBxU3Ful1Qj": ("correct", "'Michał G. (kanclerz CH)' in span"),
    "PxaucqNuHtoWQVTATZVU": ("correct", "name+role+org in span"),
    "0M0ud446UGZwh2GfsN5P": ("insufficient", "subj 'Konrad R.' not named in span (§2)"),
    "0Q0eFeDEB8RwZ8JYk5sp": ("correct", "name+role in span, org entailed by role (agreed)"),
    "4Dsl61cAgoggvVpD8wQa": ("correct", "name+role+org all in span & Polish; human 'incorrect' looks wrong"),
    "4Xlut9H4zCsuakVOEIKk": ("correct", "name+role+'biuro poselskie Jana Burego' in span"),
    "64RlKL0YJdE8zYZmkeuC": ("incorrect", "subj 'wiceprezes' is a role, not a name (§2)"),
    "8x4VTfmsoB2M8iMBbYqv": ("incorrect", "role & org absent from span (only name) (§3)"),
    "B7Gg4jH6g2CdgVY8gS9G": ("incorrect", "English 'member'/'Chamber of Deputies' (§1)"),
    "BqJe9zUHgFDgF9vLRzPu": ("incorrect", "role belongs to husband ('jej mąż kieruje'), misattributed (§3)"),
    "OAHYWAo4VkeOGsVL1HUM": ("incorrect", "subj 'prezes' is a role, not a name (§2)"),
    "P3eDbNzK3fXugnjS7AA6": ("incorrect", "English 'governor'/'Central Bohemian Region' (§1)"),
    "PPo8jRcD4FthUbvFCngZ": ("incorrect", "role 'rzecznik\".' garbled & CBA not in span (§3)"),
    "00SdsigBGemdK0JTQINZ": ("insufficient", "subj 'Błażej Spychalski' not named in span ('został powołany') (§2)"),
    "33LkRl8dCV3lFV5xxzaK": ("correct", "name+role+org all in span; human 'insufficient' looks wrong"),
    "37m2nSYH0HYmP3mmknUf": ("insufficient", "subj 'Marek Chrzanowski' not named in span (§2)"),
    "3YLKSTW8sSugLnu2j9Ut": ("incorrect", "subj 'żona Marcina Liberackiego' is a description, not a name (§2)"),
    "4Rye8UjxGymHkkFZR4rM": ("insufficient", "subj 'Sylwester R.' not named in span ('Były prezes ZUS') (§2)"),
    "BIJWjGDwUBLXNbQf6glP": ("incorrect", "org 'Ambasada Egiptu' — Egipt not in span ('placówki w Warszawie') (§3)"),
    "BJtu4UtFgYd9g9LGosIQ": ("correct", "name+role in span; town in truncated tail"),
    "CoN9ApqSAdtGbKtK9doi": ("correct", "name+role+'Biura'(CBA) in span"),
    "E1RDpuxZssCbZajMX8x1": ("insufficient", "subj 'Błażej Spychalski' not named in span ('Był doradcą…') (§2)"),
    "EQ87IYoXMkpI9dh5yRXk": ("incorrect", "span is about arrest; role 'burmistrz'/org not in span (§3)"),
    "F4rg5Rjx9oPB1tkJ8MjT": ("insufficient", "subj 'Rustem Umierow' not named in span (§2)"),
    "GK5rz61a3GrhQqB4veGu": ("correct", "name+role kierownik+MOPS in span"),
    "GZBhBKvWNval46NCsUSu": ("incorrect", "span about PO candidacy; 'rada nadzorcza KGHM' not in span (§3)"),
    "HnIozHqke1HmieLjN6EO": ("incorrect", "subj 'syn Grzegorza Stankiewicza' is a description (§2)"),
    "Ku86DdrEsU1oSMYCBwHw": ("incorrect", "org belongs to prokurator Karol K., not adwokat Artur N. (misattr., §3)"),
    "OE07rFyo8VSA9W71BZmE": ("insufficient", "subj 'Jakub Banaś' not named in span ('syn prezesa NIK') (§2)"),
    "5WKOfKyqcVVPK0o0VZy0": ("correct", "'Karol Karski, były europoseł PiS' in span"),
    "ELDIoHlItaAyjWFP9S86": ("correct", "name+'Forum na rzecz Demokracji' in span"),
    "MlG6LIJnTWVBjjKDgtnG": ("insufficient", "subj 'Stanisław Gawłowski' not named in span ('senator KO') (§2)"),
    "8Ou2tAkNSdrwYc0TYGS1": ("incorrect", "party 'PO' not in span (§3)"),
    "Fp34Bss4Xj7e7jijM6Dn": ("incorrect", "party 'ČSSD' not in span (§3)"),
    "KXDWIoUJQIEIjTDEtcBz": ("incorrect", "subj 'M.' is a bare initial, not a valid name (§2)"),
    "4VTKzK26KZP8EaT2aWHD": ("incorrect", "party 'PSL' not in span ('działacza ludowców') (§3)"),
    "7qdLUjMC2KhZGeds4FVn": ("insufficient", "subj 'Ryszard Czarnecki' not named in span ('polityk PiS') (§2)"),
    "9GXM7qMFWvBGCKbAKTXo": ("incorrect", "party 'EPP' not in span (only name) (§3, Option A)"),
    "JEH1rIOxRVrqPxxT0Aji": ("insufficient", "subj 'Jan Burgo' not named in span ('podkarpacki działacz PSL') (§2)"),
    "6CKXVX8wFvxZwDJKwJFE": ("insufficient", "subj 'Ryszard Czarnecki' not named in span ('małżonkę Emilię H.') (§2)"),
    "9AQKGGFcXdolctRcuQdZ": ("correct", "both named, relation żona in span"),
    "AORRrhfutJVvyVJcSuE2": ("correct", "both named, relation znajomy in span"),
    "CwDDXxPslF7sSWigv0PU": ("correct", "both named, relation in span"),
    "FTuORSXH1JkJVNM5IhxG": ("correct", "both named, relation żona in span"),
    "IAqHKVxoy08CWVUiE7II": ("correct", "both named, relation żona in span"),
    "K85BboAtnt0pD7Cw7gIt": ("correct", "both named, relation klient in span"),
    "21xyX2hXehZwAjx8tu5O": ("incorrect", "object 'ojciec Michała O.' is a description, not a name (§4)"),
    "3vkr7wvYTu84Ov8SG6pJ": ("incorrect", "object 'wicepremier Paweł' garbled (span: 'Pawlaka') (§4)"),
    "4aZ06SIfMK7vWpEcbMui": ("incorrect", "subj 'córka Grzegorza Stankiewicza' is a description (§2)"),
    "5XhXmB5DF8CEoLZRx7xk": ("incorrect", "object 'ojciec' unnamed; relation 'rodzina' vague (§4)"),
    "6BwN7cJ1KagXdjoDlPQe": ("incorrect", "object 'żona' unnamed (§4)"),
    "7wyPYNKpawTKi8Dd1pcC": ("incorrect", "object 'nieokreślony działacz ludowców' unnamed (§4)"),
    "A5FqTdgKKLWNNvEGndrI": ("incorrect", "object 'córka Dariusza U.' is a description (§4)"),
    "CZvhPkGePLKczQbPsSEU": ("insufficient", "subj 'Stefan Niesiołowski' not named in span; direction unverifiable (§2)"),
    "H9UMJ0uP39t5KaFMdL2S": ("incorrect", "object 'żona Stanisława Gawłowskiego' is a description (§4)"),
    "M3ra9Irex2FqvsjVlV1z": ("incorrect", "object 'córka' unnamed (§4)"),
    "NCxYdGIhPrZ6H0unzCoh": ("incorrect", "relation 'bliskie znać się od wielu lat' garbled; subj not in span (§3)"),
    "PXajvRBS7E8U7u9E3KbN": ("incorrect", "object 'konkubina' unnamed (§4)"),
    "2e255IAYqG74bN7ZfsU0": ("insufficient", "subj 'Przemysław Litwiniuk' not named in span (§2)"),
    "F3yJzZLqlksKvYV36Csi": ("insufficient", "subj 'Jakub Banaś' not named in span ('syn Mariana Banasia') (§2)"),
    "HLBCoZXZajHNGwiIv2r6": ("insufficient", "object 'Wojciech Horyń' not named in span ('jej mąż') (§2/§4)"),
}

rows = [json.loads(l) for l in open("extraction_gt.jsonl")]
assert set(J) == {r["extraction_id"] for r in rows}, "id mismatch"

out = []
for r in rows:
    gt, reason = J[r["extraction_id"]]
    rec = dict(r)
    rec["human_label"] = r["label"]
    rec["gt_label"] = gt
    rec["reason"] = reason
    rec["changed"] = gt != r["label"]
    out.append(rec)

with open("extraction_gt_reviewed.jsonl", "w") as f:
    for r in out:
        f.write(json.dumps(r, ensure_ascii=False, default=str) + "\n")

cols = ["extraction_id", "fact_type", "human_label", "gt_label", "changed",
        "reason", "person", "subject", "role", "party", "organization",
        "object", "relation", "justification"]
with open("extraction_gt_reviewed.csv", "w", newline="") as f:
    w = csv.DictWriter(f, fieldnames=cols, extrasaction="ignore")
    w.writeheader()
    w.writerows(out)

print("gt_label distribution:", dict(collections.Counter(r["gt_label"] for r in out)))
print("human   distribution:", dict(collections.Counter(r["human_label"] for r in out)))
changed = [r for r in out if r["changed"]]
print(f"\nchanged: {len(changed)}/100")
print("confusion (human -> gt):")
conf = collections.Counter((r["human_label"], r["gt_label"]) for r in out)
for k in sorted(conf):
    tag = "  <-- same" if k[0] == k[1] else ""
    print(f"  {k[0]:12s} -> {k[1]:12s} : {conf[k]}{tag}")
print("\nchanges by driver rule:")
drv = collections.Counter(r["reason"].split("(")[-1].rstrip(")") for r in changed)
for k, v in drv.most_common():
    print(f"  §{k:6s}: {v}")
