// Stored rather than kept in memory: signing in always crosses a reload, both here
// and again for Google, Microsoft, Apple and SSO (applySessionTokenAndRefresh in main.js).
export const SIGN_IN_PROMPTED_AT_KEY = "signInPromptedAt";

/** Flowbase-Fork: Renderer-Event, auf das ControlPanel die Sektion „Flowbase-Konto“ öffnet. */
export const FLOWBASE_ACCOUNT_REQUEST_EVENT = "flowbase:open-account";

/**
 * Flowbase-Fork: Es gibt kein Upstream-Login mehr. Jeder „Anmelden“-Knopf öffnet das
 * Flowbase-Konto in den Einstellungen; Onboarding-Stand und Gast-Flags bleiben unberührt,
 * damit der Upstream-Reauthentifizierungs-Screen nie erscheint.
 */
export function requestSignIn(): void {
  window.dispatchEvent(new Event(FLOWBASE_ACCOUNT_REQUEST_EVENT));
}
