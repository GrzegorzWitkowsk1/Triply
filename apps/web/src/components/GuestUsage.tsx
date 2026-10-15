import { Link } from "react-router-dom";
import { useGuestUsage } from "../hooks/useGuestUsage";

export default function GuestUsage() {
  const usage = useGuestUsage();
  if (!usage.isGuest) return null;
  if (usage.isPending) return <aside className="guest-usage" role="status">Loading guest limits…</aside>;
  if (usage.isError) return <aside className="guest-usage" role="alert">{usage.error.message} <button className="auth-link" onClick={() => void usage.refetch()}>Retry</button></aside>;
  const u = usage.data;
  if (!u) return null;
  return <aside className="guest-usage" aria-label="Guest usage">
    <strong>Guest Mode</strong>
    <span>Trips: {u.tripCount} / {u.tripLimit}</span>
    <span>AI generations remaining: {u.aiGenerationsRemaining} / {u.aiGenerationsLimit}</span>
    <span>AI day regenerations remaining: {u.dayRegenerationsRemaining} / {u.dayRegenerationsLimit}</span>
    <span>Up to {u.maxTripDays} calendar days per trip</span>
    {u.tripCount >= u.tripLimit && <p>You've reached the {u.tripLimit}-trip guest limit. Delete an existing trip to free a slot, or <Link to="/register">create an account</Link>. <Link to="/trips">Open your trips</Link>.</p>}
    {u.aiGenerationsRemaining === 0 && <p>You've used your {u.aiGenerationsLimit} itinerary generations for the last 24 hours. You can still view and edit your trips.{u.aiQuotaResetsAt && <> Next allowance: <time dateTime={u.aiQuotaResetsAt}>{new Date(u.aiQuotaResetsAt).toLocaleString()}</time>.</>}</p>}
    {u.dayRegenerationsRemaining === 0 && <p>Your AI day-regeneration allowance is used for the last 24 hours. Manual edits and preference-only previews remain available.{u.dayQuotaResetsAt && <> Next allowance: <time dateTime={u.dayQuotaResetsAt}>{new Date(u.dayQuotaResetsAt).toLocaleString()}</time>.</>}</p>}
    <small>After signing in, you can choose to import your guest trips.</small>
  </aside>;
}
