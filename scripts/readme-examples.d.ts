// What the README examples leave to the partner: their runtime, their auth and
// their UI. check-readme-examples.mjs compiles every example against these.

declare const process: { env: Record<string, string | undefined> };

// Just enough of Express for the example that adapts the session route to it.
interface ExpressResponse {
  status(code: number): ExpressResponse;
  json(body: unknown): void;
  end(): void;
}
declare const app: {
  post(path: string, handler: (req: unknown, res: ExpressResponse) => Promise<void>): void;
};

declare function getSignedInUser(request: unknown): Promise<{ id: string; email: string } | null>;
declare function startCheckout(companyId: string): void;
declare function showSupportMessage(): void;
