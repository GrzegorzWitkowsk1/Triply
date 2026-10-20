import { Button } from "@mui/material";
import { useNavigate } from "react-router-dom";
import { tripPlanningUrl } from "../config/tripPlanning";

export default function DestinationPlanButton({ destinationId, collectionSlug }: { destinationId: string; collectionSlug?: string }) {
  const navigate = useNavigate();
  return <Button variant="contained" onClick={event => {
    event.preventDefault(); event.stopPropagation(); navigate(tripPlanningUrl(destinationId, collectionSlug));
  }} sx={{ minHeight: 44 }}>Plan a trip</Button>;
}
