import { publicTripSchema, sharingLinkSchema, sharingStatusSchema } from "@triply/shared";
import { request } from "./client";

export const getSharingStatus = async (id: string) => sharingStatusSchema.parse(await request(`/api/trips/${id}/sharing`, { cache: "no-store" }));
export const createShareLink = async (id: string, rotate = false) => sharingLinkSchema.parse(await request(`/api/trips/${id}/sharing${rotate ? "/rotate" : ""}`, { method: "POST", cache: "no-store" }));
export const disableSharing = async (id: string) => sharingStatusSchema.parse(await request(`/api/trips/${id}/sharing`, { method: "DELETE", cache: "no-store" }));
export const getPublicTrip = async (token: string, signal?: AbortSignal) => publicTripSchema.parse(await request(`/api/public/trips/${encodeURIComponent(token)}`, { credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer", signal }));
