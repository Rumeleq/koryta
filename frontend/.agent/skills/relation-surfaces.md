---
description: The five surfaces that list a node's relations, and the rule that /eksploruj/nowe and /eksploruj/tabela stay in parity
---

# Surfaces that list a node's relations

A node's relations are drawn in five places. They look nothing alike, but they
are all "here is one node and what it is connected to", so a capability added to
one usually belongs on the others.

| Surface                      | Component                             | Host                                                   |
| ---------------------------- | ------------------------------------- | ------------------------------------------------------ |
| Person page                  | `card/EmploymentHistory.vue`          | `EntityDetailView.vue`                                 |
| Region page                  | `card/ConnectionList` + `ShortNode`   | `EntityDetailView.vue`                                 |
| Company page                 | `card/EmploymentHistory` + `ConnectionList` | `place/DetailView.vue`                           |
| `/eksploruj/nowe`            | `card/EmploymentHistory.vue`          | `pages/eksploruj/nowe.vue`                             |
| `/eksploruj/tabela`, `/admin/notatki` | `card/EmploymentHistory.vue` | `explore/NodeDrawer.vue`                               |

An **article** (`article/DetailView.vue`) and a **topic**
(`pages/temat/[slug].vue`) have views of their own and are deliberately not in
this list. What an article shows is a citation of somebody else's relation seen
from the side, so acting on the relation from there is the wrong place for it.

## /eksploruj/nowe and /eksploruj/tabela stay in parity

They are the same job in two shapes. `tabela` is the whole queue as a table with
a drawer for whichever row you click; `nowe` is that queue narrowed to one person
at a time with everything you need to judge them on the page. A reviewer moves
between them without re-learning anything, so:

**Whatever one can do to a person or their relations, the other should be able
to do too - in its own shape, not by copying the layout.** A control that lives
in the drawer on `tabela` may be an inline button on `nowe`; what must not differ
is whether the capability exists at all.

They are hosted differently, which is the trap: `tabela` and `/admin/notatki`
both go through `explore/NodeDrawer.vue`, so a change there covers two pages and
misses `nowe`, which renders the same card directly. Check both hosts.

## Shared pieces

Do not paste the flow into a sixth place. `npm run check:duplication` reports
`.vue` clones at 0.00% and it is worth keeping there.

- `composables/edgeRemoval.ts` - `useEdgeRemoval({ subjectName, refresh })`
  returns everything the admin removal flow needs: `canRemove` (the admin
  check), the dialog state, and `openRemove` / `onEdgeRemoved` handlers.
- `components/dialog/RemoveEdgeHost.vue` - the dialog and its "usunięte" notice
  as one tag, bound to that state.
- `utils/edgeSentence.ts` - one relation read as a sentence, for any dialog that
  is handed an edge id and has to tell the reader which row they clicked.

The surface passes `:can-remove` and `@remove` down to the card, and gives
`useEdgeRemoval` a `refresh` that re-reads whatever it fetched - a component
that does not own the fetch (the drawer) emits instead, and its host refreshes.
