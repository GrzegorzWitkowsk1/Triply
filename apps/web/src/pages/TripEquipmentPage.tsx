import { useRef, useState, type FormEvent } from "react";
import { Button, Collapse, useMediaQuery, Dialog, DialogActions, DialogContent, DialogTitle } from "@mui/material";
import { useBulkPacking } from "../hooks/usePackingGeneration";
import { Link, useParams } from "react-router-dom";
import { AddOutlined, ArrowBackOutlined, BackpackOutlined, DeleteOutlineOutlined, EditOutlined, ExpandMoreOutlined, DescriptionOutlined, CheckroomOutlined, WashOutlined, DevicesOutlined, HealthAndSafetyOutlined } from "@mui/icons-material";
import { EQUIPMENT_CATEGORIES, createTripEquipmentItemSchema, type EquipmentCategory, type CreateTripEquipmentItem, type TripEquipmentItem } from "@triply/shared";
import { useCreateEquipmentItem, useDeleteEquipmentItem, useTripEquipment, useUpdateEquipmentItem } from "../hooks/useTripEquipment";
import PackingSuggestions from "../components/PackingSuggestions";
import { useTrip } from "../hooks/useTrips";

const categories = {
  documents: { label: "Documents", Icon: DescriptionOutlined },
  clothing: { label: "Clothing", Icon: CheckroomOutlined },
  toiletries: { label: "Toiletries", Icon: WashOutlined },
  electronics: { label: "Electronics", Icon: DevicesOutlined },
  health: { label: "Health & Safety", Icon: HealthAndSafetyOutlined },
  other: { label: "Other", Icon: BackpackOutlined },
};

function ItemForm({ item, busy, onSave, onCancel }: {
  item?: TripEquipmentItem; busy: boolean;
  onSave: (input: CreateTripEquipmentItem) => Promise<void>; onCancel?: () => void;
}) {
  const [name, setName] = useState(item?.name ?? "");
  const [category, setCategory] = useState<EquipmentCategory>(item?.category ?? "other");
  const [count, setCount] = useState(String(item?.count ?? 1));
  const [error, setError] = useState("");
  const lock = useRef(false);
  const nameInput = useRef<HTMLInputElement>(null);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || lock.current) return;
    const result = createTripEquipmentItemSchema.safeParse({ name, category, count: Number(count) });
    if (!result.success) {
      setError("Enter an item name (1-120 characters) and a whole quantity from 1 to 999.");
      return;
    }
    lock.current = true;
    setError("");
    try {
      await onSave(result.data);
      if (!item) { setName(""); nameInput.current?.focus(); }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not save item. Please try again.");
    } finally { lock.current = false; }
  }
  return <form className="packing-form" onSubmit={event => void submit(event)} noValidate aria-label={item ? `Edit ${item.name}` : "Add packing item"}>
    <label className="packing-name">Item name<input ref={nameInput} className="equipment-add-input" value={name} onChange={e => setName(e.target.value)} maxLength={120} required disabled={busy} autoFocus={!!item} placeholder="e.g. Rain jacket" /></label>
    <label>Category<select className="equipment-add-input" value={category} onChange={e => setCategory(e.target.value as EquipmentCategory)} disabled={busy}>{EQUIPMENT_CATEGORIES.map(value => <option key={value} value={value}>{categories[value].label}</option>)}</select></label>
    <label>Quantity<input className="equipment-add-input" type="number" min={1} max={999} step={1} required value={count} onChange={e => setCount(e.target.value)} disabled={busy} /></label>
    <button className="btn btn-primary" disabled={busy} type="submit">{!item && <AddOutlined />}{busy ? "Saving..." : item ? "Save changes" : "Add item"}</button>
    {onCancel && <button className="btn btn-secondary" type="button" onClick={onCancel} disabled={busy}>Cancel</button>}
    {error && <p className="packing-form-error" role="alert">{error}</p>}
  </form>;
}

function PackingChecklist({ id }: { id: string }) {
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const equipment = useTripEquipment(id);
  const create = useCreateEquipmentItem(id);
  const update = useUpdateEquipmentItem(id);
  const remove = useDeleteEquipmentItem(id);
  const bulk = useBulkPacking(id);
  const [batch, setBatch] = useState<{ itemIds: string[]; packed: boolean } | null>(null);
  const editOrder = useRef<string[]>([]);
  const [filter, setFilter] = useState("All");
  const [collapsed, setCollapsed] = useState<Partial<Record<EquipmentCategory, boolean>>>({});
  const [editing, setEditing] = useState<TripEquipmentItem | null>(null);
  const [feedback, setFeedback] = useState("");
  const lock = useRef(false);
  const items = equipment.data ?? [];
  const packed = items.filter(item => item.packed).length;
  const percentage = items.length ? Math.round(packed / items.length * 100) : 0;
  const busy = create.isPending || update.isPending || remove.isPending || bulk.isPending;
  const visible = items.filter(item => filter === "All" || (filter === "Packed" ? item.packed : !item.packed));
  function prepareBulk(packed: boolean) {
    const itemIds = visible.filter(item => !collapsed[item.category] && item.packed !== packed).map(item => item.id);
    if (itemIds.length) setBatch({ itemIds, packed });
  }
  async function act(action: () => Promise<unknown>, message: string) {
    if (busy || lock.current) return;
    lock.current = true;
    setFeedback("");
    try { await action(); setFeedback(message); }
    catch { /* Mutation errors are displayed below; optimistic changes roll back. */ }
    finally { lock.current = false; }
  }
  return <section className="equipment-list-card" aria-labelledby="packing-title">
    <div className="equipment-list-header"><div><h2 className="equipment-list-title" id="packing-title">Packing checklist</h2>
      {equipment.data && <p className="packing-muted">{packed} of {items.length} items packed</p>}</div>
      {equipment.data && <strong>{percentage}%</strong>}
    </div>
    {equipment.data && <div className="packing-progress" role="progressbar" aria-label="Packing completion" aria-valuenow={percentage} aria-valuemin={0} aria-valuemax={100}><div style={{ width: `${percentage}%` }} /></div>}
    <div className="packing-content">
      {equipment.isPending && <p role="status">Loading packing checklist...</p>}
      {equipment.isError && <div role="alert"><p>{equipment.error.message}</p><button type="button" className="btn btn-secondary" disabled={equipment.isFetching} onClick={() => void equipment.refetch()}>Retry packing list</button></div>}
      {equipment.data && <>
        {items.length === 0 ? <div className="packing-empty"><BackpackOutlined aria-hidden="true" /><h3>Your packing list is empty</h3><p>Add your essentials below, or generate suggestions based on your trip.</p></div> : <>
          <div className="packing-filters" role="group" aria-label="Filter packing items">{["All", "To pack", "Packed"].map(value => <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)}>{value}</button>)}</div>
          <div className="packing-bulk-actions" role="group" aria-label="Bulk packing actions">
            <button type="button" className="btn btn-secondary" disabled={busy || !!editing || !visible.some(item => !collapsed[item.category] && !item.packed)} onClick={() => prepareBulk(true)}>Pack visible unpacked items</button>
            <button type="button" className="btn btn-secondary" disabled={busy || !!editing || !visible.some(item => !collapsed[item.category] && item.packed)} onClick={() => prepareBulk(false)}>Unpack visible packed items</button>
          </div>
          {packed === items.length && <p className="packing-success" role="status">You are all packed!</p>}
          {visible.length === 0 && <p className="packing-empty">{filter === "To pack" ? "Everything is packed!" : "No packed items yet."}</p>}
          {EQUIPMENT_CATEGORIES.map(category => {
            const all = items.filter(item => item.category === category);
            const group = visible.filter(item => item.category === category).sort((a, b) => editing
              ? editOrder.current.indexOf(a.id) - editOrder.current.indexOf(b.id) : Number(a.packed) - Number(b.packed));
            if (!group.length) return null;
            const { label, Icon } = categories[category];
            const open = !collapsed[category];
            return <section className="packing-category" key={category} aria-label={label}>
              <h3><button type="button" className="packing-category-toggle" aria-expanded={open} aria-controls={`packing-${id}-${category}`} onClick={() => setCollapsed(current => ({ ...current, [category]: !current[category] }))}><Icon aria-hidden="true" /><span>{label}</span><span className="packing-category-count">{all.filter(item => item.packed).length}/{all.length}</span><ExpandMoreOutlined className={open ? "packing-chevron-open" : ""} /></button></h3>
              <Collapse id={`packing-${id}-${category}`} in={open} timeout={reducedMotion ? 0 : 240} easing="cubic-bezier(0.4, 0, 0.2, 1)" inert={!open} aria-hidden={!open}><ul>{group.map(item => <li key={item.id} className="packing-row">
                <label className="packing-item-label"><input type="checkbox" checked={item.packed} disabled={busy} onChange={() => void act(() => update.mutateAsync({ itemId: item.id, input: { packed: !item.packed } }), `${item.name} ${item.packed ? "marked to pack" : "packed"}.`)} /><span className={item.packed ? "packing-packed" : ""}>{item.name}</span></label>
                <span className="packing-quantity" aria-label={`Quantity ${item.count}`}>&times;{item.count}</span>
                <button type="button" className="packing-icon-btn" aria-label={`Edit ${item.name}`} disabled={busy} onClick={() => { editOrder.current = [...items].sort((a, b) => Number(a.packed) - Number(b.packed)).map(entry => entry.id); setEditing(item); }}><EditOutlined /></button>
                <button type="button" className="packing-icon-btn" aria-label={`Delete ${item.name}`} disabled={busy} onClick={() => void act(() => remove.mutateAsync(item.id), `${item.name} deleted.`)}><DeleteOutlineOutlined /></button>
                {item.source === "ai" && <div className="packing-row-explanation"><span className="packing-ai-source">AI suggested</span><details className="packing-item-details"><summary>Why {item.name}?</summary><p>{item.reason || "No explanation was saved for this item."}</p></details></div>}
              </li>)}</ul></Collapse>
            </section>;
          })}
        </>}
        {editing && <section className="packing-editor" aria-label="Edit packing item"><h3>Edit item</h3><ItemForm key={editing.id} item={editing} busy={busy} onCancel={() => setEditing(null)} onSave={async input => { await update.mutateAsync({ itemId: editing.id, input }); setEditing(null); setFeedback("Item updated."); }} /></section>}
        <div className="equipment-list-footer"><h3>Add an item</h3><ItemForm busy={busy} onSave={async input => { await create.mutateAsync(input); setFeedback("Item added."); }} /></div>
      </>}
      {(update.isError || remove.isError || bulk.isError) && <p role="alert">{bulk.error?.message ?? update.error?.message ?? remove.error?.message}</p>}
      <Dialog className="packing-bulk-dialog" open={!!batch} onClose={() => { if (!bulk.isPending) setBatch(null); }} aria-labelledby="packing-bulk-title" maxWidth="xs" fullWidth>
        <DialogTitle id="packing-bulk-title">{batch?.packed ? "Pack" : "Unpack"} {batch?.itemIds.length} visible items?</DialogTitle>
        <DialogContent>Only the items visible when you started this action will change. Filtered-out items and collapsed categories stay unchanged.
          {bulk.isError && <p role="alert">{bulk.error.message}</p>}
          {bulk.isPending && <p role="status">Updating selected packing items...</p>}
        </DialogContent>
        <DialogActions><Button disabled={bulk.isPending} onClick={() => setBatch(null)}>Cancel</Button><Button variant="contained" disabled={bulk.isPending} onClick={() => void act(async () => { await bulk.mutateAsync(batch!); setBatch(null); }, `${batch?.itemIds.length} items ${batch?.packed ? "packed" : "marked to pack"}.`)}>{bulk.isPending ? "Updating..." : "Confirm packing change"}</Button></DialogActions>
      </Dialog>
      <p className="packing-feedback" role="status">{busy ? "Saving packing checklist..." : feedback}</p>
    </div>
  </section>;
}

export default function TripEquipmentPage() {
  const { id } = useParams<{ id: string }>();
  const trip = useTrip(id);
  const destination = trip.data?.analysis.destination ?? "Your trip";
  const country = trip.data?.analysis.country;
  const days = trip.data?.analysis.durationDays;
  return <div className="equipment-page"><div className="equipment-inner">
    <Link className="equipment-back-btn" to={`/trips/${id}`}><ArrowBackOutlined />Back to trip</Link>
    <div className="equipment-hero-card"><div className="equipment-hero-content"><div className="equipment-hero-left">
      <div className="equipment-hero-icon"><BackpackOutlined /></div>
      <p className="equipment-hero-location">{[destination, country, days ? `${days} days` : null].filter(Boolean).join(" \u00b7 ")}</p>
      <h1 className="equipment-hero-title">What to bring</h1><p className="equipment-hero-subtitle">Get packing suggestions based on your itinerary and weather.</p>
    </div><div className="equipment-hero-right">{id && <PackingSuggestions key={id} tripId={id} />}</div></div></div>
    {id && <PackingChecklist key={id} id={id} />}
  </div></div>;
}
