import { useEffect, useRef, useState } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import { destinationQuerySchema, type DestinationQuery } from "@triply/shared";

export function readExploreQuery(params: URLSearchParams): DestinationQuery {
  const fields = destinationQuerySchema.shape;
  const country = fields.country.catch("").parse(params.get("country") ?? undefined);
  const region = fields.region.catch("").parse(params.get("region") ?? undefined);
  return {
    q: fields.q.catch("").parse(params.get("q") ?? undefined), country,
    region: country && region.startsWith(`${country}:`) ? region : "",
    interests: fields.interests.catch([]).parse(params.get("interests") ?? undefined),
    sort: fields.sort.parse(params.get("sort") ?? undefined),
    page: fields.page.catch(1).parse(params.get("page") ?? undefined), pageSize: 24,
  };
}
export function exploreParams(query: DestinationQuery): URLSearchParams {
  const params = new URLSearchParams();
  if (query.q) params.set("q", query.q);
  if (query.country) params.set("country", query.country);
  if (query.region) params.set("region", query.region);
  if (query.interests.length) params.set("interests", query.interests.join(","));
  if (query.sort !== "name-asc") params.set("sort", query.sort);
  if (query.page > 1) params.set("page", String(query.page));
  return params;
}
export function useExploreState() {
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const query = readExploreQuery(params);
  const [draft, setDraft] = useState(query.q);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // A navigation (including Back/Forward) cancels pending typing instead of replaying it.
  useEffect(() => {
    clearTimeout(timer.current); setDraft(query.q);
  }, [location.key, query.q]);
  useEffect(() => () => clearTimeout(timer.current), []);
  const update = (changes: Partial<DestinationQuery>, replace = false) => {
    clearTimeout(timer.current);
    const next = { ...query, q: draft.trim().replace(/\s+/gu, " "), page: 1, ...changes };
    if (changes.country !== undefined) next.region = "";
    setDraft(next.q); setParams(exploreParams(next), { replace });
  };
  const search = (value: string) => {
    clearTimeout(timer.current); setDraft(value);
    if (!value.trim()) { update({ q: "" }, true); return; }
    timer.current = setTimeout(() => update({ q: value.trim().replace(/\s+/gu, " ") }, true), 300);
  };
  return { query, draft, search, update,
    clear: () => update({ q: "", country: "", region: "", interests: [], sort: "name-asc", page: 1 }),
    canonicalizePage: (page: number) => {
      // A late result for an old page must not cancel the user's pending search.
      if (draft.trim().replace(/\s+/gu, " ") !== query.q) return;
      setParams(exploreParams({ ...query, page }), { replace: true });
    },
  };
}
