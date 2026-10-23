import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { FlowbaseModel, Session, Slot, StatusEvent } from "../bridge";
import { acceleratorParts, eventToAccelerator } from "./accelerator";
import iconUrl from "../../assets/icon.png";

const SLOTS: { slot: Slot; name: string; desc: string }[] = [
  { slot: "A", name: "Diktat", desc: "Sprechen, Text wird eingefügt" },
  { slot: "B", name: "Text → Sprachnachricht", desc: "Markierter Feldtext wird vertont" },
  { slot: "C", name: "Sprechen → Sprachnachricht", desc: "Gesprochenes wird zur Sprachnachricht" },
];

const fb = () => window.flowbase;

function Header({ version }: { version: string }) {
  return (
    <header className="fb-head">
      <img src={iconUrl} alt="" />
      <div>
        <h1 className="fb-title">Flowbase Stimme</h1>
        {version && <div className="fb-version">Version {version}</div>}
      </div>
    </header>
  );
}

function LoginCard({ onLoggedIn }: { onLoggedIn: (s: Session) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const r = await fb().login(email.trim(), password);
      if (r.ok) onLoggedIn(r.session);
      else setError(r.error);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Anmeldung fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="lg-panel lg-panel-hero" aria-labelledby="fb-login-title">
      <h2 className="fb-card-title" id="fb-login-title">
        Anmelden
      </h2>
      <p className="fb-hint" style={{ marginBottom: 12 }}>
        Mit deinem Flowbase-Konto anmelden.
      </p>
      <form className="fb-form" onSubmit={submit}>
        <label className="fb-label">
          E-Mail
          <input
            className="lg-input"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label className="fb-label">
          Passwort
          <input
            className="lg-input"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <button className="lg-btn-gold" type="submit" disabled={busy || !email || !password}>
          {busy ? "Wird angemeldet …" : "Anmelden"}
        </button>
        {error && (
          <p className="fb-error" role="alert">
            {error}
          </p>
        )}
      </form>
    </section>
  );
}

function AccountRow({ session, onLoggedOut }: { session: Session; onLoggedOut: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const label = session.name || session.email || "Flowbase-Konto";

  const logout = async () => {
    setBusy(true);
    setError("");
    try {
      const r = await fb().logout();
      if (r.ok) onLoggedOut();
      else setError(r.error);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Abmelden fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="lg-panel" aria-label="Konto">
      <div className="fb-account">
        <div className="fb-avatar" aria-hidden="true">
          {label.charAt(0).toUpperCase()}
        </div>
        <div className="fb-account-text">
          <div className="fb-account-name">{label}</div>
          {session.name && session.email && <div className="fb-account-mail">{session.email}</div>}
        </div>
        <button className="lg-btn-ghost" type="button" onClick={logout} disabled={busy}>
          Abmelden
        </button>
      </div>
      {error && (
        <p className="fb-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

function ModelCard({
  activeId,
  onActiveChange,
}: {
  activeId: string | null | undefined;
  onActiveChange: (id: string) => void;
}) {
  const [models, setModels] = useState<FlowbaseModel[] | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fb()
      .listModels()
      .then((r) => {
        if (!alive) return;
        if (r.ok) setModels(r.models);
        else {
          setModels([]);
          setError(r.error);
        }
      })
      .catch((err) => {
        if (!alive) return;
        setModels([]);
        setError(err instanceof Error ? err.message : "Models konnten nicht geladen werden.");
      });
    return () => {
      alive = false;
    };
  }, []);

  const choose = async (id: string) => {
    if (id === activeId || pending) return;
    setPending(id);
    setError("");
    try {
      const r = await fb().setActiveModel(id);
      if (r.ok) onActiveChange(id);
      else setError(r.error);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Model konnte nicht gesetzt werden.");
    } finally {
      setPending(null);
    }
  };

  return (
    <section className="lg-panel" aria-labelledby="fb-model-title">
      <h2 className="fb-card-title" id="fb-model-title">
        Model
      </h2>
      {models === null && <p className="fb-hint">Models werden geladen …</p>}
      {models?.length === 0 && !error && (
        <p className="fb-hint">Deinem Konto ist noch kein Model zugeordnet.</p>
      )}
      {models && models.length > 0 && (
        <div className="fb-models" role="radiogroup" aria-labelledby="fb-model-title">
          {models.map((m) => (
            <button
              key={m.id}
              type="button"
              role="radio"
              aria-checked={m.id === activeId}
              className="fb-model"
              onClick={() => choose(m.id)}
              disabled={pending !== null}
            >
              <span className="fb-radio" aria-hidden="true" />
              <span className="fb-model-name">{m.name}</span>
              {pending === m.id && <span className="fb-version">wird gesetzt …</span>}
            </button>
          ))}
        </div>
      )}
      {error && (
        <p className="fb-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

function ShortcutRow({
  slot,
  name,
  desc,
  accelerator,
  status,
  capturing,
  onCaptureStart,
  onCaptureEnd,
  onSaved,
}: {
  slot: Slot;
  name: string;
  desc: string;
  accelerator: string;
  status?: StatusEvent;
  capturing: boolean;
  onCaptureStart: () => void;
  onCaptureEnd: () => void;
  onSaved: (acc: string) => void;
}) {
  const [error, setError] = useState("");

  const save = useCallback(
    async (acc: string) => {
      setError("");
      try {
        const r = await fb().setShortcut(slot, acc);
        if (r.ok) onSaved(acc);
        else setError(r.error);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Kürzel konnte nicht gespeichert werden.");
      }
    },
    [slot, onSaved]
  );

  useEffect(() => {
    if (!capturing) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const r = eventToAccelerator(e);
      if (r.kind === "pending") return;
      if (r.kind === "invalid") {
        setError(r.error);
        return;
      }
      onCaptureEnd();
      if (r.kind === "cancel") setError("");
      else if (r.kind === "clear") save("");
      else save(r.accelerator);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [capturing, onCaptureEnd, save]);

  const keys = acceleratorParts(accelerator);

  return (
    <div className="fb-shortcut">
      <div className="fb-shortcut-row">
        <span className="fb-slot" aria-hidden="true">
          {slot}
        </span>
        <div className="fb-shortcut-text">
          <div className="fb-shortcut-name">{name}</div>
          <div className="fb-shortcut-desc">{desc}</div>
        </div>
        <button
          type="button"
          className="lg-btn-ghost"
          onClick={capturing ? onCaptureEnd : onCaptureStart}
          aria-pressed={capturing}
        >
          {capturing ? "Abbrechen" : "Ändern"}
        </button>
      </div>
      <div className="fb-keys" aria-live="polite">
        {capturing ? (
          <span className="fb-capture">Tastenkombination drücken … (Esc = abbrechen, Entf = aus)</span>
        ) : keys.length ? (
          <>
            <span className="sr-only">Kürzel: </span>
            {keys.map((k, i) => (
              <kbd className="fb-key" key={i}>
                {k}
              </kbd>
            ))}
          </>
        ) : (
          <span className="fb-keys-off">Aus</span>
        )}
      </div>
      {error && (
        <p className="fb-error" role="alert" style={{ marginLeft: 36 }}>
          {error}
        </p>
      )}
      {status && (
        <div className={`fb-status fb-phase-${status.phase}`} role="status">
          <span className="fb-dot" aria-hidden="true" />
          {status.message}
        </div>
      )}
    </div>
  );
}

function ShortcutCard({ statuses }: { statuses: Partial<Record<Slot, StatusEvent>> }) {
  const [shortcuts, setShortcuts] = useState<Record<Slot, string> | null>(null);
  const [capturing, setCapturing] = useState<Slot | null>(null);
  const [error, setError] = useState("");
  const endCapture = useCallback(() => setCapturing(null), []);

  useEffect(() => {
    fb()
      .getShortcuts()
      .then(setShortcuts)
      .catch((err) =>
        setError(err instanceof Error ? err.message : "Kürzel konnten nicht geladen werden.")
      );
  }, []);

  const saved = useCallback(
    (slot: Slot) => (acc: string) => setShortcuts((s) => (s ? { ...s, [slot]: acc } : s)),
    []
  );

  return (
    <section className="lg-panel" aria-labelledby="fb-shortcut-title">
      <h2 className="fb-card-title" id="fb-shortcut-title">
        Kürzel
      </h2>
      {error && (
        <p className="fb-error" role="alert">
          {error}
        </p>
      )}
      {shortcuts &&
        SLOTS.map((s) => (
          <ShortcutRow
            key={s.slot}
            {...s}
            accelerator={shortcuts[s.slot] ?? ""}
            status={statuses[s.slot]}
            capturing={capturing === s.slot}
            onCaptureStart={() => setCapturing(s.slot)}
            onCaptureEnd={endCapture}
            onSaved={saved(s.slot)}
          />
        ))}
    </section>
  );
}

function AutostartCard({ initial }: { initial: boolean }) {
  const [on, setOn] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => setOn(initial), [initial]);

  const toggle = async () => {
    const next = !on;
    setBusy(true);
    setError("");
    try {
      const r = await fb().setAutostart(next);
      if (r.ok) setOn(next);
      else setError(r.error);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Autostart konnte nicht geändert werden.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="lg-panel">
      <div className="fb-switch-row">
        <span className="fb-switch-label" id="fb-autostart">
          Mit Windows starten
        </span>
        <button
          type="button"
          role="switch"
          className="fb-switch"
          aria-checked={on}
          aria-labelledby="fb-autostart"
          onClick={toggle}
          disabled={busy}
        />
      </div>
      {error && (
        <p className="fb-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

export default function FlowbaseScreen() {
  const [session, setSession] = useState<Session | null>(null);
  const [appInfo, setAppInfo] = useState<{ version: string; autostart: boolean }>({
    version: "",
    autostart: false,
  });
  const [statuses, setStatuses] = useState<Partial<Record<Slot, StatusEvent>>>({});
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    document.body.classList.add("fb-main");
    fb()
      .getSession()
      .then(setSession)
      .catch((err) => {
        setLoadError(err instanceof Error ? err.message : "Sitzung konnte nicht geladen werden.");
        setSession({ loggedIn: false });
      });
    fb()
      .getAppInfo()
      .then(setAppInfo)
      .catch(() => {
        /* Version/Autostart sind Zusatzinfo; Bildschirm bleibt bedienbar. */
      });
    return fb().onStatus((s) => setStatuses((prev) => ({ ...prev, [s.slot]: s })));
  }, []);

  const loggedOut = () => {
    setStatuses({});
    setSession({ loggedIn: false });
  };

  return (
    <main className="fb-screen">
      <Header version={appInfo.version} />
      {loadError && (
        <p className="fb-error" role="alert">
          {loadError}
        </p>
      )}
      {session === null ? (
        <p className="fb-hint">Wird geladen …</p>
      ) : !session.loggedIn ? (
        <LoginCard onLoggedIn={setSession} />
      ) : (
        <>
          <AccountRow session={session} onLoggedOut={loggedOut} />
          <ModelCard
            activeId={session.activeModelId}
            onActiveChange={(id) => setSession((s) => (s ? { ...s, activeModelId: id } : s))}
          />
          <ShortcutCard statuses={statuses} />
          <AutostartCard initial={appInfo.autostart} />
        </>
      )}
    </main>
  );
}
