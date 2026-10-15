# Border Ledger — Design Direction

## Mode

Operate. The user arrives with a concrete job: understand current spending, inspect a record, or reconcile an import.

## Visual world

Border Ledger borrows from bilingual remittance slips and railway timetables: a warm paper ground, ink-dark text, disciplined ruled columns, and small stamped status marks. The visual system should feel precise and human rather than like a generic fintech dashboard.

## Direction contract

- The first viewport must show the reporting window, CAD and CNY totals, confirmed versus provisional distinction, and one useful trend signal without requiring a scroll.
- Currency is shown in separate lanes before any conversion is introduced.
- Thin rules and inset panels create structure; avoid a wall of floating cards.
- Use tabular numerals for amounts and dates.
- State labels must be textual: confirmed, provisional, needs review, imported.
- Motion is restrained: one short ledger-line reveal on load and clear focus/pressed states.
- Mobile collapses lanes vertically while preserving the same order and hierarchy.

## Tokens

- Canvas: `#f3efe6` / ink: `#18201f`
- Muted ink: `#68706d` / rule: `#d2ccc0`
- CAD signal: `#1b6b5b` / CNY signal: `#b04e36`
- Review signal: `#996b1f` / danger: `#a83f3f`
- Display: Space Grotesk; body: DM Sans; data: IBM Plex Mono
- Radii: 14px panels, 8px controls, no decorative pills for content
- Elevation: one soft offset shadow for the main shell only; otherwise rules and contrast
