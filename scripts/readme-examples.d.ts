// What the README examples leave to the partner: their runtime, their auth and
// their UI. check-readme-examples.mjs compiles every example against these.

declare const process: { env: Record<string, string | undefined> };

declare function getSignedInUser(request: Request): Promise<{ id: string; email: string } | null>;
declare function startCheckout(companyId: string): void;
declare function showSupportMessage(): void;
