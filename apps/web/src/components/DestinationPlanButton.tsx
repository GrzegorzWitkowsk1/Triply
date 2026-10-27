import { useTranslation } from "react-i18next";
import i18n from "../i18n";
import { Button } from "@mui/material";
import { useNavigate } from "react-router-dom";
import { tripPlanningUrl } from "../config/tripPlanning";

export default function DestinationPlanButton({ destinationId, collectionSlug }: { destinationId: string; collectionSlug?: string }) {
  useTranslation();
  const navigate = useNavigate();
  return <Button variant="contained" onClick={event => {
    event.preventDefault(); event.stopPropagation(); navigate(tripPlanningUrl(destinationId, collectionSlug));
  }} sx={{ minHeight: 44 }}>{i18n.t("planATrip", { ns: "saved" })}</Button>;
}
