import { resolveMessage } from "../../i18n/errors";
import { errorKey as localizedErrorKey, errorMessage as localizedError } from "../../i18n/errors";
import { useTranslation } from "react-i18next";
import i18n from "../../i18n";
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
  useTranslation();
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
      setImageError("auth/profile:onlyJpgJpegPngAndSvgImagesAre");
      return;
    }
    if (file.size > MAX_IMAGE_SIZE) {
      setImageError("auth/profile:imageIsTooLargeMaximumSizeIs2");
      return;
    }

    setUploading(true);
    try { updateUser(await uploadAvatar(file)); toast(() => i18n.t("avatarUpdated", { ns: "auth/profile" })); }
    catch (error) { setImageError(localizedErrorKey(error)); toast(() => localizedError(error), "error"); }
    finally { setUploading(false); }
  };

  const onSubmit = async (values: ProfileFormValues) => {
    setSaving(true);
    try { updateUser(await saveProfileNames({ ...(dirtyFields.name ? { name: values.name } : {}), ...(dirtyFields.surname ? { surname: values.surname } : {}) })); toast(() => i18n.t("profileSaved", { ns: "auth/profile" })); }
    catch (error) { toast(() => localizedError(error), "error"); }
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
          aria-label={i18n.t("uploadProfileImage", { ns: "auth/profile" })}
        >
          {user?.avatar ? (
            <img src={user.avatar} alt={i18n.t("profile", { ns: "auth/profile" })} />
          ) : (
            <PersonOutlineOutlined className="avatar-upload-icon" />
          )}
          <div className="avatar-upload-overlay">
            <UploadOutlined />
            <span>{uploading ? i18n.t("uploading", { ns: "auth/profile" }) : i18n.t("uploadImage", { ns: "auth/profile" })}</span>
          </div>
        </div>
        <p className="avatar-hint">
          {i18n.t("jpgJpegPngOrSvgUpTo2", { ns: "auth/profile" })}</p>
      </div>

      {imageError && <p className="avatar-error" role="alert">{resolveMessage(imageError)}</p>}

      <div className="settings-form-row">
        <TextField
          label={i18n.t("name", { ns: "auth/profile" })}
          fullWidth
          error={!!errors.name}
          helperText={(errors.name?.message ? i18n.t(errors.name?.message!) : undefined)}
          {...register("name")}
        />
        <TextField
          label={i18n.t("surname", { ns: "auth/profile" })}
          fullWidth
          error={!!errors.surname}
          helperText={(errors.surname?.message ? i18n.t(errors.surname?.message!) : undefined)}
          {...register("surname")}
        />
      </div>

      <TextField
        label={i18n.t("email", { ns: "auth/profile" })}
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
          {i18n.t("save", { ns: "common" })}</button>
      </div>
    </form>
  );
}
