import { errorKey as localizedErrorKey, resolveMessage } from "../i18n/errors";
import { errorMessage as localizedError } from "../i18n/errors";
import { useTranslation } from "react-i18next";
import i18n from "../i18n";
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
  documents: { get label() { return i18n.t("documents", { ns: "packing" }); }, Icon: DescriptionOutlined },
  clothing: { get label() { return i18n.t("clothing", { ns: "packing" }); }, Icon: CheckroomOutlined },
  toiletries: { get label() { return i18n.t("toiletries", { ns: "packing" }); }, Icon: WashOutlined },
  electronics: { get label() { return i18n.t("electronics", { ns: "packing" }); }, Icon: DevicesOutlined },
  health: { get label() { return i18n.t("healthSafety", { ns: "packing" }); }, Icon: HealthAndSafetyOutlined },
  other: { get label() { return i18n.t("other", { ns: "packing" }); }, Icon: BackpackOutlined },
};

function ItemForm({ item, busy, onSave, onCancel }: {
  item?: TripEquipmentItem; busy: boolean;
  onSave: (input: CreateTripEquipmentItem) => Promise<void>; onCancel?: () => void;
}) {
  const { t } = useTranslation("common", { i18n });
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
      setError("packing:enterAnItemName1120CharactersAnd");
      return;
    }
    lock.current = true;
    setError("");
    try {
      await onSave(result.data);
      if (!item) { setName(""); nameInput.current?.focus(); }
    } catch (failure) {
      setError(localizedErrorKey(failure));
    } finally { lock.current = false; }
  }
  return <form className="packing-form" onSubmit={event => void submit(event)} noValidate aria-label={item ? i18n.t("edit", { ns: "packing", value0: item.name }) : i18n.t("addPackingItem", { ns: "packing" })}>
    <label className="packing-name">{i18n.t("itemName", { ns: "packing" })}<input ref={nameInput} className="equipment-add-input" value={name} onChange={e => setName(e.target.value)} maxLength={120} required disabled={busy} autoFocus={!!item} placeholder={i18n.t("eGRainJacket", { ns: "packing" })} /></label>
    <label>{i18n.t("category", { ns: "common" })}<select className="equipment-add-input" value={category} onChange={e => setCategory(e.target.value as EquipmentCategory)} disabled={busy}>{EQUIPMENT_CATEGORIES.map(value => <option key={value} value={value}>{categories[value].label}</option>)}</select></label>
    <label>{i18n.t("quantity", { ns: "common" })}<input className="equipment-add-input" type="number" min={1} max={999} step={1} required value={count} onChange={e => setCount(e.target.value)} disabled={busy} /></label>
    <button className="btn btn-primary" disabled={busy} type="submit">{!item && <AddOutlined />}{busy ? t("saving", { ns: "common" }) : item ? i18n.t("saveChanges", { ns: "common" }) : i18n.t("addItem", { ns: "packing" })}</button>
    {onCancel && <button className="btn btn-secondary" type="button" onClick={onCancel} disabled={busy}>{t("cancel", { ns: "common" })}</button>}
    {error && <p className="packing-form-error" role="alert">{resolveMessage(error)}</p>}
  </form>;
}

function PackingChecklist({ id }: { id: string }) {
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const { t } = useTranslation("packing", { i18n });
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
  const [feedback, setFeedback] = useState<(() => string) | null>(null);
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
  async function act(action: () => Promise<unknown>, message: () => string) {
    if (busy || lock.current) return;
    lock.current = true;
    setFeedback(null);
    try { await action(); setFeedback(() => message); }
    catch { /* Mutation errors are displayed below; optimistic changes roll back. */ }
    finally { lock.current = false; }
  }
  return <section className="equipment-list-card" aria-labelledby="packing-title">
    <div className="equipment-list-header"><div><h2 className="equipment-list-title" id="packing-title">{t("checklistTitle")}</h2>
      {equipment.data && <p className="packing-muted">{i18n.t("packedCount", { ns: "packing", packed, count: items.length })}</p>}</div>
      {equipment.data && <strong>{percentage}%</strong>}
    </div>
    {equipment.data && <div className="packing-progress" role="progressbar" aria-label={i18n.t("packingCompletion", { ns: "packing" })} aria-valuenow={percentage} aria-valuemin={0} aria-valuemax={100}><div style={{ width: `${percentage}%` }} /></div>}
    <div className="packing-content">
      {equipment.isPending && <p role="status">{i18n.t("loadingPackingChecklist", { ns: "packing" })}</p>}
      {equipment.isError && <div role="alert"><p>{localizedError(equipment.error)}</p><button type="button" className="btn btn-secondary" disabled={equipment.isFetching} onClick={() => void equipment.refetch()}>{i18n.t("retryPackingList", { ns: "packing" })}</button></div>}
      {equipment.data && <>
        {items.length === 0 ? <div className="packing-empty"><BackpackOutlined aria-hidden="true" /><h3>{i18n.t("yourPackingListIsEmpty", { ns: "packing" })}</h3><p>{i18n.t("addYourEssentialsBelowOrGenerateSuggestionsBased", { ns: "packing" })}</p></div> : <>
          <div className="packing-filters" role="group" aria-label={i18n.t("filterPackingItems", { ns: "packing" })}>{["All", "To pack", "Packed"].map(value => <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)}>{i18n.t(value === "All" ? "all" : value === "Packed" ? "packed" : "toPack", { ns: "packing" })}</button>)}</div>
          <div className="packing-bulk-actions" role="group" aria-label={i18n.t("bulkPackingActions", { ns: "packing" })}>
            <button type="button" className="btn btn-secondary" disabled={busy || !!editing || !visible.some(item => !collapsed[item.category] && !item.packed)} onClick={() => prepareBulk(true)}>{i18n.t("packVisibleUnpackedItems", { ns: "packing" })}</button>
            <button type="button" className="btn btn-secondary" disabled={busy || !!editing || !visible.some(item => !collapsed[item.category] && item.packed)} onClick={() => prepareBulk(false)}>{i18n.t("unpackVisiblePackedItems", { ns: "packing" })}</button>
          </div>
          {packed === items.length && <p className="packing-success" role="status">{i18n.t("youAreAllPacked", { ns: "packing" })}</p>}
          {visible.length === 0 && <p className="packing-empty">{filter === "To pack" ? i18n.t("everythingIsPacked", { ns: "packing" }) : i18n.t("noPackedItemsYet", { ns: "packing" })}</p>}
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
                <label className="packing-item-label"><input type="checkbox" checked={item.packed} disabled={busy} onChange={() => void act(() => update.mutateAsync({ itemId: item.id, input: { packed: !item.packed } }), () => i18n.t(item.packed ? "unpackedItem" : "packedItem", { ns: "packing", name: item.name }))} /><span className={item.packed ? "packing-packed" : ""}>{item.name}</span></label>
                <span className="packing-quantity" aria-label={i18n.t("quantity", { ns: "packing", value0: item.count })}>&times;{item.count}</span>
                <button type="button" className="packing-icon-btn" aria-label={i18n.t("edit", { ns: "packing", value0: item.name })} disabled={busy} onClick={() => { editOrder.current = [...items].sort((a, b) => Number(a.packed) - Number(b.packed)).map(entry => entry.id); setEditing(item); }}><EditOutlined /></button>
                <button type="button" className="packing-icon-btn" aria-label={i18n.t("delete", { ns: "packing", value0: item.name })} disabled={busy} onClick={() => void act(() => remove.mutateAsync(item.id), () => i18n.t("deleted", { ns: "packing", value0: item.name }))}><DeleteOutlineOutlined /></button>
                {item.source === "ai" && <div className="packing-row-explanation"><span className="packing-ai-source">{i18n.t("aiSuggested", { ns: "packing" })}</span><details className="packing-item-details"><summary>{i18n.t("whyItem", { ns: "packing", name: item.name })}</summary><p>{item.reason || i18n.t("noExplanationWasSavedForThisItem", { ns: "packing" })}</p></details></div>}
              </li>)}</ul></Collapse>
            </section>;
          })}
        </>}
        {editing && <section className="packing-editor" aria-label={i18n.t("editPackingItem", { ns: "packing" })}><h3>{i18n.t("editItem", { ns: "packing" })}</h3><ItemForm key={editing.id} item={editing} busy={busy} onCancel={() => setEditing(null)} onSave={async input => { await update.mutateAsync({ itemId: editing.id, input }); setEditing(null); setFeedback(() => () => i18n.t("itemUpdated", { ns: "packing" })); }} /></section>}
        <div className="equipment-list-footer"><h3>{i18n.t("addAnItem", { ns: "packing" })}</h3><ItemForm busy={busy} onSave={async input => { await create.mutateAsync(input); setFeedback(() => () => i18n.t("itemAdded", { ns: "packing" })); }} /></div>
      </>}
      {(update.isError || remove.isError || bulk.isError) && <p role="alert">{localizedError(bulk.error ?? update.error ?? remove.error)}</p>}
      <Dialog className="packing-bulk-dialog" open={!!batch} onClose={() => { if (!bulk.isPending) setBatch(null); }} aria-labelledby="packing-bulk-title" maxWidth="xs" fullWidth>
        <DialogTitle id="packing-bulk-title">{i18n.t(batch?.packed ? "bulkTitlePack" : "bulkTitleUnpack", { ns: "packing", count: batch?.itemIds.length ?? 0 })}</DialogTitle>
        <DialogContent>{i18n.t("onlyTheItemsVisibleWhenYouStartedThis", { ns: "packing" })}{bulk.isError && <p role="alert">{localizedError(bulk.error)}</p>}
          {bulk.isPending && <p role="status">{i18n.t("updatingSelectedPackingItems", { ns: "packing" })}</p>}
        </DialogContent>
        <DialogActions><Button disabled={bulk.isPending} onClick={() => setBatch(null)}>{i18n.t("cancel", { ns: "common" })}</Button><Button variant="contained" disabled={bulk.isPending} onClick={() => void act(async () => { await bulk.mutateAsync(batch!); setBatch(null); }, () => i18n.t(batch?.packed ? "bulkPacked" : "bulkUnpacked", { ns: "packing", count: batch?.itemIds.length ?? 0 }))}>{bulk.isPending ? i18n.t("updating", { ns: "packing" }) : i18n.t("confirmPackingChange", { ns: "packing" })}</Button></DialogActions>
      </Dialog>
      <p className="packing-feedback" role="status">{busy ? i18n.t("savingPackingChecklist", { ns: "packing" }) : feedback?.()}</p>
    </div>
  </section>;
}

export default function TripEquipmentPage() {
  const { t } = useTranslation("packing", { i18n });
  const { id } = useParams<{ id: string }>();
  const trip = useTrip(id);
  const destination = trip.data?.analysis.destination ?? i18n.t("yourTrip", { ns: "packing" });
  const country = trip.data?.analysis.country;
  const days = trip.data?.analysis.durationDays;
  return <div className="equipment-page"><div className="equipment-inner">
    <Link className="equipment-back-btn" to={`/trips/${id}`}><ArrowBackOutlined />{i18n.t("backToTrip", { ns: "packing" })}</Link>
    <div className="equipment-hero-card"><div className="equipment-hero-content"><div className="equipment-hero-left">
      <div className="equipment-hero-icon"><BackpackOutlined /></div>
      <p className="equipment-hero-location">{[destination, country, days ? i18n.t("days", { ns: "common", count: days }) : null].filter(Boolean).join(" \u00b7 ")}</p>
      <h1 className="equipment-hero-title">{t("title")}</h1><p className="equipment-hero-subtitle">{i18n.t("getPackingSuggestionsBasedOnYourItineraryAnd", { ns: "packing" })}</p>
    </div><div className="equipment-hero-right">{id && <PackingSuggestions key={id} tripId={id} />}</div></div></div>
    {id && <PackingChecklist key={id} id={id} />}
  </div></div>;
}
