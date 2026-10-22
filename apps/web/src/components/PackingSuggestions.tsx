import { useEffect, useRef, useState } from "react";
import { Alert, Button, Checkbox, Collapse, useMediaQuery, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel } from "@mui/material";
import { AutoAwesomeOutlined, ExpandMoreOutlined } from "@mui/icons-material";
import { EQUIPMENT_CATEGORIES, matchPackingSuggestion, type EquipmentCategory, type PackingPreview } from "@triply/shared";
import { useApplyPacking, usePackingContext, usePackingGeneration } from "../hooks/usePackingGeneration";
import { useTripEquipment } from "../hooks/useTripEquipment";

const labels = { documents: "Documents", clothing: "Clothing", toiletries: "Toiletries", electronics: "Electronics", health: "Health & Safety", other: "Other" };
export default function PackingSuggestions({ tripId }: { tripId: string }) {
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
  const [message, setMessage] = useState("");
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
    setOpen(true); setPreview(null); setMessage(""); setAllowStale(false); setCollapsed({}); apply.reset();
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
      setMessage(`${result.added.length} items added. ${result.skipped.length} duplicates skipped.${result.stale ? " Outdated suggestions were added with your confirmation; existing items were preserved." : ""}`);
      close();
    } catch { /* Keep preview and selection available for retry. */ }
    finally { lock.current = false; }
  }
  return <>
    <button type="button" className="btn btn-primary equipment-ai-btn" onClick={() => void start()} disabled={generate.isPending || apply.isPending || equipment.isPending || equipment.isError} aria-describedby="packing-ai-note"><AutoAwesomeOutlined />{refresh ? "Refresh suggestions" : "Generate packing list"}</button>
    <p id="packing-ai-note" className="packing-muted">Review AI suggestions before adding them.</p>
    {!open && context.data?.outdated && <p className="packing-context-note" role="status">Your trip has changed since these suggestions were generated. Refresh suggestions when you are ready.</p>}
    {message && <p className="packing-muted" role="status">{message}</p>}
    <Dialog open={open} onClose={close} fullWidth maxWidth="sm" aria-labelledby="packing-preview-title" className="packing-preview-dialog">
      <DialogTitle id="packing-preview-title">Packing suggestions</DialogTitle>
      <DialogContent dividers>
        {generate.isPending && <p role="status">Generating suggestions from your saved trip...</p>}
        {generate.isError && <Alert severity="error" action={<Button color="inherit" onClick={() => void start()}>Try again</Button>}>{generate.error.message}</Alert>}
        {preview && <>
          <p className="packing-muted">Review every suggestion. Add selected appends items and preserves your existing names, quantities and packed states.</p>
          <p className="packing-preview-summary" role="status">{reviews.length} suggestions found: {counts.new} new items, {counts.exact} already on your list, {counts.possible} possible duplicates.</p>
          {preview.warnings.map((warning, index) => <p className="packing-preview-warning" key={`${index}-${warning}`}>{warning}</p>)}
          <p className="packing-muted">Possible duplicates are skipped by default. Select them or choose Add anyway to include them. Exact duplicates are always skipped.</p>
          <p className="packing-muted">Expires {new Date(preview.expiresAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}. Duplicates are checked again when adding.</p>
          {previewStale && <Alert severity="warning">Your trip has changed since these suggestions were generated. Refresh suggestions or review and confirm this outdated preview.</Alert>}
          {previewStale && <FormControlLabel control={<Checkbox checked={allowStale} disabled={apply.isPending} onChange={(_, checked) => setAllowStale(checked)} />} label="Use these outdated suggestions anyway" />}
          {context.isError && <p className="packing-muted">Could not check for trip changes. The server will recheck before adding items.</p>}
          {expired && <Alert severity="warning">This preview expired. Close it and refresh suggestions.</Alert>}
          {reviews.length === 0 ? <p role="status">No packing suggestions were returned. You can still add items manually.</p> : <>
            {available.length === 0 && <p role="status">All suggested items are already on your list.</p>}
            {available.length > 0 && <FormControlLabel control={<Checkbox checked={selectedIds.length === available.length} indeterminate={selectedIds.length > 0 && selectedIds.length < available.length} disabled={apply.isPending} onChange={(_, checked) => choose(available.map(review => review.item.id), checked)} />} label="Select all suggestions" />}
            <p role="status">{selectedIds.length} suggestions selected</p>
            {!selectedIds.length && available.length > 0 && <p className="packing-muted">Select at least one item to add.</p>}
            {EQUIPMENT_CATEGORIES.map(category => {
              const group = reviews.filter(review => review.item.category === category);
              if (!group.length) return null;
              const selectable = group.filter(review => review.kind !== "exact").map(review => review.item.id);
              const chosen = selectable.filter(id => selectedIds.includes(id)).length;
              const expanded = !collapsed[category];
              return <section className="packing-preview-category" aria-label={`${labels[category]} suggestions`} key={category}>
                <h3><button type="button" className="packing-category-toggle" aria-label={`${labels[category]}, ${group.length} suggestions`} aria-expanded={expanded} aria-controls={`packing-preview-${category}`} onClick={() => setCollapsed(current => ({ ...current, [category]: !current[category] }))}><span>{labels[category]}</span><span>{group.length}</span><ExpandMoreOutlined className={expanded ? "packing-chevron-open" : ""} /></button></h3>
                <Collapse id={`packing-preview-${category}`} in={expanded} timeout={reducedMotion ? 0 : 240} easing="cubic-bezier(0.4, 0, 0.2, 1)" inert={!expanded} aria-hidden={!expanded}><div className="packing-preview-category-content">
                  {!!selectable.length && <FormControlLabel control={<Checkbox checked={chosen === selectable.length} indeterminate={chosen > 0 && chosen < selectable.length} disabled={apply.isPending} onChange={(_, checked) => choose(selectable, checked)} />} label={`Select all ${labels[category]} suggestions`} />}
                  <ul className="packing-preview-items">{group.map(({ item, kind, matches }) => <li key={item.id}>
                    <FormControlLabel control={<Checkbox checked={selectedIds.includes(item.id)} disabled={apply.isPending || kind === "exact"} slotProps={{ input: { "aria-label": `${item.name}, ${labels[item.category]}, quantity ${item.count}`, "aria-describedby": kind !== "new" ? `duplicate-${item.id}` : undefined } }} onChange={(_, checked) => choose([item.id], checked)} />} label={<span><strong>{item.name}</strong><span className="packing-preview-meta">{labels[item.category]} &middot; Quantity {item.count}</span></span>} />
                    {kind !== "new" && <p id={`duplicate-${item.id}`} className="packing-duplicate-note">{kind === "exact" ? "Already on your list. This exact duplicate will be skipped." : "Similar to an item already on your list."}</p>}
                    {!!matches.length && <details className="packing-item-details"><summary>View matching {item.name} items</summary><ul>{matches.map(match => <li key={match.id}>{match.name} - {labels[match.category]}, quantity {match.count}, {match.packed ? "packed" : "to pack"}</li>)}</ul></details>}
                    {kind === "possible" && <div className="packing-duplicate-actions"><Button size="small" disabled={apply.isPending || selectedIds.includes(item.id)} onClick={() => choose([item.id], true)}>Add {item.name} anyway</Button><Button size="small" disabled={apply.isPending || !selectedIds.includes(item.id)} onClick={() => choose([item.id], false)}>Skip {item.name}</Button></div>}
                    <details className="packing-item-details"><summary>Why {item.name}?</summary><p>{item.reason || "No explanation was provided. Review whether this item is useful for your trip."}</p></details>
                  </li>)}</ul>
                </div></Collapse>
              </section>;
            })}
          </>}
          {apply.isError && <Alert severity="error">{apply.error.message}</Alert>}
          {apply.isPending && <p role="status">Adding selected suggestions...</p>}
        </>}
      </DialogContent>
      <DialogActions>
        <Button onClick={close} disabled={apply.isPending}>{preview ? "Cancel" : "Close"}</Button>
        {preview && <Button onClick={() => void start()} disabled={apply.isPending || generate.isPending}>Refresh suggestions</Button>}
        {preview && <Button variant="contained" onClick={() => void addSelected()} disabled={!selectedIds.length || apply.isPending || expired || (previewStale && !allowStale)}>{apply.isPending ? "Adding..." : `Add ${selectedIds.length} selected items`}</Button>}
      </DialogActions>
    </Dialog>
  </>;
}
