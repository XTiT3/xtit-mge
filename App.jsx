import React, { useEffect, useRef, useState } from "react";

/* ==========================================================================
   CONFIG - change these values easily
   ========================================================================== */
const KINGDOM = "4161";
const SITE_NAME = "XTiT";

// Single admin password (prototype only - see note at the bottom).
const ADMIN_PASSWORD = "xtit4161";

const STORAGE_KEY = "xtit_mge_applications_4161";
const SETTINGS_KEY = "xtit_mge_settings_4161";
const SESSION_KEY = "xtit_admin_session";

const MAX_IMAGE_SIDE = 1400; // screenshots are downscaled to keep storage small
const ACCEPTED_TYPES = ["image/png", "image/jpeg", "image/webp"];
const STATUSES = ["Pending", "Approved", "Rejected"];

const STATUS_MESSAGES = {
  Pending: "Your application is waiting to be reviewed.",
  Approved: "Congratulations! Your application was approved.",
  Rejected: "Sorry, your application was not accepted this time.",
};

const IMAGE_FIELDS = [
  {
    key: "charlesMartel",
    label: "Commander Charles Martel Skills",
    help: "Screenshot of Charles Martel's skills page (skill levels and expertise).",
  },
  {
    key: "infantryEquipment",
    label: "Infantry Equipment",
    help: "Screenshot of your equipped infantry gear (the full equipment screen).",
  },
  {
    key: "militaryTech",
    label: "Military Technology Research",
    help: "Screenshot of your Academy military technology research.",
  },
];

/* ==========================================================================
   STORAGE HELPERS (browser localStorage - swap with a real API later)
   ========================================================================== */
// Images the owner can view in the dashboard (the speed-ups screenshot is optional)
const MAX_TECH_IMAGES = 6; // max screenshots for Military Technology Research

// Works for old applications (single image) and new ones (list of images)
const toList = (v) => (Array.isArray(v) ? v : v ? [v] : []);

// Every image the owner can open in the dashboard
function viewFields(app) {
  const items = [];
  const add = (key, label, value) => {
    const list = toList(value);
    list.forEach((src, i) =>
      items.push({
        key: `${key}-${i}`,
        label: list.length > 1 ? `${label} (${i + 1}/${list.length})` : label,
        src,
      })
    );
  };
  IMAGE_FIELDS.forEach((f) => add(f.key, f.label, app[f.key]));
  add("speedups", "T5 Speed-ups", app.speedups);
  return items;
}

function loadApplications() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch {
    return [];
  }
}

function saveApplications(list) {
  // Throws if the browser storage quota is exceeded.
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
}

function loadSettings() {
  try {
    return { open: true, ...JSON.parse(localStorage.getItem(SETTINGS_KEY)) };
  } catch {
    return { open: true };
  }
}

function saveSettings(settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

/* ==========================================================================
   HELPERS
   ========================================================================== */
function compressImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read the file."));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("This file is not a valid image."));
      img.onload = () => {
        const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.8));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function formatDate(iso) {
  return new Date(iso).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function refCode(app) {
  return app.id.replace(/-/g, "").slice(-6).toUpperCase();
}

function downloadCsv(apps) {
  const esc = (v) => `"${String(v).replace(/"/g, '""')}"`;
  const rows = [
    ["Player Name", "Governor ID", "Status", "Submitted", "Reference"],
    ...apps.map((a) => [a.playerName, a.governorId, a.status, formatDate(a.createdAt), refCode(a)]),
  ];
  const csv = rows.map((r) => r.map(esc).join(",")).join("\n");
  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `xtit-mge-applications-kd${KINGDOM}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/* ==========================================================================
   SHARED COMPONENTS
   ========================================================================== */
function Logo({ onClick }) {
  return (
    <button className="logo" onClick={onClick} aria-label={`${SITE_NAME} home`}>
      <span className="logo-mark">X</span>
      <span className="logo-text">{SITE_NAME}</span>
      <span className="logo-kd">KD {KINGDOM}</span>
    </button>
  );
}

function Header({ view, isAdmin, go, onSignOut }) {
  return (
    <header className="header">
      <div className="container header-inner">
        <Logo onClick={() => go("home")} />
        <nav className="nav">
          {view !== "home" && !isAdmin && (
            <button className="btn btn-ghost" onClick={() => go("home")}>
              Home
            </button>
          )}
          {isAdmin ? (
            <>
              <button
                className={`btn btn-ghost ${view === "admin" ? "active" : ""}`}
                onClick={() => go("admin")}
              >
                Dashboard
              </button>
              <button className="btn btn-outline" onClick={onSignOut}>
                Sign Out
              </button>
            </>
          ) : (
            <button className="btn btn-outline" onClick={() => go("login")}>
              Sign In
            </button>
          )}
        </nav>
      </div>
    </header>
  );
}

function Footer() {
  return (
    <footer className="footer">
      <div className="container">
        {SITE_NAME} &middot; Rise of Kingdoms &middot; Kingdom {KINGDOM} only
      </div>
    </footer>
  );
}

/* ==========================================================================
   HOME
   ========================================================================== */
function StatusChecker() {
  const [id, setId] = useState("");
  const [result, setResult] = useState(null); // null | "none" | application

  function check(e) {
    e.preventDefault();
    const found = loadApplications().find((a) => a.governorId === id.trim());
    setResult(found || "none");
  }

  return (
    <section className="container narrow small-wide">
      <div className="card checker">
        <h3>Already applied? Check your status</h3>
        <p className="muted">Enter your Governor ID to see if your application was reviewed.</p>
        <form className="checker-row" onSubmit={check}>
          <input
            type="text"
            inputMode="numeric"
            placeholder="Your Governor ID"
            value={id}
            maxLength={12}
            onChange={(e) => {
              setId(e.target.value.replace(/\D/g, ""));
              setResult(null);
            }}
          />
          <button className="btn btn-outline" type="submit" disabled={!id.trim()}>
            Check
          </button>
        </form>

        {result === "none" && (
          <p className="notice notice-warn">
            No application was found for this Governor ID on this device.
          </p>
        )}
        {result && result !== "none" && (
          <div className={`notice notice-${result.status.toLowerCase()}`}>
            <strong>
              {result.playerName} &middot; {result.status}
            </strong>
            <span>{STATUS_MESSAGES[result.status]}</span>
          </div>
        )}
      </div>
    </section>
  );
}

const PUBLIC_LABELS = { Pending: "Pending", Approved: "Accepted", Rejected: "Rejected" };

function ApplicantList() {
  const [apps, setApps] = useState(loadApplications);
  const [filter, setFilter] = useState("All");
  const [search, setSearch] = useState("");

  // Auto-update: reload the list when data changes, when the tab is focused, and every 5 seconds.
  useEffect(() => {
    const refresh = () => setApps(loadApplications());
    window.addEventListener("storage", refresh);
    window.addEventListener("focus", refresh);
    const t = setInterval(refresh, 5000);
    return () => {
      window.removeEventListener("storage", refresh);
      window.removeEventListener("focus", refresh);
      clearInterval(t);
    };
  }, []);

  const q = search.trim().toLowerCase();
  const sorted = [...apps].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const visible = sorted.filter(
    (a) =>
      (filter === "All" || a.status === filter) &&
      (!q || a.playerName.toLowerCase().includes(q))
  );
  const count = (s) => apps.filter((a) => a.status === s).length;

  return (
    <section className="container narrow small-wide">
      <div className="card applicant-list">
        <div className="al-head">
          <div>
            <h3>Applicant List</h3>
            <p className="muted">
              Everyone who applied for MGE in Kingdom {KINGDOM}. Updates automatically.
            </p>
          </div>
          <span className="al-total">{apps.length} total</span>
        </div>

        <input
          type="search"
          placeholder="Search by player name"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        <div className="chips al-chips">
          {[
            ["All", "All"],
            ["Approved", "Accepted"],
            ["Pending", "Pending"],
            ["Rejected", "Rejected"],
          ].map(([value, label]) => (
            <button
              key={value}
              className={`chip ${filter === value ? "active" : ""}`}
              onClick={() => setFilter(value)}
            >
              {label}
              <span className="chip-count">{value === "All" ? apps.length : count(value)}</span>
            </button>
          ))}
        </div>

        {visible.length === 0 ? (
          <p className="muted al-empty">
            {apps.length === 0 ? "No one has applied yet." : "No players match your search or filter."}
          </p>
        ) : (
          <ol className="al-rows">
            {visible.map((a, i) => (
              <li className="al-row" key={a.id}>
                <span className="al-index">{i + 1}</span>
                <span className="al-name">{a.playerName}</span>
                <span className={`status status-${a.status.toLowerCase()}`}>
                  {PUBLIC_LABELS[a.status]}
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}

function Home({ go, isOpen }) {
  return (
    <main>
      <section className="hero">
        <div className="container hero-inner">
          <span className="badge">Rise of Kingdoms &middot; Kingdom {KINGDOM}</span>
          <h1>
            Apply for <span className="accent">The Mightiest Governor</span>
          </h1>
          <p className="hero-text">
            Welcome to <strong>{SITE_NAME}</strong>, the official application site for
            The Mightiest Governor (MGE) event in Kingdom <strong>{KINGDOM}</strong>.
            Submit your Governor details and screenshots, and our team will review your
            application.
          </p>
          <button
            className="btn btn-primary btn-xl"
            disabled={!isOpen}
            onClick={() => go("apply")}
          >
            {isOpen ? "Apply" : "Applications Closed"}
          </button>
          <p className="hint">
            {isOpen
              ? `Applications are open to Kingdom ${KINGDOM} players only.`
              : "Applications are currently closed. Please check back later."}
          </p>
        </div>
      </section>

      <section className="container steps">
        {[
          ["1", "Fill in your details", "Enter your player name and Governor ID."],
          ["2", "Upload 3 screenshots", "Charles Martel skills, infantry equipment and military tech."],
          ["3", "Wait for review", "The Kingdom owner reviews every application."],
        ].map(([n, title, text]) => (
          <div className="card step" key={n}>
            <div className="step-num">{n}</div>
            <h3>{title}</h3>
            <p>{text}</p>
          </div>
        ))}
      </section>
    </main>
  );
}

/* ==========================================================================
   IMAGE UPLOAD FIELD (click, drag & drop)
   ========================================================================== */
function ImageField({ index, field, value, error, onChange, optional }) {
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [localError, setLocalError] = useState("");

  async function processFile(file) {
    if (!file) return;
    setLocalError("");
    if (!ACCEPTED_TYPES.includes(file.type)) {
      setLocalError("Please upload a PNG, JPG or WEBP image.");
      return;
    }
    setBusy(true);
    try {
      onChange(await compressImage(file));
    } catch (err) {
      setLocalError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const shownError = localError || error;

  return (
    <div className={`field ${shownError ? "has-error" : ""}`}>
      <label className="label">
        <span className="label-num">{index}</span>
        {field.label}{" "}
        {optional ? <span className="opt">(optional)</span> : <span className="req">*</span>}
        {value && <span className="done-tag">Uploaded</span>}
      </label>
      <p className="help">{field.help}</p>

      <label
        className={`dropzone ${value ? "filled" : ""} ${dragging ? "dragging" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          processFile(e.dataTransfer.files?.[0]);
        }}
      >
        <input
          type="file"
          accept=".png,.jpg,.jpeg,.webp"
          onChange={(e) => {
            processFile(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        {value ? (
          <img src={value} alt={`${field.label} preview`} className="preview" />
        ) : (
          <span className="dz-text">
            <strong>{busy ? "Processing image..." : "Tap or click to choose a screenshot"}</strong>
            <small>or drag &amp; drop it here &middot; PNG / JPG</small>
          </span>
        )}
      </label>

      {value && (
        <div className="img-actions">
          <label className="link-btn">
            Replace
            <input
              type="file"
              accept=".png,.jpg,.jpeg,.webp"
              hidden
              onChange={(e) => {
                processFile(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </label>
          <button type="button" className="link-btn" onClick={() => onChange("")}>
            Remove
          </button>
        </div>
      )}
      {shownError && <p className="error">{shownError}</p>}
    </div>
  );
}

/* ==========================================================================
   APPLICATION FORM
   ========================================================================== */
function MultiImageField({ index, field, value, error, onChange, max = MAX_TECH_IMAGES }) {
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [localError, setLocalError] = useState("");
  const images = toList(value);

  async function addFiles(fileList) {
    const files = Array.from(fileList || []);
    if (files.length === 0) return;

    const room = max - images.length;
    if (room <= 0) {
      setLocalError(`You can upload up to ${max} images.`);
      return;
    }

    let message = "";
    const valid = files.filter((f) => ACCEPTED_TYPES.includes(f.type));
    if (valid.length < files.length) message = "Some files were skipped (only PNG, JPG or WEBP).";
    if (valid.length > room) message = `Only ${max} images are allowed - extra files were skipped.`;

    setBusy(true);
    try {
      const added = await Promise.all(valid.slice(0, room).map(compressImage));
      onChange([...images, ...added]);
    } catch (err) {
      message = err.message;
    } finally {
      setBusy(false);
    }
    setLocalError(message);
  }

  const shownError = localError || error;

  return (
    <div className={`field ${shownError ? "has-error" : ""}`}>
      <label className="label">
        <span className="label-num">{index}</span>
        {field.label} <span className="req">*</span>
        {images.length > 0 && <span className="done-tag">{images.length} uploaded</span>}
      </label>
      <p className="help">{field.help}</p>

      {images.length > 0 && (
        <div className="multi-grid">
          {images.map((src, i) => (
            <div className="multi-item" key={i}>
              <img src={src} alt={`${field.label} ${i + 1}`} />
              <span className="multi-num">{i + 1}</span>
              <button
                type="button"
                className="multi-remove"
                aria-label={`Remove image ${i + 1}`}
                onClick={() => onChange(images.filter((_, j) => j !== i))}
              >
                &times;
              </button>
            </div>
          ))}
        </div>
      )}

      {images.length < max && (
        <label
          className={`dropzone dropzone-small ${dragging ? "dragging" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            addFiles(e.dataTransfer.files);
          }}
        >
          <input
            type="file"
            multiple
            accept=".png,.jpg,.jpeg,.webp"
            onChange={(e) => {
              addFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <span className="dz-text">
            <strong>
              {busy
                ? "Processing images..."
                : images.length > 0
                ? "+ Add more screenshots"
                : "Tap or click to choose screenshots"}
            </strong>
            <small>
              You can select several at once &middot; up to {max} images &middot; PNG / JPG
            </small>
          </span>
        </label>
      )}

      {images.length > 0 && (
        <p className="hint multi-count">
          {images.length} of {max} images
        </p>
      )}
      {shownError && <p className="error">{shownError}</p>}
    </div>
  );
}

function YesNoField({ index, label, help, value, error, required, onChange }) {
  return (
    <div className={`field ${error ? "has-error" : ""}`}>
      <label className="label">
        <span className="label-num">{index}</span>
        {label}{" "}
        {required ? <span className="req">*</span> : <span className="opt">(optional)</span>}
        {value && <span className="done-tag">{value}</span>}
      </label>
      {help && <p className="help">{help}</p>}

      <div className="choice-row" role="radiogroup" aria-label={label}>
        {["Yes", "No"].map((opt) => (
          <button
            type="button"
            key={opt}
            role="radio"
            aria-checked={value === opt}
            className={`choice choice-${opt.toLowerCase()} ${value === opt ? "selected" : ""}`}
            onClick={() => onChange(opt)}
          >
            {opt}
          </button>
        ))}
      </div>

      {!required && value && (
        <button type="button" className="link-btn" onClick={() => onChange("")}>
          Clear answer
        </button>
      )}
      {error && <p className="error">{error}</p>}
    </div>
  );
}

function ApplyForm({ onSubmitted, isOpen, go }) {
  const [form, setForm] = useState({
    playerName: "",
    governorId: "",
    charlesMartel: "",
    infantryEquipment: "",
    militaryTech: [],
    t5Plan: "",
    speedups: "",
    shareAccount: "",
  });
  const [errors, setErrors] = useState({});
  const [submitError, setSubmitError] = useState("");

  const set = (key, value) => {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => ({ ...e, [key]: undefined }));
  };

  const checks = [
    form.playerName.trim().length > 0,
    /^\d{5,12}$/.test(form.governorId.trim()),
    ...IMAGE_FIELDS.map((f) => toList(form[f.key]).length > 0),
    form.shareAccount !== "",
  ];
  const doneCount = checks.filter(Boolean).length;
  const allDone = doneCount === checks.length;

  function validate() {
    const e = {};
    if (!form.playerName.trim()) e.playerName = "Please enter your player name.";
    if (!form.governorId.trim()) e.governorId = "Please enter your Governor ID.";
    else if (!/^\d{5,12}$/.test(form.governorId.trim()))
      e.governorId = "Governor ID must be 5-12 digits (numbers only).";
    IMAGE_FIELDS.forEach((f) => {
      if (toList(form[f.key]).length === 0) e[f.key] = "Please upload at least one screenshot.";
    });
    if (!form.shareAccount) e.shareAccount = "Please choose Yes or No.";
    return e;
  }

  function handleSubmit(ev) {
    ev.preventDefault();
    setSubmitError("");

    const e = validate();
    const existing = loadApplications();
    const dup = existing.find((a) => a.governorId === form.governorId.trim());
    if (dup && !e.governorId) {
      e.governorId = `This Governor ID already applied (status: ${dup.status}). Each player can apply once.`;
    }

    setErrors(e);
    if (Object.keys(e).length) {
      setTimeout(() => {
        document.querySelector(".has-error")?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 50);
      return;
    }

    const application = {
      id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random(),
      playerName: form.playerName.trim(),
      governorId: form.governorId.trim(),
      charlesMartel: form.charlesMartel,
      infantryEquipment: form.infantryEquipment,
      militaryTech: form.militaryTech,
      t5Plan: form.t5Plan,
      speedups: form.t5Plan === "Yes" ? form.speedups : "",
      shareAccount: form.shareAccount,
      createdAt: new Date().toISOString(),
      status: "Pending",
    };

    try {
      saveApplications([application, ...existing]);
      onSubmitted(application);
    } catch {
      setSubmitError(
        "Could not save your application (browser storage is full). Try smaller screenshots."
      );
    }
  }

  if (!isOpen) {
    return (
      <main className="container narrow">
        <div className="card center confirm">
          <h2>Applications are closed</h2>
          <p className="muted">
            MGE applications for Kingdom {KINGDOM} are not open right now. Please check back later.
          </p>
          <button className="btn btn-primary" onClick={() => go("home")}>
            Back to Home
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="container narrow">
      <div className="card form-card">
        <span className="badge">Kingdom {KINGDOM} only</span>
        <h2>MGE Application</h2>
        <p className="muted">
          Fields marked <span className="req">*</span> are required. Questions marked (optional) can be skipped.
        </p>

        <div className="progress">
          <div className="progress-top">
            <span>
              {allDone ? "Everything is ready - press Apply!" : `${doneCount} of ${checks.length} completed`}
            </span>
            <strong>{Math.round((doneCount / checks.length) * 100)}%</strong>
          </div>
          <div className="bar">
            <div className="bar-fill" style={{ width: `${(doneCount / checks.length) * 100}%` }} />
          </div>
        </div>

        <form onSubmit={handleSubmit} noValidate>
          <div className={`field ${errors.playerName ? "has-error" : ""}`}>
            <label className="label" htmlFor="playerName">
              <span className="label-num">1</span>
              Player Name <span className="req">*</span>
              {checks[0] && <span className="done-tag">Done</span>}
            </label>
            <p className="help">Your in-game governor name exactly as it appears in Rise of Kingdoms.</p>
            <input
              id="playerName"
              type="text"
              value={form.playerName}
              maxLength={40}
              onChange={(e) => set("playerName", e.target.value)}
              placeholder="e.g. XTiT Warrior"
            />
            {errors.playerName && <p className="error">{errors.playerName}</p>}
          </div>

          <div className={`field ${errors.governorId ? "has-error" : ""}`}>
            <label className="label" htmlFor="governorId">
              <span className="label-num">2</span>
              Governor ID <span className="req">*</span>
              {checks[1] && <span className="done-tag">Done</span>}
            </label>
            <p className="help">
              Tap your avatar in the game to find it. Numbers only (5-12 digits).
            </p>
            <input
              id="governorId"
              type="text"
              inputMode="numeric"
              value={form.governorId}
              maxLength={12}
              onChange={(e) => set("governorId", e.target.value.replace(/\D/g, ""))}
              placeholder="e.g. 123456789"
            />
            {errors.governorId && <p className="error">{errors.governorId}</p>}
          </div>

          {IMAGE_FIELDS.map((f, i) =>
            f.key === "militaryTech" ? (
              <MultiImageField
                key={f.key}
                index={i + 3}
                field={f}
                value={form[f.key]}
                error={errors[f.key]}
                onChange={(v) => set(f.key, v)}
              />
            ) : (
              <ImageField
                key={f.key}
                index={i + 3}
                field={f}
                value={form[f.key]}
                error={errors[f.key]}
                onChange={(v) => set(f.key, v)}
              />
            )
          )}

          <YesNoField
            index={6}
            label="Are you planning to unlock T5 troops before KvK1?"
            help="Optional. If yes, please send a screenshot of your speed-ups."
            required={false}
            value={form.t5Plan}
            onChange={(v) => set("t5Plan", v)}
          />

          {form.t5Plan === "Yes" && (
            <ImageField
              index="6a"
              optional
              field={{
                label: "Speed-ups Screenshot",
                help: "Screenshot of your speed-ups.",
              }}
              value={form.speedups}
              error={errors.speedups}
              onChange={(v) => set("speedups", v)}
            />
          )}

          <YesNoField
            index={7}
            label="Can you share your account with the kingdom leadership so that the account can remain online 24/7?"
            help="Required. You must choose Yes or No."
            required
            value={form.shareAccount}
            error={errors.shareAccount}
            onChange={(v) => set("shareAccount", v)}
          />

          {submitError && <p className="error banner">{submitError}</p>}

          <button type="submit" className="btn btn-primary btn-xl btn-block" disabled={!allDone}>
            Apply
          </button>
          {!allDone && (
            <p className="hint center">The Apply button unlocks when all required items are completed.</p>
          )}
        </form>
      </div>
    </main>
  );
}

/* ==========================================================================
   CONFIRMATION
   ========================================================================== */
function Confirmation({ app, go }) {
  return (
    <main className="container narrow">
      <div className="card center confirm">
        <div className="check">&#10003;</div>
        <h2>Your application was submitted successfully.</h2>
        <p className="muted">
          Thank you! Your MGE application for Kingdom {KINGDOM} was saved and will be reviewed
          by the Kingdom owner.
        </p>

        {app && (
          <dl className="summary">
            <div><dt>Player</dt><dd>{app.playerName}</dd></div>
            <div><dt>Governor ID</dt><dd>{app.governorId}</dd></div>
            <div><dt>Reference</dt><dd>{refCode(app)}</dd></div>
            <div><dt>Status</dt><dd>Pending</dd></div>
          </dl>
        )}

        <p className="hint">The Kingdom owner will review your application soon.</p>
        <button className="btn btn-primary" onClick={() => go("home")}>
          Back to Home
        </button>
      </div>
    </main>
  );
}

/* ==========================================================================
   ADMIN LOGIN (separate from the player flow)
   ========================================================================== */
function AdminLogin({ onSuccess }) {
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState("");

  function handleSubmit(e) {
    e.preventDefault();
    if (password === ADMIN_PASSWORD) {
      sessionStorage.setItem(SESSION_KEY, "1");
      onSuccess();
    } else {
      setError("Incorrect password. Please try again.");
    }
  }

  return (
    <main className="container narrow small">
      <div className="card form-card">
        <span className="badge">Owner access</span>
        <h2>Admin Sign In</h2>
        <p className="muted">This area is for the Kingdom {KINGDOM} owner only.</p>
        <form onSubmit={handleSubmit}>
          <div className={`field ${error ? "has-error" : ""}`}>
            <label className="label" htmlFor="pw">
              Admin Password
            </label>
            <div className="pw-row">
              <input
                id="pw"
                type={show ? "text" : "password"}
                value={password}
                autoFocus
                onChange={(e) => {
                  setPassword(e.target.value);
                  setError("");
                }}
                placeholder="Enter password"
              />
              <button type="button" className="btn btn-outline" onClick={() => setShow((s) => !s)}>
                {show ? "Hide" : "Show"}
              </button>
            </div>
            {error && <p className="error">{error}</p>}
          </div>
          <button type="submit" className="btn btn-primary btn-block" disabled={!password}>
            Sign In
          </button>
        </form>
      </div>
    </main>
  );
}

/* ==========================================================================
   ADMIN DASHBOARD
   ========================================================================== */
function ApplicationCard({ app, onStatus, onDelete, onZoom, onCopy }) {
  const statusKey = app.status.toLowerCase();

  return (
    <article className={`card app-card border-${statusKey}`}>
      <div className="app-info">
        <div className="app-top">
          <div className="avatar">{app.playerName.charAt(0).toUpperCase()}</div>
          <div className="app-name">
            <h3>{app.playerName}</h3>
            <span className={`status status-${statusKey}`}>{app.status}</span>
          </div>
        </div>

        <dl className="meta">
          <div>
            <dt>Governor ID</dt>
            <dd>
              {app.governorId}
              <button className="copy-btn" onClick={() => onCopy(app.governorId)}>
                Copy
              </button>
            </dd>
          </div>
          <div>
            <dt>Submitted</dt>
            <dd>{formatDate(app.createdAt)}</dd>
          </div>
          <div>
            <dt>Planning T5 before KvK1</dt>
            <dd>{app.t5Plan || "Not answered"}</dd>
          </div>
          <div>
            <dt>Share account 24/7</dt>
            <dd>{app.shareAccount || "Not answered"}</dd>
          </div>
        </dl>

        <div className="app-actions">
          <button
            className="btn btn-success"
            disabled={app.status === "Approved"}
            onClick={() => onStatus(app, "Approved")}
          >
            Approve
          </button>
          <button
            className="btn btn-danger"
            disabled={app.status === "Rejected"}
            onClick={() => onStatus(app, "Rejected")}
          >
            Reject
          </button>
          <button
            className="btn btn-outline"
            disabled={app.status === "Pending"}
            onClick={() => onStatus(app, "Pending")}
          >
            Reset
          </button>
          <button
            className="btn btn-ghost danger-text"
            onClick={() => {
              if (window.confirm(`Delete the application from ${app.playerName}? This cannot be undone.`))
                onDelete(app);
            }}
          >
            Delete
          </button>
        </div>
      </div>

      <div className="thumbs">
        {viewFields(app).map((f, i) => (
          <figure key={f.key} className="thumb">
            <button type="button" onClick={() => onZoom(app, i)}>
              <img src={f.src} alt={f.label} />
              <span className="thumb-num">{i + 1}</span>
              <span className="thumb-zoom">Click to enlarge</span>
            </button>
            <figcaption>{f.label}</figcaption>
          </figure>
        ))}
      </div>
    </article>
  );
}

function AdminDashboard({ isOpen, onToggleOpen }) {
  const [apps, setApps] = useState(loadApplications);
  const [filter, setFilter] = useState("All");
  const [sort, setSort] = useState("newest");
  const [search, setSearch] = useState("");
  const [zoom, setZoom] = useState(null); // { app, index }
  const [toast, setToast] = useState(null);
  const timer = useRef(null);

  // Keep the list in sync if another tab adds an application.
  useEffect(() => {
    const onStorage = (e) => {
      if (e.key === STORAGE_KEY) setApps(loadApplications());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  // Lightbox keyboard controls.
  useEffect(() => {
    if (!zoom) return;
    const onKey = (e) => {
      if (e.key === "Escape") setZoom(null);
      if (e.key === "ArrowRight") step(1);
      if (e.key === "ArrowLeft") step(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoom]);

  const step = (d) =>
    setZoom((z) => {
      if (!z) return z;
      const n = viewFields(z.app).length;
      return { ...z, index: (z.index + d + n) % n };
    });

  function showToast(message, undo) {
    clearTimeout(timer.current);
    setToast({ message, undo });
    timer.current = setTimeout(() => setToast(null), 5000);
  }

  function update(fn) {
    setApps((cur) => {
      const next = fn(cur);
      try {
        saveApplications(next);
      } catch {
        /* storage full - ignore on admin side */
      }
      return next;
    });
  }

  function setStatus(app, status) {
    const previous = app.status;
    update((cur) => cur.map((a) => (a.id === app.id ? { ...a, status } : a)));
    showToast(`${app.playerName} marked as ${status}.`, () => {
      update((cur) => cur.map((a) => (a.id === app.id ? { ...a, status: previous } : a)));
      setToast(null);
    });
  }

  function remove(app) {
    update((cur) => cur.filter((a) => a.id !== app.id));
    showToast(`${app.playerName}'s application was deleted.`);
  }

  function copy(text) {
    navigator.clipboard?.writeText(text);
    showToast(`Copied Governor ID ${text}.`);
  }

  const q = search.trim().toLowerCase();
  const visible = apps
    .filter(
      (a) =>
        (filter === "All" || a.status === filter) &&
        (!q || a.playerName.toLowerCase().includes(q) || a.governorId.includes(q))
    )
    .sort((a, b) => {
      if (sort === "oldest") return new Date(a.createdAt) - new Date(b.createdAt);
      if (sort === "pending") {
        const order = { Pending: 0, Approved: 1, Rejected: 2 };
        return order[a.status] - order[b.status] || new Date(b.createdAt) - new Date(a.createdAt);
      }
      return new Date(b.createdAt) - new Date(a.createdAt);
    });

  const count = (s) => apps.filter((a) => a.status === s).length;
  const zoomFields = zoom ? viewFields(zoom.app) : [];
  const zoomField = zoom ? zoomFields[zoom.index] : null;

  return (
    <main className="container">
      <div className="dash-head">
        <div>
          <h2>Admin Dashboard</h2>
          <p className="muted">MGE applications &middot; Kingdom {KINGDOM}</p>
        </div>
        <div className="head-actions">
          <button className="btn btn-outline" onClick={() => setApps(loadApplications())}>
            Refresh
          </button>
          <button
            className="btn btn-outline"
            disabled={apps.length === 0}
            onClick={() => downloadCsv(apps)}
          >
            Export CSV
          </button>
        </div>
      </div>

      <div className={`card open-card ${isOpen ? "is-open" : "is-closed"}`}>
        <div>
          <strong>Applications are {isOpen ? "OPEN" : "CLOSED"}</strong>
          <p className="muted">
            {isOpen
              ? "Players can submit new applications right now."
              : "Players cannot submit new applications. The Apply button is disabled."}
          </p>
        </div>
        <button className={`btn ${isOpen ? "btn-danger" : "btn-success"}`} onClick={onToggleOpen}>
          {isOpen ? "Close applications" : "Open applications"}
        </button>
      </div>

      <div className="stats">
        <div className="card stat"><strong>{apps.length}</strong><span>Total</span></div>
        {STATUSES.map((s) => (
          <div className="card stat" key={s}>
            <strong>{count(s)}</strong>
            <span>{s}</span>
          </div>
        ))}
      </div>

      <div className="toolbar">
        <input
          type="search"
          placeholder="Search by name or Governor ID"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort applications">
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
          <option value="pending">Pending first</option>
        </select>
        <div className="chips">
          {["All", ...STATUSES].map((s) => (
            <button
              key={s}
              className={`chip ${filter === s ? "active" : ""}`}
              onClick={() => setFilter(s)}
            >
              {s}
              {s !== "All" && <span className="chip-count">{count(s)}</span>}
            </button>
          ))}
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="card center empty">
          <p className="muted">
            {apps.length === 0
              ? "No applications have been submitted yet."
              : "No applications match your search or filter."}
          </p>
        </div>
      ) : (
        <div className="app-list">
          {visible.map((a) => (
            <ApplicationCard
              key={a.id}
              app={a}
              onStatus={setStatus}
              onDelete={remove}
              onZoom={(app, index) => setZoom({ app, index })}
              onCopy={copy}
            />
          ))}
        </div>
      )}

      {zoom && (
        <div className="lightbox" onClick={() => setZoom(null)}>
          <div className="lightbox-inner" onClick={(e) => e.stopPropagation()}>
            <div className="lightbox-bar">
              <span>
                {zoom.app.playerName} &middot; {zoomField.label} ({zoom.index + 1}/{zoomFields.length})
              </span>
              <button className="btn btn-ghost" onClick={() => setZoom(null)}>
                Close
              </button>
            </div>
            <img src={zoomField.src} alt={zoomField.label} />
            <div className="lightbox-nav">
              <button className="btn btn-outline" onClick={() => step(-1)}>
                &larr; Previous
              </button>
              <button className="btn btn-outline" onClick={() => step(1)}>
                Next &rarr;
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="toast" role="status">
          <span>{toast.message}</span>
          {toast.undo && (
            <button className="toast-undo" onClick={toast.undo}>
              Undo
            </button>
          )}
        </div>
      )}
    </main>
  );
}

/* ==========================================================================
   APP ROOT
   ========================================================================== */
export default function App() {
  const [view, setView] = useState("home"); // home | apply | success | login | admin
  const [isAdmin, setIsAdmin] = useState(() => sessionStorage.getItem(SESSION_KEY) === "1");
  const [isOpen, setIsOpen] = useState(() => loadSettings().open);
  const [lastApp, setLastApp] = useState(null);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [view]);

  // Protect the admin view.
  const go = (next) => setView(next === "admin" && !isAdmin ? "login" : next);

  function signOut() {
    sessionStorage.removeItem(SESSION_KEY);
    setIsAdmin(false);
    setView("home");
  }

  function toggleOpen() {
    const next = !isOpen;
    setIsOpen(next);
    saveSettings({ open: next });
  }

  const loginScreen = (
    <AdminLogin
      onSuccess={() => {
        setIsAdmin(true);
        setView("admin");
      }}
    />
  );

  return (
    <div className="app">
      <Header view={view} isAdmin={isAdmin} go={go} onSignOut={signOut} />

      {view === "home" && <Home go={go} isOpen={isOpen} />}
      {view === "apply" && (
        <ApplyForm
          isOpen={isOpen}
          go={go}
          onSubmitted={(app) => {
            setLastApp(app);
            setView("success");
          }}
        />
      )}
      {view === "success" && <Confirmation app={lastApp} go={go} />}
      {view === "login" && loginScreen}
      {view === "admin" &&
        (isAdmin ? <AdminDashboard isOpen={isOpen} onToggleOpen={toggleOpen} /> : loginScreen)}

      <Footer />
    </div>
  );
}

/* ==========================================================================
   NOTE: This is a front-end prototype. Applications live in the browser's
   localStorage and the admin password is in this file, so applications are
   only visible on the same browser/device and the password is NOT secure.
   For real use, add a backend (database + file storage + server-side login)
   and replace loadApplications / saveApplications / ADMIN_PASSWORD checks.
   ========================================================================== */