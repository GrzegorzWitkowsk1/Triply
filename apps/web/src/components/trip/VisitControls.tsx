import { Button, Chip, Stack } from "@mui/material";
import { useTranslation } from "react-i18next";
import type { VisitStatus } from "@triply/shared";
import { CheckCircleOutlined, SkipNextOutlined, ScheduleOutlined, UndoOutlined } from "@mui/icons-material";

export interface VisitControlsProps {
  itemId: string;
  name: string;
  status: VisitStatus;
  disabled?: boolean;
  onChange: (itemId: string, status: VisitStatus) => void;
}

export default function VisitControls({ itemId, name, status, disabled, onChange }: VisitControlsProps) {
  const { t } = useTranslation("itinerary/visits");
  return <Stack className="visit-controls" direction="row" useFlexGap sx={{ gap: { xs: .5, sm: 1 }, alignItems: "center", flexWrap: "nowrap", padding: { xs: 0, sm: 1 } }}>
    <Chip size="small" icon={status === "visited" ? <CheckCircleOutlined /> : status === "skipped" ? <SkipNextOutlined /> : <ScheduleOutlined />} label={t(status)} color={status === "visited" ? "success" : "default"} variant={status === "skipped" ? "outlined" : "filled"} />
    {(["visited", "skipped", "planned"] as const).filter(next => next !== status && (next !== "planned" || status !== "planned")).map(next =>
      <Button key={next} size="small" disabled={disabled} aria-label={t(`${next}Label`, { name })} title={t(`${next}Label`, { name })}
        onClick={() => onChange(itemId, next)}><span className="visit-action-icon" aria-hidden="true">{next === "visited" ? <CheckCircleOutlined fontSize="small" /> : next === "skipped" ? <SkipNextOutlined fontSize="small" /> : <UndoOutlined fontSize="small" />}</span><span className="visit-action-text">{t(`${next}Action`)}</span></Button>)}
  </Stack>;
}
