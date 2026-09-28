import { zodResolver } from "@hookform/resolvers/zod";
import { PersonOutlineOutlined, UploadOutlined } from "@mui/icons-material";
import { CircularProgress, TextField } from "@mui/material";
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { useAuth } from "../../auth/AuthProvider";
import {
  ACCEPTED_IMAGE_INPUT,
  isAcceptedImageType,
  MAX_IMAGE_SIZE,
  MAX_IMAGE_SIZE_LABEL,
} from "../../config/profile";
import { useUpdateProfile, useUploadAvatar } from "../../hooks/useProfile";
import { profileSchema, type ProfileFormValues } from "../../schemas/profile";
import { useToast } from "../ui/Toast";

export default function ProfileSettingsCard() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const updateProfileMutation = useUpdateProfile();
  const uploadAvatarMutation = useUploadAvatar();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isValid },
  } = useForm<ProfileFormValues>({
    resolver: zodResolver(profileSchema),
    mode: "onChange",
    defaultValues: {
      name: user?.name ?? "",
      surname: user?.surname ?? "",
    },
  });

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [avatarSrc, setAvatarSrc] = useState<string | null>(user?.avatarUrl ?? null);
  const [imageError, setImageError] = useState<string | null>(null);

  useEffect(() => {
    setAvatarSrc(user?.avatarUrl ?? null);
  }, [user?.avatarUrl]);

  const isUploading = uploadAvatarMutation.isPending;

  const onFilePicked = (list: FileList | null) => {
    setImageError(null);

    const file = list?.[0];

    if (!file) {
      return;
    }

    if (!isAcceptedImageType(file)) {
      setImageError("Only JPG and PNG images are allowed.");
      return;
    }

    if (file.size > MAX_IMAGE_SIZE) {
      setImageError(`Image is too large. Maximum size is ${MAX_IMAGE_SIZE_LABEL}.`);
      return;
    }

    const objectUrl = URL.createObjectURL(file);
    setAvatarSrc(objectUrl);

    uploadAvatarMutation.mutate(file, {
      onSuccess: () => {
        URL.revokeObjectURL(objectUrl);
        setImageError(null);
      },
      onError: (error: Error) => {
        URL.revokeObjectURL(objectUrl);
        setAvatarSrc(user?.avatarUrl ?? null);
        setImageError(
          error.message || "The avatar could not be uploaded. Try again.",
        );
      },
    });
  };

  const onSubmit = (values: ProfileFormValues) => {
    updateProfileMutation.mutate(values, {
      onSuccess: () => {
        showToast("Profile saved.");
        reset(values);
      },
      onError: (error: Error) => {
        showToast(error.message || "The profile could not be saved.", "error");
      },
    });
  };

  return (
    <form className="settings-card" onSubmit={handleSubmit(onSubmit)}>
      <input
        ref={fileInputRef}
        type="file"
        name="avatar"
        accept={ACCEPTED_IMAGE_INPUT}
        hidden
        onChange={(event) => {
          onFilePicked(event.target.files);
          event.target.value = "";
        }}
      />

      <div className="avatar-row">
        <div
          className={`avatar-upload${isUploading ? " is-uploading" : ""}`}
          onClick={() => {
            if (!isUploading) {
              fileInputRef.current?.click();
            }
          }}
          role="button"
          tabIndex={0}
          aria-label="Upload profile image"
          aria-busy={isUploading}
          onKeyDown={(event) => {
            if ((event.key === "Enter" || event.key === " ") && !isUploading) {
              event.preventDefault();
              fileInputRef.current?.click();
            }
          }}
        >
          {avatarSrc ? (
            <img src={avatarSrc} alt="Profile" />
          ) : (
            <PersonOutlineOutlined className="avatar-upload-icon" />
          )}
          <div className="avatar-upload-overlay">
            {isUploading ? (
              <CircularProgress size={20} color="primary" />
            ) : (
              <>
                <UploadOutlined />
                <span>Upload Image</span>
              </>
            )}
          </div>
        </div>
        <p className="avatar-hint">
          Customize your profile avatar to make it more yours!
        </p>
      </div>

      {imageError && (
        <p className="avatar-error" role="alert">
          {imageError}
        </p>
      )}

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
          disabled={!isValid || updateProfileMutation.isPending}
        >
          {updateProfileMutation.isPending ? "Saving..." : "Save"}
        </button>
      </div>
    </form>
  );
}
