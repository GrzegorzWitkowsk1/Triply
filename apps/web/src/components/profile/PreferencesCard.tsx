import { useEffect, useState } from "react";
import { DEFAULT_PROFILE_PREFERENCES, PACE_VALUES, PROFILE_WALKING_LIMITS, type ProfilePreferences } from "@triply/shared";
import { useAuth } from "../../auth/AuthProvider";
import { saveProfilePreferences } from "../../api/profile";
import { useToast } from "../ToastProvider";
import PreferenceFields from "../trip/PreferenceFields";

export default function PreferencesCard() {
  const { user, updateUser } = useAuth();
  const toast = useToast();
  const [values, setValues] = useState<ProfilePreferences>(user?.preferences ?? DEFAULT_PROFILE_PREFERENCES);
  const [saving, setSaving] = useState(false);
  const savedValues = JSON.stringify(user?.preferences ?? DEFAULT_PROFILE_PREFERENCES);
  useEffect(() => { setValues(JSON.parse(savedValues) as ProfilePreferences); }, [user?.id, savedValues]);
  const save = async () => {
    setSaving(true);
    try { updateUser(await saveProfilePreferences(values)); toast("Preferences saved."); }
    catch (error) { toast(error instanceof Error ? error.message : "Could not save preferences.", "error"); }
    finally { setSaving(false); }
  };
  return <form className="settings-card" onSubmit={event => { event.preventDefault(); void save(); }}>
    <PreferenceFields disabled={saving} tags={values.interests}
      onToggleTag={id => setValues(current => ({ ...current, interests: current.interests.includes(id as ProfilePreferences["interests"][number]) ? current.interests.filter(tag => tag !== id) : [...current.interests, id as ProfilePreferences["interests"][number]] }))}
      pace={PACE_VALUES.indexOf(values.pace)} onPaceChange={index => setValues(current => ({ ...current, pace: PACE_VALUES[index] }))}
      walking={PROFILE_WALKING_LIMITS.indexOf(values.maxWalkingDistanceKm)} onWalkingChange={index => setValues(current => ({ ...current, maxWalkingDistanceKm: PROFILE_WALKING_LIMITS[index] }))} />
    <div className="settings-footer"><button type="submit" className="btn btn-primary settings-submit" disabled={saving}>Save</button></div>
  </form>;
}
