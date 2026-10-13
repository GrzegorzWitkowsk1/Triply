import type { FastifyRequest } from "fastify";

/** Input stays unknown until the existing Zod validators accept it. */
export interface HttpRoute {
  Params: Record<string, string>;
  Querystring: Record<string, string | string[]>;
  Body: unknown;
}
export type HttpRequest = FastifyRequest<HttpRoute>;
