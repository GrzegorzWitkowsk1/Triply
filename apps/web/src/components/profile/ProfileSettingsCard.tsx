import { zodResolver } from "@hookform/resolvers/zod";
import { PersonOutlineOutlined, UploadOutlined } from "@mui/icons-material";
import { TextField } from "@mui/material";
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { useAuth } from "../../auth/AuthProvider";
import {
  ACCEPTED_IMAGE_TYPES,
  MAX_IMAGE_SIZE,
} from "../../config/profile";
import { profileSchema, type ProfileFormValues } from "../../schemas/profile";
import { saveProfileNames, uploadAvatar } from "../../api/profile";
import { useToast } from "../ToastProvider";

export default function ProfileSettingsCard() {
  const { user, updateUser } = useAuth();
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isValid, dirtyFields },
  } = useForm<ProfileFormValues>({
    resolver: zodResolver(profileSchema),
    mode: "onChange",
    defaultValues: {
      name: user?.name ?? "",
      surname: user?.surname ?? "",
    },
  });
  useEffect(() => { reset({ name: user?.name ?? "", surname: user?.surname ?? "" }); }, [user?.id, user?.name, user?.surname, reset]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [imageError, setImageError] = useState<string | null>(null);

  const onFilePicked = async (list: FileList | null) => {
    setImageError(null);
    const file = list?.[0];
    if (!file) return;

    if (!(ACCEPTED_IMAGE_TYPES as readonly string[]).includes(file.type)) {
      setImageError("Only JPG, JPEG, PNG and SVG images are allowed.");
      return;
    }
    if (file.size > MAX_IMAGE_SIZE) {
      setImageError("Image is too large. Maximum size is 2 MB.");
      return;
    }

    setUploading(true);
    try { updateUser(await uploadAvatar(file)); toast("Avatar updated."); }
    catch (error) { const message = error instanceof Error ? error.message : "Avatar upload failed."; setImageError(message); toast(message, "error"); }
    finally { setUploading(false); }
  };

  const onSubmit = async (values: ProfileFormValues) => {
    setSaving(true);
    try { updateUser(await saveProfileNames({ ...(dirtyFields.name ? { name: values.name } : {}), ...(dirtyFields.surname ? { surname: values.surname } : {}) })); toast("Profile saved."); }
    catch (error) { toast(error instanceof Error ? error.message : "Could not save profile.", "error"); }
    finally { setSaving(false); }
  };

  return (
    <form className="settings-card" onSubmit={handleSubmit(onSubmit)}>
      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPTED_IMAGE_TYPES.join(",")}
        hidden
        disabled={uploading}
        onChange={(e) => {
          onFilePicked(e.target.files);
          e.target.value = "";
        }}
      />

      <div className="avatar-row">
        <div
          className="avatar-upload"
          onClick={() => fileInputRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); fileInputRef.current?.click(); } }}
          aria-label="Upload profile image"
        >
          {user?.avatar ? (
            <img src={user.avatar} alt="Profile" />
          ) : (
            <PersonOutlineOutlined className="avatar-upload-icon" />
          )}
          <div className="avatar-upload-overlay">
            <UploadOutlined />
            <span>{uploading ? "Uploading…" : "Upload Image"}</span>
          </div>
        </div>
        <p className="avatar-hint">
          JPG, JPEG, PNG or SVG, up to 2 MB. JPG/PNG: max 2048 × 2048 px.
        </p>
      </div>

      {imageError && <p className="avatar-error">{imageError}</p>}

      <div className="settings-form-row">
        <TextField
          label="Name"
          fullWidth
          error={!!errors.name}
          helperText={errors.name?.message}
          {...register("name")}
        />
        <TextField
          label="Surname"
          fullWidth
          error={!!errors.surname}
          helperText={errors.surname?.message}
          {...register("surname")}
        />
      </div>

      <TextField
        label="Email"
        fullWidth
        value={user?.email ?? ""}
        slotProps={{ input: { readOnly: true } }}
      />

      <div className="settings-footer">
        <button
          type="submit"
          className="btn btn-primary settings-submit"
          disabled={!isValid || saving || (!dirtyFields.name && !dirtyFields.surname)}
        >
          Save
        </button>
      </div>
    </form>
  );
}
