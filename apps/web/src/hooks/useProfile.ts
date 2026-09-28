import { useMutation } from "@tanstack/react-query";
import { useAuth } from "../auth/AuthProvider";
import {
  changePassword,
  updateProfile,
  uploadAvatar,
  type PasswordChangeInput,
  type ProfileDetails,
} from "../api/profile";

export function useUpdateProfile() {
  const { applyUser } = useAuth();

  return useMutation({
    mutationFn: (details: ProfileDetails) => updateProfile(details),
    onSuccess: (user) => {
      applyUser(user);
    },
  });
}

export function useUploadAvatar() {
  const { applyUser } = useAuth();

  return useMutation({
    mutationFn: (file: File) => uploadAvatar(file),
    onSuccess: (user) => {
      applyUser(user);
    },
  });
}

export function useChangePassword() {
  const { refetchSession } = useAuth();

  return useMutation({
    mutationFn: (input: PasswordChangeInput) => changePassword(input),
    onSuccess: () => {
      void refetchSession();
    },
  });
}
