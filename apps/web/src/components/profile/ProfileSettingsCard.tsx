import { zodResolver } from "@hookform/resolvers/zod";
import { PersonOutlineOutlined, UploadOutlined } from "@mui/icons-material";
import { TextField } from "@mui/material";
import { useRef, useState } from "react";
import { useForm } from "react-hook-form";
import {
  ACCEPTED_IMAGE_TYPES,
  MAX_IMAGE_SIZE,
  PROFILE_FORM_DEFAULTS,
} from "../../config/profile";
import { profileSchema, type ProfileFormValues } from "../../schemas/profile";

export default function ProfileSettingsCard() {
  const {
    register,
    handleSubmit,
    formState: { errors, isValid },
  } = useForm<ProfileFormValues>({
    resolver: zodResolver(profileSchema),
    mode: "onChange",
    defaultValues: {
      name: PROFILE_FORM_DEFAULTS.name,
      surname: PROFILE_FORM_DEFAULTS.surname,
      email: PROFILE_FORM_DEFAULTS.email,
    },
  });

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [avatar, setAvatar] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);

  const onFilePicked = (list: FileList | null) => {
    setImageError(null);
    const file = list?.[0];
    if (!file) return;

    if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
      setImageError("Only JPG and PNG images are allowed.");
      return;
    }
    if (file.size > MAX_IMAGE_SIZE) {
      setImageError("Image is too large. Maximum size is 5 MB.");
      return;
    }

    setAvatar(URL.createObjectURL(file));
  };

  const onSubmit = (values: ProfileFormValues) => {
    void values;
  };

  return (
    <form className="settings-card" onSubmit={handleSubmit(onSubmit)}>
      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPTED_IMAGE_TYPES.join(",")}
        hidden
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
          aria-label="Upload profile image"
        >
          {avatar ? (
            <img src={avatar} alt="Profile" />
          ) : (
            <PersonOutlineOutlined className="avatar-upload-icon" />
          )}
          <div className="avatar-upload-overlay">
            <UploadOutlined />
            <span>Upload Image</span>
          </div>
        </div>
        <p className="avatar-hint">
          Customize your profile avatar to make it more yours!
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
        value={PROFILE_FORM_DEFAULTS.email}
        slotProps={{ input: { readOnly: true } }}
      />

      <div className="settings-footer">
        <button
          type="submit"
          className="btn btn-primary settings-submit"
          disabled={!isValid}
        >
          Save
        </button>
      </div>
    </form>
  );
}