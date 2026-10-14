import {
  createContext,
  useContext,
  useMemo,
  type PropsWithChildren,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getSession,
  login,
  logout,
  register,
  type AuthCredentials,
  type AuthUser,
} from "../api/auth";

const SESSION_QUERY_KEY = ["auth", "session"] as const;

interface AuthContextValue {
  user: AuthUser | null;
  isLoading: boolean;
  error: Error | null;
  isSubmitting: boolean;
  isLoggingOut: boolean;
  login: (credentials: AuthCredentials) => Promise<AuthUser>;
  register: (credentials: AuthCredentials) => Promise<AuthUser>;
  logout: () => Promise<void>;
  refetchSession: () => Promise<unknown>;
  updateUser: (user: AuthUser) => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: PropsWithChildren) {
  const queryClient = useQueryClient();
  const sessionQuery = useQuery({
    queryKey: SESSION_QUERY_KEY,
    queryFn: getSession,
    retry: false,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    refetchInterval: 60_000,
  });

  const loginMutation = useMutation({
    mutationFn: login,
    onSuccess: (user) => {
      queryClient.setQueryData(SESSION_QUERY_KEY, user);
    },
  });

  const registerMutation = useMutation({
    mutationFn: register,
    onSuccess: (user) => {
      queryClient.setQueryData(SESSION_QUERY_KEY, user);
    },
  });

  const logoutMutation = useMutation({
    mutationFn: logout,
    onSettled: () => {
      queryClient.removeQueries({
        predicate: (query) => query.queryKey[0] !== "auth",
      });
      queryClient.setQueryData(SESSION_QUERY_KEY, null);
    },
  });

  const value = useMemo<AuthContextValue>(
    () => ({
      user: sessionQuery.data ?? null,
      isLoading: sessionQuery.isPending,
      error: sessionQuery.error ?? null,
      isSubmitting: loginMutation.isPending || registerMutation.isPending,
      isLoggingOut: logoutMutation.isPending,
      login: loginMutation.mutateAsync,
      register: registerMutation.mutateAsync,
      logout: logoutMutation.mutateAsync,
      refetchSession: sessionQuery.refetch,
      updateUser: (user) => queryClient.setQueryData(SESSION_QUERY_KEY, user),
    }),
    [
      queryClient,
      loginMutation.isPending,
      loginMutation.mutateAsync,
      logoutMutation.isPending,
      logoutMutation.mutateAsync,
      registerMutation.isPending,
      registerMutation.mutateAsync,
      sessionQuery.data,
      sessionQuery.error,
      sessionQuery.isPending,
      sessionQuery.refetch,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }

  return context;
}
