# Facts Extraction — Labeling Rulebook (v1)

Rules for labeling extracted facts (employment / party_membership /
personal_relation) as **correct / incorrect / insufficient**, and — by
extension — the contract the extractor's output must satisfy.

## 0. Principle

Judge each fact **only against its `justification` span** (the quote the
extractor provided). Never use world knowledge or the rest of the article.
The question is always: *does this exact span cleanly support this exact fact?*

When several rules fire, precedence is **incorrect > insufficient > correct**
(a definite defect wins; uncertainty beats a pass).

## 1. Language

- **Descriptive** fields — `role`, and an `organization`/`party` given as a
  common-noun description — must be in **Polish**; do not translate them.
  e.g. `governor` instead of `wojewoda`, or `Chamber of Deputies` instead of
  `Izba Poselska` → **incorrect**.
- **Proper names are ALWAYS fine, in any language** — do not treat them as a
  language violation:
  - a person's real name: `David Rath`, `Eva Kaili`, `Petr Kott`,
    `Jean-Claude Juncker`, `Michel Claise` are all valid.
  - the proper name of an institution/company/agency: `Fight Impunity`, `SBU`,
    `Miedzi Copper Corporation`, `NABU` are all valid.

## 2. Subject must be a real, full name

- **Valid:**
  - `Imię Nazwisko` — full first + last name (Błażej Spychalski), or
  - `Imię N.` — first name + surname initial when the source anonymizes
    (Konrad R., Michał O.).
- **Invalid → incorrect:**
  - bare initial only: `M.`, `X.`
  - a role/title in the name slot: `prezes`, `wiceprezes`, `adwokat`
  - a relational description: `jego ojciec`, `córka Grzegorza Stankiewicza`,
    `żona Marcina Liberackiego`, `syn X`
- The subject's **name must appear in the justification span** (strict). If the
  span refers to them only by pronoun/relation and never names them
  (span: *"został powołany…"*) → **insufficient**.
- **Extractor contract:** the justification must be **big enough to name the
  subject** on its own. A justification that requires surrounding article
  context to know who it is about is too small — extend it until it contains
  the subject's name.

## 3. Attributes (role / organization / party / relation / object)

- Each populated attribute must be **stated or directly entailed** by the span.
  Treat the following as ENTAILED — **accept them**:
  - a title implies its institution: *premier* ⇒ `Rząd` / `Rada Ministrów`;
    *minister sprawiedliwości* ⇒ `Ministerstwo Sprawiedliwości`; *wiceminister
    zdrowia* ⇒ `Ministerstwo Zdrowia`.
  - standard abbreviations expand: `ULC` = Urząd Lotnictwa Cywilnego, `CBA`,
    `NABU`, `KNF`, `ZUS`, `PSP`, etc.
  - an entity named **elsewhere in the same span** counts for a person in that
    span (e.g. a listing "…(prorektorka Collegium Humanum) … (kwestorka)" — the
    kwestorka's org is Collegium Humanum).
- But do NOT accept a value **more specific** than the span supports (e.g. span
  says *"Urząd Marszałkowski"* but org claims a particular województwo not named,
  or span *"placówka"* but org names a particular country) → that is
  absent/ungrounded → **incorrect**.
- **Contradicted** by the span → **incorrect**.
- **Garbled / malformed** value (truncation, stray punctuation like
  `rzecznik".`) → **incorrect**.
- **Absent** — a specific value the span neither states nor entails
  (e.g. party `EPP` when the span is only *"Ursula von der Leyen"*)
  → **incorrect**. The extractor must not emit ungrounded fields.

## 4. Relations (personal_relation)

- `subject` and `object` must be the **correct way round** per the span
  (*"X, znajomy Y"*).
- Both endpoints must be valid names (§2); an endpoint that is only
  `ojciec` / `żona` with no name → **incorrect**.
- Swapped / wrong direction → **incorrect**.

## 5. Label definitions

- **correct** — subject is a valid name, present in the span; every populated
  field is Polish and supported by the span.
- **insufficient** — fields are plausible but the **span does not name the
  subject** (or is too fragmentary to verify the core claim). The fact may be
  true; it just cannot be confirmed from this span.
- **incorrect** — any concrete defect: non-Polish field, invalid/description
  subject, contradicted / absent / garbled attribute, or wrong relation
  direction.

## 6. Quick reference

| Situation | Label |
|---|---|
| Subject valid name in span, all fields supported & Polish | correct |
| Subject valid name but **not present** in span (pronoun only) | insufficient |
| Span too fragmentary to verify the core claim | insufficient |
| Field in a non-Polish language | incorrect |
| Subject is a bare initial / role / description | incorrect |
| Attribute contradicted, absent (ungrounded), or garbled | incorrect |
| Relation endpoints swapped or unnamed | incorrect |
