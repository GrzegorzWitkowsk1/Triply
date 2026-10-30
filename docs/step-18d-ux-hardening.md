# Step 18D — Accessibility and UX hardening

## Scope and confirmed findings

The repository uses MUI, custom CSS, React Query and Leaflet. The work extends these primitives and preserves the preceding 18A–18C changes.

- Serious: accent text and several status/category labels failed text contrast; visible language/account/collection labels were omitted from accessible names; filter and chart elements used unsupported ARIA.
- High impact: the mobile Assistant overlay did not contain focus or hide background controls. Failed sends cleared drafts. Disabling authentication fields dropped keyboard focus during failed requests.
- Moderate: authentication lacked a main landmark and first-level heading; forms lacked predictable first-error focus; route changes and removal of focused attractions could leave focus on the document body. Creator analysis replaces its original trigger, so ordinary dialog focus restoration had no valid destination.
- Reliability: delayed budget responses could replace newer revisions, old history reads could race Assistant sends, same-event repeated preview actions could submit twice, and sharing callbacks were not protected against identity changes.

## Changes

- Preserve brand fills; use semantic darker accent/success text and visible control borders. Add a non-color selected-view indicator and underlined map attribution links.
- Add a localized skip link and route focus. Use real inputs for React Hook Form refs. Restore focus after deletion and after Creator dialog cleanup.
- Use MUI Modal focus containment for mobile Assistant; preserve the nonmodal desktop panel. Scope Escape to the panel, expose the conversation log/loading/error states, retain failed/newer drafts and guard send/apply operations.
- Add visible expense labels, associated amount errors and first-error focus. Validate authentication fields locally, preserve credentials, keep inputs read-only during requests, and prevent duplicate submissions.
- Cancel obsolete history/budget reads, retain newer budget revisions, scope cache callbacks to their originating query keys, and preserve existing ownership/session guards and itineraryVersion checks.
- Add same-event submission guards for planning, preview generation/commit and sharing; suppress late sharing callbacks after identity changes.

## Verification

Automated checks combine axe WCAG 2.0/2.1/2.2 AA and best-practice rules, keyboard interaction, deterministic request failures/delays, touch emulation, unit tests, existing ownership regression tests and EN/PL screenshots. Passing axe does not establish complete WCAG compliance.

Final command results are reported in the task response. Browser reports and screenshots are generated under `playwright-report/` and `test-results/` (ignored artifacts).

Completed validation:

| Check | Result |
| --- | --- |
| Frontend unit/component tests | 494 passed, 52 files |
| Backend tests | 940 passed, 57 files |
| Monorepo production build | 3 tasks passed |
| Monorepo TypeScript | 4 tasks passed |
| E2E TypeScript | Passed |
| EN/PL translation validation | 0 errors, 0 warnings; 174 contextual repeated-value groups |

The focused browser run passed all seven new keyboard/reliability scenarios. The initial state-gallery run passed four EN/PL desktop/mobile tests, including axe checks on validation, empty, dialog, loading and network-error states. The complete browser suite is rerun after the final source changes.

## Remaining validation

- Real screen-reader testing with NVDA/JAWS/VoiceOver and physical iOS/Android keyboards remains necessary. Chromium touch/viewport emulation does not reproduce these environments fully.
- External map tiles and destination photos are blocked in the deterministic browser environment; fallback rendering and marker interactions are tested.
- No React DevTools/CPU profiling or performance score is claimed. Demonstrated improvements concern canceled obsolete requests, protected state and duplicate-request prevention. The existing large production JavaScript chunk still needs production performance investigation.
- No lint configuration or lint script exists in the repository; none was added as part of this UI task.
- Production validation still needs representative user testing, deployment checks and assistive-technology review before any claim of WCAG 2.2 AA conformance.

No backend rules, AI prompts, quotas, schemas or authorization contracts are changed. No commits or pushes are made.
