import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { NOTIFICATIONS, Notification } from "../config/notifications";

export const NOTIFICATIONS_KEY = ["notifications"] as const;

function fetchNotifications(): Promise<Notification[]> {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve(
        [...NOTIFICATIONS].sort(
          (a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        )
      );
    }, 400);
  });
}

export function useNotifications() {
  return useQuery({
    queryKey: NOTIFICATIONS_KEY,
    queryFn: fetchNotifications,
  });
}

export function useMarkNotificationRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await new Promise((resolve) => setTimeout(resolve, 150));
      return id;
    },
    onMutate: async (id: string) => {
      await queryClient.cancelQueries({ queryKey: NOTIFICATIONS_KEY });
      const previous = queryClient.getQueryData<Notification[]>(
        NOTIFICATIONS_KEY
      );
      queryClient.setQueryData<Notification[]>(NOTIFICATIONS_KEY, (current) =>
        current?.map((notification) =>
          notification.id === id
            ? { ...notification, isRead: true }
            : notification
        )
      );
      return { previous };
    },
    onError: (_error, _id, context) => {
      if (context?.previous) {
        queryClient.setQueryData<Notification[]>(
          NOTIFICATIONS_KEY,
          context.previous
        );
      }
    },
  });
}

export function useMarkAllNotificationsRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      await new Promise((resolve) => setTimeout(resolve, 150));
    },
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: NOTIFICATIONS_KEY });
      const previous = queryClient.getQueryData<Notification[]>(
        NOTIFICATIONS_KEY
      );
      queryClient.setQueryData<Notification[]>(NOTIFICATIONS_KEY, (current) =>
        current?.map((notification) => ({ ...notification, isRead: true }))
      );
      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData<Notification[]>(
          NOTIFICATIONS_KEY,
          context.previous
        );
      }
    },
  });
}