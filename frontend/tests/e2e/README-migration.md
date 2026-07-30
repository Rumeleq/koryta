# What came over from Cypress, and what did not

The Cypress suite stopped running in CI: the `Frontend E2E` workflow
(`.github/workflows/ci.yml`) is disabled on GitHub, so `cypress/` has been
describing a version of the app that has since moved on. Porting it spec by
spec surfaced that: the specs were not flaky, they were testing pages and
buttons that no longer exist.

Where the feature is still there, the test came over and asserts against the
current UI. Where it is not, the test is gone and the coverage it stood for is
listed here, so the gap is on the record rather than in a skipped file nobody
reads.

## Ported, retargeted

| Cypress                                    | Playwright                     | What changed                                                                                            |
| ------------------------------------------ | ------------------------------ | ------------------------------------------------------------------------------------------------------- |
| `features/home.cy.ts`                      | `home.spec.ts`                 | The "Łącznie" and "Dodaj osoby" cards are gone; the table, "nowe" and call-to-action cards replace them |
| `features/entity_page.cy.ts`               | `entity_page.spec.ts`          | Addresses `/osoba/:slug`; keeps one test on `/entity/person/1` to cover the redirect                    |
| `features/entity_auth_redirect.cy.ts`      | `entity_auth_redirect.spec.ts` | "Zaproponuj zmianę" opens a login dialog in place instead of bouncing to `/login`                       |
| `entity_management/local_graph.cy.ts`      | `local_graph.spec.ts`          | Asserts the entity page's own graph, and `/graf?miejsce=`, which is how the app links into it           |
| `entity_management/toolbar_workflow.cy.ts` | `toolbar_workflow.spec.ts`     | The "Dodaj nowe" menu is gone; the toolbar now offers Rewizje, plus Admin and Notatki to admins         |
| `entity_management/already_existing.cy.ts` | `already_existing.spec.ts`     | Suggestions and the link onwards still work; the form no longer comes back filled                       |

## Dropped

`/edit/node/*` can neither load nor save. `useNodeEdit.saveNode` is
`throw new Error("Not implemented")` with the write commented out, and nothing
ever populates the form from the node being edited. Editing moved to the
"Zaproponuj zmianę" dialog, which writes a revision through
`/api/revisions/create`.

- **`entity_management/edit_entity.cy.ts`** — creating a node, saving an edit to
  it, and the form arriving prefilled. `revisions_edit.spec.ts` covers proposing
  an edit through today's dialog; nothing covers the prefill, because there is
  nothing to prefill.
- **`entity_management/new_node_navigation.cy.ts`** — creating a node and landing
  on its edit page, and a contentless node being searchable but not public.
  `omni_search_add_person.spec.ts` already covers the second half through the
  dialog.
- **`entity_management/person_details.cy.ts`** — birth date and external links
  sent on create. **Not covered anywhere now**: the propose dialog carries
  wikipedia and rejestr.io but no birth date.
- **`entity_management/person_wiki.cy.ts`** — a wikipedia link surviving to the
  entity page. **Not covered anywhere now.**

The Cypress originals are still in `cypress/` for reference. Several of them
were already `describe.skip`ped, and `features/home.cy.ts` had been reading
`response.body["entities"]` - a key `/api/nodes` stopped returning - so it was
counting `undefined` long before this migration.
