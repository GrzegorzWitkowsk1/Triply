import { formatTime } from "../i18n/format";
import { errorMessage as localizedError } from "../i18n/errors";
import { useTranslation } from "react-i18next";
import i18n from "../i18n";
import { useEffect, useRef, useState } from "react";
import { Alert, Button, Checkbox, Collapse, useMediaQuery, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel } from "@mui/material";
import { AutoAwesomeOutlined, ExpandMoreOutlined } from "@mui/icons-material";
import { EQUIPMENT_CATEGORIES, matchPackingSuggestion, type EquipmentCategory, type PackingPreview } from "@triply/shared";
import { useApplyPacking, usePackingContext, usePackingGeneration } from "../hooks/usePackingGeneration";
import { useTripEquipment } from "../hooks/useTripEquipment";

const labels = { get documents() { return i18n.t("documents", { ns: "packing" }); }, get clothing() { return i18n.t("clothing", { ns: "packing" }); }, get toiletries() { return i18n.t("toiletries", { ns: "packing" }); }, get electronics() { return i18n.t("electronics", { ns: "packing" }); }, get health() { return i18n.t("healthSafety", { ns: "packing" }); }, get other() { return i18n.t("other", { ns: "packing" }); } };
export default function PackingSuggestions({ tripId }: { tripId: string }) {
  useTranslation();
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const generate = usePackingGeneration(tripId);
  const apply = useApplyPacking(tripId);
  const equipment = useTripEquipment(tripId);
  const context = usePackingContext(tripId);
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<PackingPreview | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [approvedSimilar, setApprovedSimilar] = useState<Set<string>>(new Set());
  const [collapsed, setCollapsed] = useState<Partial<Record<EquipmentCategory, boolean>>>({});
  const [allowStale, setAllowStale] = useState(false);
  const [hasGenerated, setHasGenerated] = useState(false);
  const [message, setMessage] = useState<{ stale: boolean; added: number; skipped: number } | null>(null);
  const sequence = useRef(0);
  const lock = useRef(false);
  useEffect(() => () => { sequence.current++; }, []);
  const reviews = preview?.suggestions.map(item => ({ item, ...matchPackingSuggestion(item, equipment.data ?? []) })) ?? [];
  const available = reviews.filter(review => review.kind !== "exact");
  const selectedIds = available.filter(review => selected.has(review.item.id) && (review.kind !== "possible" || approvedSimilar.has(review.item.id))).map(review => review.item.id);
  const counts = { new: reviews.filter(review => review.kind === "new").length, exact: reviews.filter(review => review.kind === "exact").length, possible: reviews.filter(review => review.kind === "possible").length };
  const expired = !!preview && Date.parse(preview.expiresAt) <= Date.now();
  const previewStale = !!preview && !!context.data && context.data.contextFingerprint !== preview.contextVersion;
  const refresh = hasGenerated || !!context.data?.generation;
  // Confirming one context revision must not confirm another revision arriving from another tab.
  useEffect(() => setAllowStale(false), [context.data?.contextFingerprint]);
  function choose(ids: string[], checked: boolean) {
    setSelected(current => { const next = new Set(current); ids.forEach(id => checked ? next.add(id) : next.delete(id)); return next; });
    setApprovedSimilar(current => { const next = new Set(current); ids.forEach(id => checked ? next.add(id) : next.delete(id)); return next; });
  }
  async function start() {
    if (lock.current) return;
    lock.current = true;
    const request = ++sequence.current;
    setOpen(true); setPreview(null); setMessage(null); setAllowStale(false); setCollapsed({}); apply.reset();
    try {
      const result = await generate.mutateAsync();
      if (request === sequence.current) {
        setPreview(result); setHasGenerated(true); setApprovedSimilar(new Set());
        setSelected(new Set(result.suggestions.filter(item => matchPackingSuggestion(item, equipment.data ?? []).kind === "new").map(item => item.id)));
      }
    } catch { /* Mutation errors are rendered in the dialog. */ }
    finally { if (request === sequence.current) lock.current = false; }
  }
  function close() {
    if (apply.isPending) return;
    sequence.current++; generate.cancel(); generate.reset(); apply.reset();
    lock.current = false; setOpen(false); setPreview(null); setSelected(new Set()); setApprovedSimilar(new Set());
  }
  async function addSelected() {
    if (!preview || !selectedIds.length || lock.current || expired || (previewStale && !allowStale)) return;
    lock.current = true;
    const request = sequence.current;
    try {
      const result = await apply.mutateAsync({ token: preview.token, selectedIds, ...(previewStale && allowStale ? { allowStale: true } : {}) });
      if (request !== sequence.current) return;
      setMessage({ stale: result.stale, added: result.added.length, skipped: result.skipped.length });
      close();
    } catch { /* Keep preview and selection available for retry. */ }
    finally { lock.current = false; }
  }
  return <>
    <button type="button" className="btn btn-primary equipment-ai-btn" onClick={() => void start()} disabled={generate.isPending || apply.isPending || equipment.isPending || equipment.isError} aria-describedby="packing-ai-note"><AutoAwesomeOutlined />{refresh ? i18n.t("refreshSuggestions", { ns: "packing/suggestions" }) : i18n.t("generatePackingList", { ns: "packing/suggestions" })}</button>
    <p id="packing-ai-note" className="packing-muted">{i18n.t("reviewAiSuggestionsBeforeAddingThem", { ns: "packing/suggestions" })}</p>
    {!open && context.data?.outdated && <p className="packing-context-note" role="status">{i18n.t("yourTripHasChangedSinceTheseSuggestionsWere", { ns: "packing/suggestions" })}</p>}
    {message && <p className="packing-muted" role="status">{i18n.t(message.stale ? "addedResultStale" : "addedResult", { ns: "packing/suggestions", added: message.added, skipped: message.skipped })}</p>}
    <Dialog open={open} onClose={close} fullWidth maxWidth="sm" aria-labelledby="packing-preview-title" className="packing-preview-dialog">
      <DialogTitle id="packing-preview-title">{i18n.t("packingSuggestions", { ns: "packing/suggestions" })}</DialogTitle>
      <DialogContent dividers>
        {generate.isPending && <p role="status">{i18n.t("generatingSuggestionsFromYourSavedTrip", { ns: "packing/suggestions" })}</p>}
        {generate.isError && <Alert severity="error" action={<Button color="inherit" onClick={() => void start()}>{i18n.t("tryAgain", { ns: "common" })}</Button>}>{localizedError(generate.error)}</Alert>}
        {preview && <>
          <p className="packing-muted">{i18n.t("reviewEverySuggestionAddSelectedAppendsItemsAnd", { ns: "packing/suggestions" })}</p>
          <p className="packing-preview-summary" role="status">{i18n.t("reviewCounts", { ns: "packing/suggestions", total: reviews.length, newCount: counts.new, exact: counts.exact, possible: counts.possible })}</p>
          {preview.warnings.map((warning, index) => <p className="packing-preview-warning" key={`${index}-${warning}`}>{i18n.t("reviewWarning", { ns: "packing/suggestions" })}</p>)}
          <p className="packing-muted">{i18n.t("possibleDuplicatesAreSkippedByDefaultSelectThem", { ns: "packing/suggestions" })}</p>
          <p className="packing-muted">{i18n.t("expires", { ns: "packing/suggestions", time: formatTime(preview.expiresAt) })}</p>
          {previewStale && <Alert severity="warning">{i18n.t("yourTripHasChangedSinceTheseSuggestionsWere2", { ns: "packing/suggestions" })}</Alert>}
          {previewStale && <FormControlLabel control={<Checkbox checked={allowStale} disabled={apply.isPending} onChange={(_, checked) => setAllowStale(checked)} />} label={i18n.t("useTheseOutdatedSuggestionsAnyway", { ns: "packing/suggestions" })} />}
          {context.isError && <p className="packing-muted">{i18n.t("couldNotCheckForTripChangesTheServer", { ns: "packing/suggestions" })}</p>}
          {expired && <Alert severity="warning">{i18n.t("thisPreviewExpiredCloseItAndRefreshSuggestions", { ns: "packing/suggestions" })}</Alert>}
          {reviews.length === 0 ? <p role="status">{i18n.t("noPackingSuggestionsWereReturnedYouCanStill", { ns: "packing/suggestions" })}</p> : <>
            {available.length === 0 && <p role="status">{i18n.t("allSuggestedItemsAreAlreadyOnYourList", { ns: "packing/suggestions" })}</p>}
            {available.length > 0 && <FormControlLabel control={<Checkbox checked={selectedIds.length === available.length} indeterminate={selectedIds.length > 0 && selectedIds.length < available.length} disabled={apply.isPending} onChange={(_, checked) => choose(available.map(review => review.item.id), checked)} />} label={i18n.t("selectAllSuggestions", { ns: "packing/suggestions" })} />}
            <p role="status">{i18n.t("selectedCount", { ns: "packing/suggestions", count: selectedIds.length })}</p>
            {!selectedIds.length && available.length > 0 && <p className="packing-muted">{i18n.t("selectAtLeastOneItemToAdd", { ns: "packing/suggestions" })}</p>}
            {EQUIPMENT_CATEGORIES.map(category => {
              const group = reviews.filter(review => review.item.category === category);
              if (!group.length) return null;
              const selectable = group.filter(review => review.kind !== "exact").map(review => review.item.id);
              const chosen = selectable.filter(id => selectedIds.includes(id)).length;
              const expanded = !collapsed[category];
              return <section className="packing-preview-category" aria-label={i18n.t("suggestions", { ns: "packing/suggestions", value0: labels[category] })} key={category}>
                <h3><button type="button" className="packing-category-toggle" aria-label={i18n.t("suggestions2", { ns: "packing/suggestions", value0: labels[category], value1: group.length })} aria-expanded={expanded} aria-controls={`packing-preview-${category}`} onClick={() => setCollapsed(current => ({ ...current, [category]: !current[category] }))}><span>{labels[category]}</span><span>{group.length}</span><ExpandMoreOutlined className={expanded ? "packing-chevron-open" : ""} /></button></h3>
                <Collapse id={`packing-preview-${category}`} in={expanded} timeout={reducedMotion ? 0 : 240} easing="cubic-bezier(0.4, 0, 0.2, 1)" inert={!expanded} aria-hidden={!expanded}><div className="packing-preview-category-content">
                  {!!selectable.length && <FormControlLabel control={<Checkbox checked={chosen === selectable.length} indeterminate={chosen > 0 && chosen < selectable.length} disabled={apply.isPending} onChange={(_, checked) => choose(selectable, checked)} />} label={i18n.t("selectAllSuggestions2", { ns: "packing/suggestions", value0: labels[category] })} />}
                  <ul className="packing-preview-items">{group.map(({ item, kind, matches }) => <li key={item.id}>
                    <FormControlLabel control={<Checkbox checked={selectedIds.includes(item.id)} disabled={apply.isPending || kind === "exact"} slotProps={{ input: { "aria-label": i18n.t("quantity", { ns: "packing/suggestions", value0: item.name, value1: labels[item.category], value2: item.count }), "aria-describedby": kind !== "new" ? `duplicate-${item.id}` : undefined } }} onChange={(_, checked) => choose([item.id], checked)} />} label={<span><strong>{item.name}</strong><span className="packing-preview-meta">{labels[item.category]} · {i18n.t("itemQuantity", { ns: "packing/suggestions", count: item.count })}</span></span>} />
                    {kind !== "new" && <p id={`duplicate-${item.id}`} className="packing-duplicate-note">{kind === "exact" ? i18n.t("alreadyOnYourListThisExactDuplicateWill", { ns: "packing/suggestions" }) : i18n.t("similarToAnItemAlreadyOnYourList", { ns: "packing/suggestions" })}</p>}
                    {!!matches.length && <details className="packing-item-details"><summary>{i18n.t("viewMatchingNamed", { ns: "packing/suggestions", name: item.name })}</summary><ul>{matches.map(match => <li key={match.id}>{i18n.t("matchingItem", { ns: "packing/suggestions", name: `${match.name} - ${labels[match.category]}`, count: match.count, status: i18n.t(match.packed ? "packed" : "toPack", { ns: "packing" }) })}</li>)}</ul></details>}
                    {kind === "possible" && <div className="packing-duplicate-actions"><Button size="small" disabled={apply.isPending || selectedIds.includes(item.id)} onClick={() => choose([item.id], true)}>{i18n.t("addAnyway", { ns: "packing/suggestions", name: item.name })}</Button><Button size="small" disabled={apply.isPending || !selectedIds.includes(item.id)} onClick={() => choose([item.id], false)}>{i18n.t("skipNamed", { ns: "packing/suggestions", name: item.name })}</Button></div>}
                    <details className="packing-item-details"><summary>{i18n.t("whyItem", { ns: "packing/suggestions", name: item.name })}</summary><p>{item.reason || i18n.t("noExplanationWasProvidedReviewWhetherThisItem", { ns: "packing/suggestions" })}</p></details>
                  </li>)}</ul>
                </div></Collapse>
              </section>;
            })}
          </>}
          {apply.isError && <Alert severity="error">{localizedError(apply.error)}</Alert>}
          {apply.isPending && <p role="status">{i18n.t("addingSelectedSuggestions", { ns: "packing/suggestions" })}</p>}
        </>}
      </DialogContent>
      <DialogActions>
        <Button onClick={close} disabled={apply.isPending}>{preview ? i18n.t("cancel", { ns: "common" }) : i18n.t("close", { ns: "common" })}</Button>
        {preview && <Button onClick={() => void start()} disabled={apply.isPending || generate.isPending}>{i18n.t("refreshSuggestions", { ns: "packing/suggestions" })}</Button>}
        {preview && <Button variant="contained" onClick={() => void addSelected()} disabled={!selectedIds.length || apply.isPending || expired || (previewStale && !allowStale)}>{apply.isPending ? i18n.t("adding", { ns: "packing/suggestions" }) : i18n.t("addSelectedItems", { ns: "packing/suggestions", value0: selectedIds.length })}</Button>}
      </DialogActions>
    </Dialog>
  </>;
}
