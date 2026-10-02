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
import { getTripDetail } from "../config/trip";

interface EquipmentItem {
  id: string;
  name: string;
  count: number;
}

export default function TripEquipmentPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const detail = id ? getTripDetail(id) : undefined;

  const [items, setItems] = useState<EquipmentItem[]>([
    { id: "1", name: "Passport & ID", count: 1 },
    { id: "2", name: "Toiletries", count: 2 },
    { id: "3", name: "Power bank", count: 1 },
  ]);

  const [newItemName, setNewItemName] = useState("");
  const [newItemCount, setNewItemCount] = useState("1");

  const itemCount = items.length;

  const handleAddItem = () => {
    const count = parseInt(newItemCount, 10);
    if (!newItemName.trim() || isNaN(count) || count < 1) {
      return;
    }
    const newItem: EquipmentItem = {
      id: Date.now().toString(),
      name: newItemName.trim(),
      count,
    };
    setItems((prev) => [...prev, newItem]);
    setNewItemName("");
    setNewItemCount("1");
  };

  const handleIncrement = (itemId: string) => {
    setItems((prev) =>
      prev.map((item) =>
        item.id === itemId ? { ...item, count: item.count + 1 } : item
      )
    );
  };

  const handleDecrement = (itemId: string) => {
    setItems((prev) =>
      prev.map((item) =>
        item.id === itemId
          ? { ...item, count: Math.max(1, item.count - 1) }
          : item
      )
    );
  };

  const handleItemNameChange = (itemId: string, name: string) => {
    setItems((prev) =>
      prev.map((item) => (item.id === itemId ? { ...item, name } : item))
    );
  };

  const handleItemCountChange = (itemId: string, countStr: string) => {
    const count = parseInt(countStr, 10);
    if (isNaN(count) || count < 1) {
      setItems((prev) =>
        prev.map((item) => (item.id === itemId ? { ...item, count: 1 } : item))
      );
      return;
    }
    setItems((prev) =>
      prev.map((item) => (item.id === itemId ? { ...item, count } : item))
    );
  };

  const handleRemoveItem = (itemId: string) => {
    setItems((prev) => prev.filter((item) => item.id !== itemId));
  };

  const isAddButtonDisabled =
    !newItemName.trim() ||
    isNaN(parseInt(newItemCount, 10)) ||
    parseInt(newItemCount, 10) < 1;

  if (!detail) return <Navigate to="/trips" replace />;

  const { city, country, days } = detail;

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
                {city} · {days} days
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
            {items.map((item) => (
              <div key={item.id} className="equipment-item-row">
                <div className="equipment-item-left">
                  <input
                    type="text"
                    className="equipment-item-input"
                    value={item.name}
                    onChange={(e) =>
                      handleItemNameChange(item.id, e.target.value)
                    }
                    placeholder="Item name"
                  />
                </div>
                <div className="equipment-item-right">
                  <div className="equipment-counter">
                    <button
                      type="button"
                      className="equipment-counter-btn"
                      onClick={() => handleDecrement(item.id)}
                      aria-label="Decrease count"
                    >
                      <RemoveOutlined />
                    </button>
                    <input
                      type="number"
                      className="equipment-count-input"
                      value={item.count}
                      onChange={(e) =>
                        handleItemCountChange(item.id, e.target.value)
                      }
                      min="1"
                    />
                    <button
                      type="button"
                      className="equipment-counter-btn"
                      onClick={() => handleIncrement(item.id)}
                      aria-label="Increase count"
                    >
                      <AddOutlined />
                    </button>
                  </div>
                  <button
                    type="button"
                    className="equipment-trash-btn"
                    onClick={() => handleRemoveItem(item.id)}
                    aria-label="Remove item"
                  >
                    <DeleteOutlineOutlined />
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="equipment-list-footer">
            <div className="equipment-add-form">
              <input
                type="text"
                className="equipment-add-input equipment-add-name"
                value={newItemName}
                onChange={(e) => setNewItemName(e.target.value)}
                placeholder="Rain Jacket"
              />
              <input
                type="number"
                className="equipment-add-input equipment-add-count"
                value={newItemCount}
                onChange={(e) => setNewItemCount(e.target.value)}
                placeholder="1"
                min="1"
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
