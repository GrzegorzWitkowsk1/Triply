import type { GuestIdentity, IdentitySession } from "@triply/shared";
import {
  createContext,
  useContext,
  useMemo,
  useEffect,
  useRef,
  useState,
  type PropsWithChildren,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getSession, startGuest, endGuest,
  login,
  logout,
  register,
  type AuthCredentials,
  type AuthUser,
} from "../api/auth";

const SESSION_QUERY_KEY = ["auth", "session"] as const;

interface AuthContextValue {
  user: AuthUser | null;
  guest: GuestIdentity | null;
  status: IdentitySession['status'] | 'loading';
  isGuest: boolean;
  isAuthenticated: boolean;
  canAccessAccountSettings: boolean;
  sessionExpired: boolean;
  startGuest: () => Promise<IdentitySession>;
  endGuest: () => Promise<void>;
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
  const [sessionExpired, setSessionExpired] = useState(false);
  const [readyIdentity, setReadyIdentity] = useState<string | null>(null);
  const sessionQuery = useQuery({
    queryKey: SESSION_QUERY_KEY,
    queryFn: getSession,
    retry: false,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    refetchInterval: 60_000,
  });
  const previousIdentity = useRef<string | null>(null);
  const sessionIdentity = sessionQuery.data?.status === "guest" ? `guest:${sessionQuery.data.guest.id}`
    : sessionQuery.data?.status === "authenticated" ? `user:${sessionQuery.data.user.id}` : "anonymous";
  useEffect(() => {
    const session = sessionQuery.data;
    if (!session) return;
    if (session.status === "anonymous" && session.reason === "GUEST_SESSION_EXPIRED") setSessionExpired(true);
    const identity = session.status === "guest" ? `guest:${session.guest.id}` : session.status === "authenticated" ? `user:${session.user.id}` : "anonymous";
    if (previousIdentity.current && previousIdentity.current !== identity) {
      if (previousIdentity.current.startsWith("guest:") && identity === "anonymous") setSessionExpired(true);
      void queryClient.cancelQueries({ predicate: q => q.queryKey[0] !== "auth" });
      queryClient.removeQueries({ predicate: q => q.queryKey[0] !== "auth" });
    }
    previousIdentity.current = identity;
    setReadyIdentity(identity);
  }, [sessionQuery.data, queryClient]);
  useEffect(() => {
    const expired = (event: Event) => {
      if ((event as CustomEvent).detail === "GUEST_SESSION_EXPIRED") setSessionExpired(true);
      void queryClient.invalidateQueries({ queryKey: SESSION_QUERY_KEY });
    };
    window.addEventListener("triply:session-expired", expired);
    return () => window.removeEventListener("triply:session-expired", expired);
  }, [queryClient]);

  const loginMutation = useMutation({
    mutationFn: login,
    onSuccess: async (user) => {
      setSessionExpired(false);
      await queryClient.cancelQueries();
      queryClient.removeQueries({ predicate: q => q.queryKey[0] !== "auth" });
      queryClient.setQueryData(SESSION_QUERY_KEY, { status: "authenticated", user });
    },
  });

  const registerMutation = useMutation({
    mutationFn: register,
    onSuccess: async (user) => {
      setSessionExpired(false);
      await queryClient.cancelQueries();
      queryClient.removeQueries({ predicate: q => q.queryKey[0] !== "auth" });
      queryClient.setQueryData(SESSION_QUERY_KEY, { status: "authenticated", user });
    },
  });

  const logoutMutation = useMutation({
    mutationFn: logout,
    onSuccess: async () => {
      previousIdentity.current = null;
      await queryClient.cancelQueries();
      queryClient.removeQueries({
        predicate: (query) => query.queryKey[0] !== "auth",
      });
      queryClient.setQueryData(SESSION_QUERY_KEY, { status: "anonymous" });
    },
  });

  const guestMutation = useMutation({ mutationFn: startGuest, onSuccess: async (session) => {
    setSessionExpired(false);
    await queryClient.cancelQueries();
    queryClient.removeQueries({ predicate: q => q.queryKey[0] !== 'auth' });
    queryClient.setQueryData(SESSION_QUERY_KEY, session);
  } });
  const endGuestMutation = useMutation({ mutationFn: endGuest, onSuccess: async () => {
    previousIdentity.current = null;
    await queryClient.cancelQueries();
    queryClient.removeQueries({ predicate: q => q.queryKey[0] !== 'auth' });
    queryClient.setQueryData(SESSION_QUERY_KEY, { status: 'anonymous' });
  } });
  const value = useMemo<AuthContextValue>(
    () => ({
      user: sessionQuery.data?.status === 'authenticated' ? sessionQuery.data.user : null,
      guest: sessionQuery.data?.status === 'guest' ? sessionQuery.data.guest : null,
      status: sessionQuery.isPending || readyIdentity !== sessionIdentity ? 'loading' : sessionQuery.data?.status ?? 'anonymous',
      isGuest: sessionQuery.data?.status === 'guest',
      isAuthenticated: sessionQuery.data?.status === 'authenticated',
      canAccessAccountSettings: sessionQuery.data?.status === 'authenticated',
      sessionExpired,
      startGuest: guestMutation.mutateAsync,
      endGuest: endGuestMutation.mutateAsync,
      isLoading: sessionQuery.isPending || readyIdentity !== sessionIdentity,
      error: sessionQuery.error ?? null,
      isSubmitting: loginMutation.isPending || registerMutation.isPending || guestMutation.isPending,
      isLoggingOut: logoutMutation.isPending || endGuestMutation.isPending,
      login: loginMutation.mutateAsync,
      register: registerMutation.mutateAsync,
      logout: logoutMutation.mutateAsync,
      refetchSession: sessionQuery.refetch,
      updateUser: (user) => queryClient.setQueryData(SESSION_QUERY_KEY, { status: "authenticated", user }),
    }),
    [
      queryClient, sessionExpired, readyIdentity, sessionIdentity, guestMutation.mutateAsync, guestMutation.isPending, endGuestMutation.mutateAsync, endGuestMutation.isPending,
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
