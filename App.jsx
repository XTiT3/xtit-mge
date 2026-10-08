import React, { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "./supabase.js";
import { LANGUAGES, RTL_LANGS, LangContext, useT, makeT, loadLang, saveLang } from "./src/i18n.js";

/* ==========================================================================
   CONFIG - change these values easily
   ========================================================================== */
const KINGDOM = "4161";
const SITE_NAME = "XTiT";

const BUCKET = "screenshots";
const ADMIN_EMAIL = "adnanxtit33@gmail.com"; // the email of the admin user you created in Supabase

const MAX_IMAGE_SIDE = 1000; // screenshots are downscaled to keep storage small
const ACCEPTED_TYPES = ["image/png", "image/jpeg", "image/webp"];
const STATUSES = ["Pending", "Approved", "Rejected"];
const MAX_REWARD_RANK = 9999; // must match the SQL check
// [value, label] - a number means "Top 1 up to that number". Edit these to change the buttons.
const REWARD_FILTERS = [
  ["all", "All players"],
  ["has", "Has reward"],
  ["3", "Top 1-3"],
  ["10", "Top 1-10"],
  ["15", "Top 1-15"],
  ["50", "Top 1-50"],
  ["none", "No reward"],
];

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
const MAX_TECH_IMAGES = 4;// max screenshots for Military Technology Research
const MAX_GEAR_IMAGES = 15; // max screenshots for Gear Inventory (the first one is required)

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
  add("gearInventory", "Gear Inventory", app.gearInventory);
  add("speedups", "T5 Speed-ups", app.speedups);
  return items;
}

const fromRow = (r) => ({
  id: r.id,
  playerName: r.player_name,
  governorId: r.governor_id,
  charlesMartel: r.charles_martel,
  infantryEquipment: r.infantry_equipment,
  militaryTech: r.military_tech || [],
  gearInventory: r.gear_inventory || [],
  t5Plan: r.t5_plan || "",
  speedups: r.speedups || "",
  shareAccount: r.share_account || "",
  rewardRank: r.reward_rank ?? null,
  createdAt: r.created_at,
  status: r.status,
});

// Admin only (blocked by the database for everyone else)
async function loadApplications() {
  const { data, error } = await supabase
    .from("applications")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data.map(fromRow);
}

// Public: name + status only
async function loadPublicApplicants() {
  const { data, error } = await supabase.rpc("public_applicants");
  if (error) return [];
  return data.map((r) => ({
    id: r.id,
    playerName: r.player_name,
    status: r.status,
    createdAt: r.created_at,
  }));
}

async function checkStatus(governorId) {
  const { data } = await supabase.rpc("check_status", { gid: governorId });
  return data && data[0] ? { playerName: data[0].player_name, status: data[0].status } : null;
}

async function uploadImage(dataUrl) {
  if (!dataUrl) return "";
  const blob = await (await fetch(dataUrl)).blob();
  const path = `${crypto.randomUUID()}.jpg`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: "image/jpeg" });
  if (error) throw error;
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

async function createApplication(f) {
  const id = crypto.randomUUID();
  const [charles, infantry, speed] = await Promise.all([
    uploadImage(f.charlesMartel),
    uploadImage(f.infantryEquipment),
    uploadImage(f.speedups),
  ]);
  const tech = await Promise.all(toList(f.militaryTech).map(uploadImage));
  const gear = await Promise.all(toList(f.gearInventory).map(uploadImage));
  const { error } = await supabase.from("applications").insert({
    id,
    player_name: f.playerName,
    governor_id: f.governorId,
    charles_martel: charles,
    infantry_equipment: infantry,
    military_tech: tech,
    gear_inventory: gear,
    t5_plan: f.t5Plan,
    speedups: speed,
    share_account: f.shareAccount,
  });
  if (error) throw error;
  return { id, playerName: f.playerName, governorId: f.governorId };
}

async function updateStatus(id, status) {
  const { error } = await supabase.from("applications").update({ status }).eq("id", id);
  if (error) throw error;
}

async function updateReward(id, rewardRank) {
  const { error } = await supabase.from("applications").update({ reward_rank: rewardRank }).eq("id", id);
  if (error) throw error;
}

async function deleteApplication(app) {
  const urls = [app.charlesMartel, app.infantryEquipment, ...toList(app.militaryTech), ...toList(app.gearInventory), app.speedups].filter(Boolean);
  const paths = urls.map((u) => u.split(`/${BUCKET}/`)[1]).filter(Boolean);
  const { error } = await supabase.from("applications").delete().eq("id", app.id);
  if (error) throw error;
  if (paths.length) await supabase.storage.from(BUCKET).remove(paths);
}

async function getOpen() {
  const { data } = await supabase.from("settings").select("open").eq("id", 1).single();
  return data ? data.open : true;
}

async function saveOpen(open) {
  const { error } = await supabase.from("settings").update({ open }).eq("id", 1);
  if (error) throw error;
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
        resolve(canvas.toDataURL("image/jpeg", 0.7));
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
    ["Player Name", "Governor ID", "Status", "Reward", "Submitted", "Reference"],
    ...apps.map((a) => [a.playerName, a.governorId, a.status, a.rewardRank != null ? `Top ${a.rewardRank}` : "", formatDate(a.createdAt), refCode(a)]),
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

function LanguageSelect() {
  const { lang, setLang, t } = useT();
  return (
    <label className="lang-wrap" title={t("lang")}>
      <span aria-hidden="true">🌐</span>
      <select className="lang-select" value={lang} onChange={(e) => setLang(e.target.value)} aria-label={t("lang")}>
        {LANGUAGES.map((l) => (
          <option key={l.code} value={l.code}>{l.name}</option>
        ))}
      </select>
    </label>
  );
}

function Header({ view, isAdmin, go, onSignOut }) {
  const { t } = useT();
  return (
    <header className="header">
      <div className="container header-inner">
        <Logo onClick={() => go("home")} />
        <nav className="nav">
          <LanguageSelect />
          {view !== "home" && !isAdmin && (
            <button className="btn btn-ghost" onClick={() => go("home")}>{t("nav.home")}</button>
          )}
          {isAdmin ? (
            <>
              <button className={`btn btn-ghost ${view === "admin" ? "active" : ""}`} onClick={() => go("admin")}>
                {t("nav.dash")}
              </button>
              <button className="btn btn-outline" onClick={onSignOut}>{t("nav.out")}</button>
            </>
          ) : (
            <button className="btn btn-outline" onClick={() => go("login")}>{t("nav.in")}</button>
          )}
        </nav>
      </div>
    </header>
  );
}

function Footer() {
  const { t } = useT();
  return (
    <footer className="footer">
      <div className="container">{t("foot", { site: SITE_NAME, kd: KINGDOM })}</div>
    </footer>
  );
}

/* ==========================================================================
   HOME
   ========================================================================== */
function StatusChecker() {
  const { t } = useT();
  const [id, setId] = useState("");
  const [result, setResult] = useState(null); // null | "none" | application

  async function check(e) {
    e.preventDefault();
    const found = await checkStatus(id.trim());
    setResult(found || "none");
  }

  return (
    <section className="container narrow small-wide">
      <div className="card checker">
        <h3>{t("c.t")}</h3>
        <p className="muted">{t("c.d")}</p>
        <form className="checker-row" onSubmit={check}>
          <input
            type="text"
            inputMode="numeric"
            placeholder={t("c.ph")}
            value={id}
            maxLength={12}
            onChange={(e) => {
              setId(e.target.value.replace(/\D/g, ""));
              setResult(null);
            }}
          />
          <button className="btn btn-outline" type="submit" disabled={!id.trim()}>{t("c.b")}</button>
        </form>

        {result === "none" && <p className="notice notice-warn">{t("c.no")}</p>}
        {result && result !== "none" && (
          <div className={`notice notice-${result.status.toLowerCase()}`}>
            <strong>
              {result.playerName} &middot; {t("s." + result.status)}
            </strong>
            <span>{t("m." + result.status)}</span>
          </div>
        )}
      </div>
    </section>
  );
}

const pubKey = (s) => (s === "Approved" ? "s.pub" : "s." + s);

function ApplicantList() {
  const { t } = useT();
  const [apps, setApps] = useState([]);
  const [filter, setFilter] = useState("All");
  const [search, setSearch] = useState("");

  useEffect(() => {
    const refresh = () => loadPublicApplicants().then(setApps);
    refresh();
    window.addEventListener("storage", refresh);
    window.addEventListener("focus", refresh);
    const timer = setInterval(refresh, 30000);
    return () => {
      window.removeEventListener("storage", refresh);
      window.removeEventListener("focus", refresh);
      clearInterval(timer);
    };
  }, []);

  const q = search.trim().toLowerCase();
  const sorted = [...apps].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const visible = sorted.filter(
    (a) => (filter === "All" || a.status === filter) && (!q || a.playerName.toLowerCase().includes(q))
  );
  const count = (s) => apps.filter((a) => a.status === s).length;

  return (
    <section className="container narrow small-wide">
      <div className="card applicant-list">
        <div className="al-head">
          <div>
            <h3>{t("al.t")}</h3>
            <p className="muted">{t("al.d", { kd: KINGDOM })}</p>
          </div>
          <span className="al-total">{t("al.n", { n: apps.length })}</span>
        </div>

        <input type="search" placeholder={t("al.s")} value={search} onChange={(e) => setSearch(e.target.value)} />

        <div className="chips al-chips">
          {[
            ["All", t("al.all")],
            ["Approved", t("s.pub")],
            ["Pending", t("s.Pending")],
            ["Rejected", t("s.Rejected")],
          ].map(([value, label]) => (
            <button key={value} className={`chip ${filter === value ? "active" : ""}`} onClick={() => setFilter(value)}>
              {label}
              <span className="chip-count">{value === "All" ? apps.length : count(value)}</span>
            </button>
          ))}
        </div>

        {visible.length === 0 ? (
          <p className="muted al-empty">{apps.length === 0 ? t("al.e0") : t("al.e1")}</p>
        ) : (
          <ol className="al-rows">
            {visible.map((a, i) => (
              <li className="al-row" key={a.id}>
                <span className="al-index">{i + 1}</span>
                <span className="al-name">{a.playerName}</span>
                <span className={`status status-${a.status.toLowerCase()}`}>{t(pubKey(a.status))}</span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}

function Home({ go, isOpen }) {
  const { t } = useT();
  return (
    <main>
      <section className="hero">
        <div className="container hero-inner">
          <span className="badge">{t("h.badge", { kd: KINGDOM })}</span>
          <h1>
            {t("h.t1")} <span className="accent">{t("h.t2")}</span>
          </h1>
          <p className="hero-text">{t("h.txt", { site: SITE_NAME, kd: KINGDOM })}</p>
          <button className="btn btn-primary btn-xl" disabled={!isOpen} onClick={() => go("apply")}>
            {isOpen ? t("h.go") : t("h.closed")}
          </button>
          <p className="hint">{isOpen ? t("h.hOpen", { kd: KINGDOM }) : t("h.hClosed")}</p>
        </div>
      </section>

      <section className="container steps">
        {["1", "2", "3"].map((n) => (
          <div className="card step" key={n}>
            <div className="step-num">{n}</div>
            <h3>{t(`st${n}.t`)}</h3>
            <p>{t(`st${n}.d`)}</p>
          </div>
        ))}
      </section>
    </main>
  );
}

/* ==========================================================================
   IMAGE UPLOAD FIELDS (all error values are translation keys)
   ========================================================================== */
function ImageField({ index, field, value, error, onChange, optional }) {
  const { t } = useT();
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [localError, setLocalError] = useState("");

  async function processFile(file) {
    if (!file) return;
    setLocalError("");
    if (!ACCEPTED_TYPES.includes(file.type)) {
      setLocalError("e.type");
      return;
    }
    setBusy(true);
    try {
      onChange(await compressImage(file));
    } catch {
      setLocalError("e.img");
    } finally {
      setBusy(false);
    }
  }

  const shownError = localError || error;
  const label = t(`f.${field.key}.l`);

  return (
    <div className={`field ${shownError ? "has-error" : ""}`}>
      <label className="label">
        <span className="label-num">{index}</span>
        {label} {optional ? <span className="opt">{t("opt")}</span> : <span className="req">*</span>}
        {value && <span className="done-tag">{t("up")}</span>}
      </label>
      <p className="help">{t(`f.${field.key}.h`)}</p>

      <label
        className={`dropzone ${value ? "filled" : ""} ${dragging ? "dragging" : ""}`}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); processFile(e.dataTransfer.files?.[0]); }}
      >
        <input
          type="file"
          accept=".png,.jpg,.jpeg,.webp"
          onChange={(e) => { processFile(e.target.files?.[0]); e.target.value = ""; }}
        />
        {value ? (
          <img src={value} alt={label} className="preview" />
        ) : (
          <span className="dz-text">
            <strong>{busy ? t("dz.b") : t("dz.1")}</strong>
            <small>{t("dz.d")}</small>
          </span>
        )}
      </label>

      {value && (
        <div className="img-actions">
          <label className="link-btn">
            {t("rep")}
            <input
              type="file"
              accept=".png,.jpg,.jpeg,.webp"
              hidden
              onChange={(e) => { processFile(e.target.files?.[0]); e.target.value = ""; }}
            />
          </label>
          <button type="button" className="link-btn" onClick={() => onChange("")}>{t("rem")}</button>
        </div>
      )}
      {shownError && <p className="error">{t(shownError)}</p>}
    </div>
  );
}

function MultiImageField({ index, field, value, error, onChange, max = MAX_TECH_IMAGES }) {
  const { t } = useT();
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [localError, setLocalError] = useState("");
  const images = toList(value);

  async function addFiles(fileList) {
    const files = Array.from(fileList || []);
    if (files.length === 0) return;
    const room = max - images.length;
    if (room <= 0) {
      setLocalError("e.full");
      return;
    }
    let message = "";
    const valid = files.filter((f) => ACCEPTED_TYPES.includes(f.type));
    if (valid.length < files.length) message = "e.skip";
    if (valid.length > room) message = "e.max";

    setBusy(true);
    try {
      const added = await Promise.all(valid.slice(0, room).map(compressImage));
      onChange([...images, ...added]);
    } catch {
      message = "e.img";
    } finally {
      setBusy(false);
    }
    setLocalError(message);
  }

  const shownError = localError || error;
  const label = t(`f.${field.key}.l`);

  return (
    <div className={`field ${shownError ? "has-error" : ""}`}>
      <label className="label">
        <span className="label-num">{index}</span>
        {label} <span className="req">*</span>
        {images.length > 0 && <span className="done-tag">{t("n.up", { n: images.length })}</span>}
      </label>
      <p className="help">{t(`f.${field.key}.h`)}</p>

      {images.length > 0 && (
        <div className="multi-grid">
          {images.map((src, i) => (
            <div className="multi-item" key={i}>
              <img src={src} alt={`${label} ${i + 1}`} />
              <span className="multi-num">{i + 1}</span>
              <button
                type="button"
                className="multi-remove"
                aria-label={`${t("rem")} ${i + 1}`}
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
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); addFiles(e.dataTransfer.files); }}
        >
          <input
            type="file"
            multiple
            accept=".png,.jpg,.jpeg,.webp"
            onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }}
          />
          <span className="dz-text">
            <strong>{busy ? t("dz.bn") : images.length > 0 ? t("dz.more") : t("dz.m")}</strong>
            <small>{t("dz.h", { max })}</small>
          </span>
        </label>
      )}

      {images.length > 0 && <p className="hint multi-count">{t("n.of", { n: images.length, max })}</p>}
      {shownError && <p className="error">{t(shownError, { max })}</p>}
    </div>
  );
}

function GearImagesField({ index, value, error, onChange, max = MAX_GEAR_IMAGES }) {
  const { t } = useT();
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [localError, setLocalError] = useState("");
  const images = toList(value);

  async function addFiles(fileList) {
    const files = Array.from(fileList || []);
    if (files.length === 0) return;
    const room = max - images.length;
    if (room <= 0) {
      setLocalError("e.full");
      return;
    }
    let message = "";
    const valid = files.filter((f) => ACCEPTED_TYPES.includes(f.type));
    if (valid.length < files.length) message = "e.skip";
    if (valid.length > room) message = "e.max";

    setBusy(true);
    try {
      const added = await Promise.all(valid.slice(0, room).map(compressImage));
      onChange([...images, ...added]);
    } catch {
      message = "e.img";
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
        {t("g.l")} <span className="req">*</span>
        {images.length > 0 && <span className="done-tag">{t("n.s", { n: images.length, max })}</span>}
      </label>
      <p className="help">{t("g.h")}</p>
      <p className="gear-note">{t("g.note")}</p>

      <div className="gear-legend">
        <span className="gear-tag required">{t("g.req")}</span>
        <span className="gear-tag optional">{t("g.opt", { max })}</span>
      </div>

      {images.length > 0 && (
        <div className="multi-grid">
          {images.map((src, i) => (
            <div className="gear-cell" key={i}>
              <div className="multi-item">
                <img src={src} alt={`${t("g.l")} ${i + 1}`} />
                <span className="multi-num">{i + 1}</span>
                <button
                  type="button"
                  className="multi-remove"
                  aria-label={`${t("rem")} ${i + 1}`}
                  onClick={() => onChange(images.filter((_, j) => j !== i))}
                >
                  &times;
                </button>
              </div>
              <span className={`gear-tag ${i === 0 ? "required" : "optional"}`}>
                {t(i === 0 ? "g.reqN" : "g.optN", { n: i + 1 })}
              </span>
            </div>
          ))}
        </div>
      )}

      {images.length < max && (
        <label
          className={`dropzone dropzone-small ${dragging ? "dragging" : ""}`}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); addFiles(e.dataTransfer.files); }}
        >
          <input
            type="file"
            multiple
            accept=".png,.jpg,.jpeg,.webp"
            onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }}
          />
          <span className="dz-text">
            <strong>
              {busy ? t("dz.bn") : images.length === 0 ? t("g.add1") : t("g.addN", { n: images.length + 1 })}
            </strong>
            <small>{t("dz.h", { max })}</small>
          </span>
        </label>
      )}

      {images.length > 0 && <p className="hint multi-count">{t("n.of", { n: images.length, max })}</p>}
      {shownError && <p className="error">{t(shownError, { max })}</p>}
    </div>
  );
}

function YesNoField({ index, label, help, value, error, required, onChange }) {
  const { t } = useT();
  const word = (v) => t(v === "Yes" ? "yes" : "no");
  return (
    <div className={`field ${error ? "has-error" : ""}`}>
      <label className="label">
        <span className="label-num">{index}</span>
        {label} {required ? <span className="req">*</span> : <span className="opt">{t("opt")}</span>}
        {value && <span className="done-tag">{word(value)}</span>}
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
            {word(opt)}
          </button>
        ))}
      </div>

      {!required && value && (
        <button type="button" className="link-btn" onClick={() => onChange("")}>{t("clr")}</button>
      )}
      {error && <p className="error">{t(error)}</p>}
    </div>
  );
}

/* ---------- How to Apply ---------- */
const EXAMPLE_BASE = `${import.meta.env.BASE_URL}examples/`;
const HOW_TO_STEPS = [
  { title: "name.l", text: "ht.name.d", image: null },
  { title: "gid.l", text: "ht.gid.d", image: null },
  { title: "f.charlesMartel.l", text: "ht.cm.d", image: "charles-martel.jpg" },
  { title: "f.infantryEquipment.l", text: "ht.inf.d", image: "infantry-equipment.jpg" },
  { title: "f.militaryTech.l", text: "ht.tech.d", image: "military-tech.jpg" },
  { title: "g.l", text: "ht.gear.d", note: "ht.gear.n", image: "gear-inventory.jpg" },
];

function ExampleImage({ src, title }) {
  const { t } = useT();
  const [failed, setFailed] = useState(false);
  if (!src || failed) return null;
  return (
    <figure className="ht-example">
      <figcaption className="ht-example-title">{t("hw.ex", { title })}</figcaption>
      <img src={EXAMPLE_BASE + src} alt={t("hw.ex", { title })} loading="lazy" onError={() => setFailed(true)} />
    </figure>
  );
}

function HowToApply() {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  return (
    <div className="howto-wrap">
      <button
        type="button"
        className="btn btn-primary btn-block howto-toggle"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {open ? t("hw.hide") : t("hw.show")}
      </button>
      {open && (
        <section className="howto" aria-labelledby="howto-title">
          <h3 id="howto-title">{t("hw.show")}</h3>
          <p className="muted">{t("hw.intro")}</p>
          <p className="howto-warn">{t("hw.warn")}</p>

          <ol className="ht-steps">
            {HOW_TO_STEPS.map((s, i) => (
              <li className="ht-step" key={s.title}>
                <div className="ht-head">
                  <span className="ht-num">{t("hw.step", { n: i + 1 })}</span>
                  <h4>{t(s.title)}</h4>
                </div>
                <p>{t(s.text)}</p>
                {s.note && <p className="ht-note">{t(s.note, { max: MAX_GEAR_IMAGES })}</p>}
                <ExampleImage src={s.image} title={t(s.title)} />
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}

/* ==========================================================================
   APPLICATION FORM
   ========================================================================== */
function ApplyForm({ onSubmitted, isOpen, go }) {
  const { t } = useT();
  const [form, setForm] = useState({
    playerName: "",
    governorId: "",
    charlesMartel: "",
    infantryEquipment: "",
    militaryTech: [],
    gearInventory: [],
    t5Plan: "",
    speedups: "",
    shareAccount: "",
  });
  const [errors, setErrors] = useState({});
  const [dupStatus, setDupStatus] = useState("Pending");
  const [submitError, setSubmitError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const set = (key, value) => {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => ({ ...e, [key]: undefined }));
  };

  const checks = [
    form.playerName.trim().length > 0,
    /^\d{5,12}$/.test(form.governorId.trim()),
    ...IMAGE_FIELDS.map((f) => toList(form[f.key]).length > 0),
    toList(form.gearInventory).length > 0,
    form.shareAccount !== "",
  ];
  const doneCount = checks.filter(Boolean).length;
  const allDone = doneCount === checks.length;

  function validate() {
    const e = {};
    if (!form.playerName.trim()) e.playerName = "e.name";
    if (!form.governorId.trim()) e.governorId = "e.gid";
    else if (!/^\d{5,12}$/.test(form.governorId.trim())) e.governorId = "e.gid2";
    IMAGE_FIELDS.forEach((f) => {
      if (toList(form[f.key]).length === 0) e[f.key] = "e.shot";
    });
    if (toList(form.gearInventory).length === 0) e.gearInventory = "e.gear";
    if (!form.shareAccount) e.shareAccount = "e.yn";
    return e;
  }

  async function handleSubmit(ev) {
    ev.preventDefault();
    setSubmitError("");

    const e = validate();
    setErrors(e);
    if (Object.keys(e).length) {
      setTimeout(() => {
        document.querySelector(".has-error")?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 50);
      return;
    }

    setSubmitting(true);
    try {
      const gid = form.governorId.trim();
      const dup = await checkStatus(gid);
      if (dup) {
        setDupStatus(dup.status);
        setErrors({ governorId: "e.dup" });
        return;
      }
      const application = await createApplication({
        ...form,
        playerName: form.playerName.trim(),
        governorId: gid,
        speedups: form.t5Plan === "Yes" ? form.speedups : "",
      });
      onSubmitted(application);
    } catch (err) {
      if (err?.code === "23505") setErrors({ governorId: "e.dup2" });
      else setSubmitError("e.sub");
    } finally {
      setSubmitting(false);
    }
  }

  if (!isOpen) {
    return (
      <main className="container narrow">
        <div className="card center confirm">
          <h2>{t("cl.t")}</h2>
          <p className="muted">{t("cl.d", { kd: KINGDOM })}</p>
          <button className="btn btn-primary" onClick={() => go("home")}>{t("back")}</button>
        </div>
      </main>
    );
  }

  return (
    <main className="container narrow">
      <div className="card form-card">
        <span className="badge">{t("fm.badge", { kd: KINGDOM })}</span>
        <h2>{t("fm.t")}</h2>
        <p className="muted">{t("fm.fields")}</p>

        <div className="progress">
          <div className="progress-top">
            <span>{allDone ? t("fm.ready") : t("fm.prog", { n: doneCount, total: checks.length })}</span>
            <strong>{Math.round((doneCount / checks.length) * 100)}%</strong>
          </div>
          <div className="bar">
            <div className="bar-fill" style={{ width: `${(doneCount / checks.length) * 100}%` }} />
          </div>
        </div>

        <form onSubmit={handleSubmit} noValidate>
          <HowToApply />

          <div className={`field ${errors.playerName ? "has-error" : ""}`}>
            <label className="label" htmlFor="playerName">
              <span className="label-num">1</span>
              {t("name.l")} <span className="req">*</span>
              {checks[0] && <span className="done-tag">{t("done")}</span>}
            </label>
            <p className="help">{t("name.h")}</p>
            <input
              id="playerName"
              type="text"
              value={form.playerName}
              maxLength={40}
              onChange={(e) => set("playerName", e.target.value)}
              placeholder={t("name.ph")}
            />
            {errors.playerName && <p className="error">{t(errors.playerName)}</p>}
          </div>

          <div className={`field ${errors.governorId ? "has-error" : ""}`}>
            <label className="label" htmlFor="governorId">
              <span className="label-num">2</span>
              {t("gid.l")} <span className="req">*</span>
              {checks[1] && <span className="done-tag">{t("done")}</span>}
            </label>
            <p className="help">{t("gid.h")}</p>
            <input
              id="governorId"
              type="text"
              inputMode="numeric"
              value={form.governorId}
              maxLength={12}
              onChange={(e) => set("governorId", e.target.value.replace(/\D/g, ""))}
              placeholder={t("gid.ph")}
            />
            {errors.governorId && <p className="error">{t(errors.governorId, { status: t("s." + dupStatus) })}</p>}
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

          <GearImagesField
            index={6}
            value={form.gearInventory}
            error={errors.gearInventory}
            onChange={(v) => set("gearInventory", v)}
          />

          <YesNoField
            index={7}
            label={t("q7.l")}
            help={t("q7.h")}
            required={false}
            value={form.t5Plan}
            onChange={(v) => set("t5Plan", v)}
          />

          {form.t5Plan === "Yes" && (
            <ImageField
              index="7a"
              optional
              field={{ key: "speedups" }}
              value={form.speedups}
              error={errors.speedups}
              onChange={(v) => set("speedups", v)}
            />
          )}

          <YesNoField
            index={8}
            label={t("q8.l")}
            help={t("q8.h")}
            required
            value={form.shareAccount}
            error={errors.shareAccount}
            onChange={(v) => set("shareAccount", v)}
          />

          {submitError && <p className="error banner">{t(submitError)}</p>}

          <button type="submit" className="btn btn-primary btn-xl btn-block" disabled={!allDone || submitting}>
            {submitting ? t("fm.going") : t("fm.go")}
          </button>
          {!allDone && <p className="hint center">{t("fm.lock")}</p>}
        </form>
      </div>
    </main>
  );
}

/* ==========================================================================
   CONFIRMATION
   ========================================================================== */
function Confirmation({ app, go }) {
  const { t } = useT();
  return (
    <main className="container narrow">
      <div className="card center confirm">
        <div className="check">&#10003;</div>
        <h2>{t("ok.t")}</h2>
        <p className="muted">{t("ok.d", { kd: KINGDOM })}</p>

        {app && (
          <dl className="summary">
            <div><dt>{t("ok.p")}</dt><dd>{app.playerName}</dd></div>
            <div><dt>{t("gid.l")}</dt><dd>{app.governorId}</dd></div>
            <div><dt>{t("ok.r")}</dt><dd>{refCode(app)}</dd></div>
            <div><dt>{t("ok.s")}</dt><dd>{t("s.Pending")}</dd></div>
          </dl>
        )}

        <p className="hint">{t("ok.h")}</p>
        <button className="btn btn-primary" onClick={() => go("home")}>{t("back")}</button>
      </div>
    </main>
  );
}

/* ==========================================================================
   ADMIN LOGIN
   ========================================================================== */
function AdminLogin({ onSuccess }) {
  const { t } = useT();
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setBusy(true);
    const { error: err } = await supabase.auth.signInWithPassword({ email: ADMIN_EMAIL, password });
    setBusy(false);
    if (err) setError(t("lg.fail", { msg: err.message }));
    else onSuccess();
  }

  return (
    <main className="container narrow small">
      <div className="card form-card">
        <span className="badge">{t("lg.badge")}</span>
        <h2>{t("lg.t")}</h2>
        <p className="muted">{t("lg.d", { kd: KINGDOM })}</p>
        <form onSubmit={handleSubmit}>
          <div className={`field ${error ? "has-error" : ""}`}>
            <label className="label" htmlFor="pw">{t("lg.pw")}</label>
            <div className="pw-row">
              <input
                id="pw"
                type={show ? "text" : "password"}
                autoComplete="current-password"
                autoFocus
                value={password}
                onChange={(e) => { setPassword(e.target.value); setError(""); }}
                placeholder={t("lg.ph")}
              />
              <button type="button" className="btn btn-outline" onClick={() => setShow((s) => !s)}>
                {show ? t("lg.hide") : t("lg.show")}
              </button>
            </div>
            {error && <p className="error">{error}</p>}
          </div>
          <button type="submit" className="btn btn-primary btn-block" disabled={!password || busy}>
            {busy ? t("lg.busy") : t("nav.in")}
          </button>
        </form>
      </div>
    </main>
  );
}

/* ==========================================================================
   ADMIN DASHBOARD
   ========================================================================== */
// Translates the thumbnail captions made by viewFields()
function viewLabel(t, f) {
  const base = f.key.replace(/-\d+$/, "");
  const k = base === "gearInventory" ? "g.l" : base === "speedups" ? "ad.spd" : `f.${base}.l`;
  const m = f.label.match(/\(\d+\/\d+\)$/);
  return t(k) + (m ? " " + m[0] : "");
}

function RewardInput({ app, onReward }) {
  const { t } = useT();
  const [value, setValue] = useState(app.rewardRank ?? "");

  useEffect(() => {
    setValue(app.rewardRank ?? "");
  }, [app.rewardRank]);

  const changed = String(value) !== String(app.rewardRank ?? "");
  const invalid = value !== "" && (Number(value) < 1 || Number(value) > MAX_REWARD_RANK);

  function save(e) {
    e.preventDefault();
    if (invalid || !changed) return;
    onReward(app, value === "" ? null : Number(value));
  }

  return (
    <form className="reward" onSubmit={save}>
      <label className="reward-label" htmlFor={`rank-${app.id}`}>{t("rw.label")}</label>
      <div className="reward-input-row">
        <span className="reward-prefix">{t("rw.pre")}</span>
        <input
          id={`rank-${app.id}`}
          type="text"
          inputMode="numeric"
          maxLength={4}
          placeholder={t("rw.ph")}
          value={value}
          onChange={(e) => setValue(e.target.value.replace(/\D/g, ""))}
        />
        <button className="btn btn-primary" type="submit" disabled={!changed || invalid}>{t("ad.save")}</button>
      </div>
      {invalid && <p className="error">{t("rw.err", { max: MAX_REWARD_RANK })}</p>}
      {app.rewardRank != null && (
        <button type="button" className="link-btn" onClick={() => onReward(app, null)}>{t("rw.clr")}</button>
      )}
    </form>
  );
}

function ApplicationCard({ app, onStatus, onReward, onDelete, onZoom, onCopy }) {
  const { t } = useT();
  const statusKey = app.status.toLowerCase();
  const yn = (v) => (v ? t(v === "Yes" ? "yes" : "no") : t("ad.na"));

  return (
    <article className={`card app-card border-${statusKey}`}>
      <div className="app-info">
        <div className="app-top">
          <div className="avatar">{app.playerName.charAt(0).toUpperCase()}</div>
          <div className="app-name">
            <h3>{app.playerName}</h3>
            <span className={`status status-${statusKey}`}>{t("s." + app.status)}</span>
            {app.rewardRank != null && <span className="reward-badge">{t("rw.badge", { n: app.rewardRank })}</span>}
          </div>
        </div>

        <dl className="meta">
          <div>
            <dt>{t("gid.l")}</dt>
            <dd>
              {app.governorId}
              <button className="copy-btn" onClick={() => onCopy(app.governorId)}>{t("ad.copy")}</button>
            </dd>
          </div>
          <div>
            <dt>{t("ad.subm")}</dt>
            <dd>{formatDate(app.createdAt)}</dd>
          </div>
          <div>
            <dt>{t("ad.t5")}</dt>
            <dd>{yn(app.t5Plan)}</dd>
          </div>
          <div>
            <dt>{t("ad.share")}</dt>
            <dd>{yn(app.shareAccount)}</dd>
          </div>
        </dl>

        <RewardInput app={app} onReward={onReward} />

        <div className="app-actions">
          <button className="btn btn-success" disabled={app.status === "Approved"} onClick={() => onStatus(app, "Approved")}>
            {t("ad.ap")}
          </button>
          <button className="btn btn-danger" disabled={app.status === "Rejected"} onClick={() => onStatus(app, "Rejected")}>
            {t("ad.rj")}
          </button>
          <button className="btn btn-outline" disabled={app.status === "Pending"} onClick={() => onStatus(app, "Pending")}>
            {t("ad.rs")}
          </button>
          <button className="btn btn-ghost danger-text" onClick={() => onDelete(app)}>{t("ad.del")}</button>
        </div>
      </div>

      <div className="thumbs">
        {viewFields(app).map((f, i) => (
          <figure key={f.key} className="thumb">
            <button type="button" onClick={() => onZoom(app, i)}>
              <img src={f.src} alt={viewLabel(t, f)} loading="lazy" />
              <span className="thumb-num">{i + 1}</span>
              <span className="thumb-zoom">{t("ad.zoom")}</span>
            </button>
            <figcaption>{viewLabel(t, f)}</figcaption>
          </figure>
        ))}
      </div>
    </article>
  );
}

function AdminDashboard({ isOpen, onToggleOpen }) {
  const { t } = useT();
  const [apps, setApps] = useState([]);
  const [filter, setFilter] = useState("All");
  const [sort, setSort] = useState("newest");
  const [rewardFilter, setRewardFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [zoom, setZoom] = useState(null); // { app, index }
  const [limit, setLimit] = useState(20);
  const [toast, setToast] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const timer = useRef(null);

  async function reload() {
    try {
      setApps(await loadApplications());
    } catch {
      showToast(t("ad.tFail"));
    }
  }

  useEffect(() => {
    reload();
    const timerId = setInterval(reload, 10000);
    return () => clearInterval(timerId);
  }, []);

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

  async function setStatus(app, status) {
    const previous = app.status;
    try {
      await updateStatus(app.id, status);
      setApps((cur) => cur.map((a) => (a.id === app.id ? { ...a, status } : a)));
      showToast(t("ad.tMark", { name: app.playerName, status: t("s." + status) }), async () => {
        await updateStatus(app.id, previous);
        setApps((cur) => cur.map((a) => (a.id === app.id ? { ...a, status: previous } : a)));
        setToast(null);
      });
    } catch {
      showToast(t("ad.tFail"));
    }
  }

  async function setReward(app, rewardRank) {
    const previous = app.rewardRank;
    try {
      await updateReward(app.id, rewardRank);
      setApps((cur) => cur.map((a) => (a.id === app.id ? { ...a, rewardRank } : a)));
      showToast(
        rewardRank ? t("ad.tRew", { name: app.playerName, n: rewardRank }) : t("ad.tRewC", { name: app.playerName }),
        async () => {
          await updateReward(app.id, previous);
          setApps((cur) => cur.map((a) => (a.id === app.id ? { ...a, rewardRank: previous } : a)));
          setToast(null);
        }
      );
    } catch {
      showToast(t("ad.tFail"));
    }
  }

  async function remove(app) {
    try {
      await deleteApplication(app);
      setApps((cur) => cur.filter((a) => a.id !== app.id));
      showToast(t("ad.tDel", { name: app.playerName }));
    } catch {
      showToast(t("ad.tFail"));
    }
  }

  async function confirmRemove() {
    if (!confirmDelete) return;
    setDeleting(true);
    await remove(confirmDelete);
    setDeleting(false);
    setConfirmDelete(null);
  }

  useEffect(() => {
    if (!confirmDelete) return;
    const onKey = (e) => {
      if (e.key === "Escape" && !deleting) setConfirmDelete(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirmDelete, deleting]);

  function copy(text) {
    navigator.clipboard?.writeText(text);
    showToast(t("ad.tCopy", { id: text }));
  }

  const rwLabel = (v) =>
    v === "all" ? t("rw.all") : v === "has" ? t("rw.has") : v === "none" ? t("rw.none") : t("rw.topN", { n: v });

  const q = search.trim().toLowerCase();
  const visible = apps
    .filter(
      (a) =>
        (filter === "All" || a.status === filter) &&
        (!q || a.playerName.toLowerCase().includes(q) || a.governorId.includes(q)) &&
        (rewardFilter === "all" ||
          (rewardFilter === "has" && a.rewardRank != null) ||
          (rewardFilter === "none" && a.rewardRank == null) ||
          (/^\d+$/.test(rewardFilter) && a.rewardRank != null && a.rewardRank <= Number(rewardFilter)))
    )
    .sort((a, b) => {
      const ra = a.rewardRank ?? Infinity;
      const rb = b.rewardRank ?? Infinity;
      if (ra !== rb) return ra - rb;
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
          <h2>{t("ad.title")}</h2>
          <p className="muted">{t("ad.sub", { kd: KINGDOM })}</p>
        </div>
        <div className="head-actions">
          <button className="btn btn-outline" onClick={reload}>{t("ad.refresh")}</button>
          <button className="btn btn-outline" disabled={apps.length === 0} onClick={() => downloadCsv(apps)}>
            {t("ad.csv")}
          </button>
        </div>
      </div>

      <div className={`card open-card ${isOpen ? "is-open" : "is-closed"}`}>
        <div>
          <strong>{isOpen ? t("ad.open") : t("ad.closed")}</strong>
          <p className="muted">{isOpen ? t("ad.openD") : t("ad.closedD")}</p>
        </div>
        <button className={`btn ${isOpen ? "btn-danger" : "btn-success"}`} onClick={onToggleOpen}>
          {isOpen ? t("ad.doClose") : t("ad.doOpen")}
        </button>
      </div>

      <div className="stats">
        <div className="card stat"><strong>{apps.length}</strong><span>{t("ad.total")}</span></div>
        {STATUSES.map((s) => (
          <div className="card stat" key={s}>
            <strong>{count(s)}</strong>
            <span>{t("s." + s)}</span>
          </div>
        ))}
      </div>

      <div className="toolbar">
        <input type="search" placeholder={t("ad.search")} value={search} onChange={(e) => setSearch(e.target.value)} />
        <select value={rewardFilter} onChange={(e) => setRewardFilter(e.target.value)} aria-label={t("rw.label")}>
          {REWARD_FILTERS.map(([value]) => (
            <option key={value} value={value}>{rwLabel(value)}</option>
          ))}
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="newest">{t("ad.new")}</option>
          <option value="oldest">{t("ad.old")}</option>
          <option value="pending">{t("ad.pend")}</option>
        </select>
        <div className="chips">
          {["All", ...STATUSES].map((s) => (
            <button key={s} className={`chip ${filter === s ? "active" : ""}`} onClick={() => setFilter(s)}>
              {s === "All" ? t("ad.all") : t("s." + s)}
              {s !== "All" && <span className="chip-count">{count(s)}</span>}
            </button>
          ))}
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="card center empty">
          <p className="muted">{apps.length === 0 ? t("ad.e0") : t("ad.e1")}</p>
        </div>
      ) : (
        <div className="app-list">
          {visible.slice(0, limit).map((a) => (
            <ApplicationCard
              key={a.id}
              app={a}
              onStatus={setStatus}
              onReward={setReward}
              onDelete={(app) => setConfirmDelete(app)}
              onZoom={(app, index) => setZoom({ app, index })}
              onCopy={copy}
            />
          ))}
          {visible.length > limit && (
            <button className="btn btn-outline" onClick={() => setLimit((l) => l + 20)}>
              {t("ad.more", { n: visible.length - limit })}
            </button>
          )}
        </div>
      )}

      {zoom && (
        <div className="lightbox" onClick={() => setZoom(null)}>
          <div className="lightbox-inner" onClick={(e) => e.stopPropagation()}>
            <div className="lightbox-bar">
              <span>
                {zoom.app.playerName} &middot; {viewLabel(t, zoomField)} ({zoom.index + 1}/{zoomFields.length})
              </span>
              <button className="btn btn-ghost" onClick={() => setZoom(null)}>{t("ad.close")}</button>
            </div>
            <img src={zoomField.src} alt={viewLabel(t, zoomField)} />
            <div className="lightbox-nav">
              <button className="btn btn-outline" onClick={() => step(-1)}>{t("ad.prev")}</button>
              <button className="btn btn-outline" onClick={() => step(1)}>{t("ad.next")}</button>
            </div>
          </div>
        </div>
      )}

      {confirmDelete && (
        <div className="modal-backdrop" onClick={() => !deleting && setConfirmDelete(null)}>
          <div className="modal" role="alertdialog" aria-modal="true" aria-labelledby="del-title" onClick={(e) => e.stopPropagation()}>
            <div className="modal-icon">!</div>
            <h3 id="del-title">{t("ad.delT")}</h3>
            <p className="muted">{t("ad.delD", { name: confirmDelete.playerName, id: confirmDelete.governorId })}</p>
            <p className="modal-warn">{t("ad.delW")}</p>
            <div className="modal-actions">
              <button className="btn btn-outline" disabled={deleting} onClick={() => setConfirmDelete(null)}>
                {t("ad.cancel")}
              </button>
              <button className="btn btn-danger" disabled={deleting} onClick={confirmRemove}>
                {deleting ? t("ad.deling") : t("ad.delY")}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="toast" role="status">
          <span>{toast.message}</span>
          {toast.undo && <button className="toast-undo" onClick={toast.undo}>{t("ad.undo")}</button>}
        </div>
      )}
    </main>
  );
}

/* ==========================================================================
   APP ROOT
   ========================================================================== */
function AppInner() {
  const { t } = useT();
  const [view, setView] = useState("home"); // home | apply | success | login | admin
  const [isAdmin, setIsAdmin] = useState(false);
  const [isOpen, setIsOpen] = useState(true);
  const [lastApp, setLastApp] = useState(null);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [view]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setIsAdmin(!!data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => setIsAdmin(!!session));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    const load = () => getOpen().then(setIsOpen);
    load();
    const timerId = setInterval(load, 15000);
    return () => clearInterval(timerId);
  }, []);

  const go = (next) => setView(next === "admin" && !isAdmin ? "login" : next);

  async function signOut() {
    await supabase.auth.signOut();
    setIsAdmin(false);
    setView("home");
  }

  async function toggleOpen() {
    const next = !isOpen;
    try {
      await saveOpen(next);
      setIsOpen(next);
    } catch {
      alert(t("ad.setFail"));
    }
  }

  const loginScreen = <AdminLogin onSuccess={() => setView("admin")} />;

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

export default function App() {
  const [lang, setLangState] = useState(loadLang);
  const setLang = (code) => {
    setLangState(code);
    saveLang(code);
  };
  const t = useMemo(() => makeT(lang), [lang]);

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = RTL_LANGS.includes(lang) ? "rtl" : "ltr";
  }, [lang]);

  return (
    <LangContext.Provider value={{ lang, setLang, t }}>
      <AppInner />
    </LangContext.Provider>
  );
}
