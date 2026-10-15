import { useMutation, useQueryClient, type UseMutationOptions } from "@tanstack/react-query";
import type { IdentitySession } from "@triply/shared";

function identity(client: ReturnType<typeof useQueryClient>): string {
  const session = client.getQueryData<IdentitySession>(["auth", "session"]);
  return session?.status === "guest" ? `guest:${session.guest.id}`
    : session?.status === "authenticated" ? `user:${session.user.id}` : "anonymous";
}

/** Query cancellation cannot stop mutations. Suppress their cache callbacks after identity changes. */
export function useIdentityMutation<TData = unknown, TError = Error, TVariables = void, TContext = unknown>(
  options: UseMutationOptions<TData, TError, TVariables, TContext>,
) {
  const client = useQueryClient();
  type Context = { identity: string; value: TContext | undefined };
  const current = (context: Context | undefined) => context?.identity === identity(client);
  return useMutation<TData, TError, TVariables, Context>({
    ...options,
    onMutate: async (variables, mutationContext) => {
      const startedAs = identity(client);
      const value = await options.onMutate?.(variables, mutationContext);
      return { identity: startedAs, value };
    },
    onSuccess: (data, variables, context, mutationContext) => {
      if (context && current(context)) return options.onSuccess?.(data, variables, context.value as TContext, mutationContext);
    },
    onError: (error, variables, context, mutationContext) => {
      if (current(context)) return options.onError?.(error, variables, context?.value, mutationContext);
    },
    onSettled: (data, error, variables, context, mutationContext) => {
      if (current(context)) return options.onSettled?.(data, error, variables, context?.value, mutationContext);
    },
  });
}
