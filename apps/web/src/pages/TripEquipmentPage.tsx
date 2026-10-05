import { useEffect, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import {
  AddOutlined,
  ArrowBackOutlined,
  BackpackOutlined,
  RemoveOutlined,
  DeleteOutlineOutlined,
  AutoAwesomeOutlined,
} from "@mui/icons-material";
import {
  useCreateEquipmentItem,
  useDeleteEquipmentItem,
  useTripEquipment,
  useUpdateEquipmentItem,
} from "../hooks/useTripEquipment";
import { useTrip } from "../hooks/useTrips";

interface EquipmentRow {
  id: string;
  name: string;
  count: number;
}

function EquipmentRowEditor({
  item,
  disabled,
  onCommit,
  onCount,
  onRemove,
}: {
  item: EquipmentRow;
  disabled: boolean;
  onCommit: (itemId: string, name: string) => void;
  onCount: (itemId: string, count: number) => void;
  onRemove: (itemId: string) => void;
}) {
  const [name, setName] = useState(item.name);
  const [count, setCount] = useState(String(item.count));

  useEffect(() => {
    setName(item.name);
  }, [item.name]);

  useEffect(() => {
    setCount(String(item.count));
  }, [item.count]);

  const commitName = () => {
    const trimmed = name.trim();

    if (trimmed.length === 0 || trimmed === item.name) {
      setName(item.name);
      return;
    }

    onCommit(item.id, trimmed);
  };

  const commitCount = (next: number) => {
    const clamped = Math.min(999, Math.max(1, next));
    setCount(String(clamped));

    if (clamped !== item.count) {
      onCount(item.id, clamped);
    }
  };

  return (
    <div className="equipment-item-row">
      <div className="equipment-item-left">
        <input
          type="text"
          className="equipment-item-input"
          value={name}
          disabled={disabled}
          onChange={(e) => setName(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.currentTarget.blur();
            }
          }}
          placeholder="Item name"
        />
      </div>
      <div className="equipment-item-right">
        <div className="equipment-counter">
          <button
            type="button"
            className="equipment-counter-btn"
            disabled={disabled || item.count <= 1}
            onClick={() => commitCount(item.count - 1)}
            aria-label="Decrease count"
          >
            <RemoveOutlined />
          </button>
          <input
            type="number"
            className="equipment-count-input"
            value={count}
            disabled={disabled}
            min="1"
            max="999"
            onChange={(e) => {
              const parsed = Number.parseInt(e.target.value, 10);
              setCount(e.target.value);

              if (Number.isFinite(parsed)) {
                onCount(item.id, Math.min(999, Math.max(1, parsed)));
              }
            }}
            onBlur={() => {
              const parsed = Number.parseInt(count, 10);

              if (!Number.isFinite(parsed) || parsed < 1) {
                setCount(String(item.count));
                return;
              }

              commitCount(parsed);
            }}
          />
          <button
            type="button"
            className="equipment-counter-btn"
            disabled={disabled || item.count >= 999}
            onClick={() => commitCount(item.count + 1)}
            aria-label="Increase count"
          >
            <AddOutlined />
          </button>
        </div>
        <button
          type="button"
          className="equipment-trash-btn"
          disabled={disabled}
          onClick={() => onRemove(item.id)}
          aria-label="Remove item"
        >
          <DeleteOutlineOutlined />
        </button>
      </div>
    </div>
  );
}

export default function TripEquipmentPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const trip = useTrip(id);
  const equipment = useTripEquipment(id);

  const createItem = useCreateEquipmentItem(id ?? "");
  const updateItem = useUpdateEquipmentItem(id ?? "");
  const deleteItem = useDeleteEquipmentItem(id ?? "");

  const [newItemName, setNewItemName] = useState("");
  const [newItemCount, setNewItemCount] = useState("1");

  const items = equipment.data ?? [];
  const itemCount = items.length;
  const busy = createItem.isPending || updateItem.isPending || deleteItem.isPending;

  const handleAddItem = () => {
    const count = Number.parseInt(newItemCount, 10);

    if (!newItemName.trim() || !Number.isFinite(count) || count < 1) {
      return;
    }

    createItem.mutate(
      { name: newItemName.trim(), count: Math.min(999, count) },
      {
        onSuccess: () => {
          setNewItemName("");
          setNewItemCount("1");
        },
      },
    );
  };

  const parsedCount = Number.parseInt(newItemCount, 10);
  const isAddButtonDisabled =
    busy ||
    newItemName.trim().length === 0 ||
    !Number.isFinite(parsedCount) ||
    parsedCount < 1;

  if (trip.isError) {
    return <Navigate to="/trips" replace />;
  }

  const destination = trip.data?.analysis.destination ?? "Your trip";
  const country = trip.data?.analysis.country;
  const days = trip.data?.analysis.durationDays;

  return (
    <div className="equipment-page">
      <div className="equipment-inner">
        <button
          type="button"
          className="equipment-back-btn"
          onClick={() => navigate(`/trips/${id}`)}
        >
          <ArrowBackOutlined />
          Back to trip
        </button>

        <div className="equipment-hero-card">
          <div className="equipment-hero-content">
            <div className="equipment-hero-left">
              <div className="equipment-hero-icon">
                <BackpackOutlined />
              </div>
              <p className="equipment-hero-location">
                {[country ? `${destination} · ${country}` : destination, days ? `${days} days` : null]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              <h1 className="equipment-hero-title">What to bring</h1>
              <p className="equipment-hero-subtitle">
                Keep the essentials together and let Triply adapt them to your
                itinerary.
              </p>
            </div>
            <div className="equipment-hero-right">
              <button type="button" className="btn btn-primary equipment-ai-btn">
                <AutoAwesomeOutlined />
                What should I take, triply?
              </button>
            </div>
          </div>
        </div>

        <div className="equipment-list-card">
          <div className="equipment-list-header">
            <div className="equipment-list-header-left">
              <h2 className="equipment-list-title">Packing list</h2>
              <p className="equipment-list-subtitle">{itemCount} items</p>
            </div>
            <div className="equipment-list-header-right">
              <div className="equipment-list-header-icon">
                <BackpackOutlined />
              </div>
            </div>
          </div>

          <div className="equipment-list-items">
            {equipment.isPending && <p className="equipment-list-subtitle">Loading…</p>}

            {equipment.isError && (
              <p className="equipment-list-subtitle">
                {equipment.error.message}
              </p>
            )}

            {!equipment.isPending && !equipment.isError && items.length === 0 && (
              <p className="equipment-list-subtitle">
                Nothing packed yet. Add your first item below.
              </p>
            )}

            {items.map((item) => (
              <EquipmentRowEditor
                key={item.id}
                item={item}
                disabled={busy}
                onCommit={(itemId, name) => updateItem.mutate({ itemId, input: { name } })}
                onCount={(itemId, count) => updateItem.mutate({ itemId, input: { count } })}
                onRemove={(itemId) => deleteItem.mutate(itemId)}
              />
            ))}
          </div>

          {createItem.isError && (
            <p className="equipment-list-subtitle">{createItem.error.message}</p>
          )}

          {updateItem.isError && (
            <p className="equipment-list-subtitle">{updateItem.error.message}</p>
          )}

          {deleteItem.isError && (
            <p className="equipment-list-subtitle">{deleteItem.error.message}</p>
          )}

          <div className="equipment-list-footer">
            <div className="equipment-add-form">
              <input
                type="text"
                className="equipment-add-input equipment-add-name"
                value={newItemName}
                onChange={(e) => setNewItemName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !isAddButtonDisabled) {
                    handleAddItem();
                  }
                }}
                placeholder="Rain Jacket"
              />
              <input
                type="number"
                className="equipment-add-input equipment-add-count"
                value={newItemCount}
                onChange={(e) => setNewItemCount(e.target.value)}
                placeholder="1"
                min="1"
                max="999"
              />
              <button
                type="button"
                className="btn btn-primary equipment-add-btn"
                onClick={handleAddItem}
                disabled={isAddButtonDisabled}
              >
                <AddOutlined />
                Add item
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}