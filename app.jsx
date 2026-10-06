import React, { useState, useEffect, useMemo, useCallback, useRef, Fragment } from "react";
import { createRoot } from "react-dom/client";
import { createClient } from "@supabase/supabase-js";
import {
  Car, Truck, Search, Bell, Sun, Moon, RefreshCw,
  Upload, X, ChevronRight, User, AlertTriangle,
  RotateCcw, FileSpreadsheet, Zap, SlidersHorizontal, CheckCircle2,
  CalendarClock, History, Info, Trash2, Plus, Download, Lock, Bookmark, Layers, Users, TrendingUp, List, LayoutGrid, FileText, Settings, ArrowRightLeft, Trophy, MessageSquare, FolderOpen, Target, Megaphone, ChevronLeft, Check, Repeat, Flag, BellRing, Sparkles, Paperclip, ExternalLink, Phone, CalendarPlus, Printer, Copy, Pencil, MapPin,
} from "lucide-react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
  PieChart, Pie, Cell, LineChart, Line,
} from "recharts";
import L from "leaflet";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const MONTHS = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };
const VU_KEYWORDS = ["transit", "tourneo", "ranger"];
const VP_OVERRIDE_MODELS = ["tourneo connect", "tourneo courier"];
const RESERVATION_STATUSES = ["Réservé", "Réservation annulée"];
const FORD_SITES = ["Ford Caen", "Ford Lisieux", "Ford Bernay", "Ford Pont-Audemer", "Ford St-Lô", "Ford Cherbourg", "Multi site"];
function stripAccents(s) {
  return (s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}
function normalizeVendeur(v) {
  const base = typeof v === "string" ? { nom: v, site: "" } : v;
  return { role: "Vendeur", permOverrides: {}, email: "", lastLogin: "", ...base };
}
const STORE_KEYS = {
  orders: "dsr:orders",
  stock: "dsr:stock",
  overlays: "dsr:overlays",
  meta: "dsr:import-meta",
  theme: "dsr:theme",
  vendor: "dsr:vendor-name",
  accidents: "dsr:accidents",
  access: "dsr:access-unlocked",
  dossiers: "dsr:dossiers",
  dossiersMeta: "dsr:dossiers-meta",
  vendeurs: "dsr:vendeurs-list",
  manualSales: "dsr:manual-sales",
  sites: "dsr:sites-list",
  alertSettings: "dsr:alert-settings",
  activityLog: "dsr:activity-log",
  convoyages: "dsr:convoyages",
  challengeConfig: "dsr:challenge-config",
  challengeEntries: "dsr:challenge-entries",
  vehicleComments: "dsr:vehicle-comments",
  documentsConfig: "dsr:documents-config",
};

// ---------------------------------------------------------------------------
// Supabase (shared/collaborative data) — personal settings use localStorage
// ---------------------------------------------------------------------------
const SUPABASE_URL = "https://zdzpmlkzujzvjigcdwmf.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpkenBtbGt6dWp6dmppZ2Nkd21mIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI5MTAxNTUsImV4cCI6MjA5ODQ4NjE1NX0.v2RZnooxZEWSAv1bXaW2aHUYcJPZlHAjWhi4FkDXwGs";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const TABLE = "parclive_data";

function loadLocal(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw !== null ? JSON.parse(raw) : fallback;
  } catch (e) {
    return fallback;
  }
}
function saveLocal(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {}
}

// Version (updated_at, exactly as the database returned it) of each shared store as last read or
// written by THIS tab. Writes are conditional on it, so a save never silently overwrites a change
// a colleague made in the meantime (optimistic concurrency / compare-and-swap).
const STORE_ABSENT = "__absent__";
const storeVersions = {};

async function sGetVersioned(key) {
  try {
    const { data, error } = await supabase.from(TABLE).select("value, updated_at").eq("key", key).maybeSingle();
    if (error) return { ok: false, raw: null, version: undefined };
    if (!data) { storeVersions[key] = STORE_ABSENT; return { ok: true, raw: null, version: STORE_ABSENT }; }
    storeVersions[key] = data.updated_at;
    return { ok: true, raw: JSON.stringify(data.value), version: data.updated_at };
  } catch (e) {
    console.error("supabase get failed", key, e);
    return { ok: false, raw: null, version: undefined };
  }
}
async function sGet(key, shared) {
  if (!shared) {
    try {
      return localStorage.getItem(key);
    } catch (e) {
      return null;
    }
  }
  return (await sGetVersioned(key)).raw;
}
async function sGetTableMeta() {
  // Lightweight poll: only key + updated_at (a few bytes per row), so a background refresh
  // doesn't have to re-download every store's full value just to check whether it changed.
  try {
    const { data, error } = await supabase.from(TABLE).select("key, updated_at");
    if (error || !data) return null;
    const map = {};
    data.forEach((row) => { map[row.key] = row.updated_at; });
    return map;
  } catch (e) {
    console.error("supabase meta fetch failed", e);
    return null;
  }
}
// Low-level write. expected === undefined -> unconditional upsert (last write wins);
// STORE_ABSENT -> insert only if the row does not exist yet; otherwise update only if the row's
// updated_at still equals `expected`. Returns "ok" | "conflict" | "error".
async function sWriteIf(key, value, expected) {
  try {
    const parsed = JSON.parse(value);
    const now = new Date().toISOString();
    let res;
    if (expected === undefined) {
      res = await supabase.from(TABLE).upsert({ key, value: parsed, updated_at: now }).select("updated_at");
    } else if (expected === STORE_ABSENT) {
      res = await supabase.from(TABLE).insert({ key, value: parsed, updated_at: now }).select("updated_at");
      if (res.error && res.error.code === "23505") return "conflict";
    } else {
      res = await supabase.from(TABLE).update({ value: parsed, updated_at: now }).eq("key", key).eq("updated_at", expected).select("updated_at");
      if (!res.error && (!res.data || res.data.length === 0)) return "conflict";
    }
    if (res.error) { console.error("supabase set failed", key, res.error); return "error"; }
    storeVersions[key] = (res.data && res.data[0] && res.data[0].updated_at) || now;
    return "ok";
  } catch (e) {
    console.error("supabase set failed", key, e);
    return "error";
  }
}
async function sSet(key, value, shared, opts) {
  if (!shared) {
    try {
      localStorage.setItem(key, value);
      return true;
    } catch (e) {
      return false;
    }
  }
  // force: deliberate full replacement (imports, reset) -> last write wins, as before.
  const expected = opts && opts.force ? undefined : storeVersions[key];
  const r = await sWriteIf(key, value, expected);
  if (r === "conflict") {
    delete storeVersions[key];
    try { window.dispatchEvent(new CustomEvent("parclive:conflict", { detail: { key } })); } catch (e) {}
  }
  return r === "ok";
}
// Read-modify-write that cannot lose a colleague's change: reads the latest value, applies
// `updater`, and writes only if nobody else wrote in between; otherwise re-reads and re-applies
// (up to `retries` times). `updater` returns the new value, or undefined to cancel the write.
async function sPatch(key, updater, fallback, retries = 5) {
  for (let i = 0; i < retries; i++) {
    const cur = await sGetVersioned(key);
    if (!cur.ok) return { ok: false, next: null, aborted: false };
    const fresh = cur.raw === null ? fallback : JSON.parse(cur.raw);
    const next = updater(fresh);
    if (next === undefined) return { ok: true, next: null, aborted: true };
    const r = await sWriteIf(key, JSON.stringify(next), cur.version);
    if (r === "ok") return { ok: true, next, aborted: false };
    if (r === "error") return { ok: false, next: null, aborted: false };
    // conflict -> somebody else wrote first: loop to re-read and re-apply on top of their change
  }
  try { window.dispatchEvent(new CustomEvent("parclive:conflict", { detail: { key } })); } catch (e) {}
  return { ok: false, next: null, aborted: false, conflict: true };
}

// ---------------------------------------------------------------------------
// Excel parsing helpers
// ---------------------------------------------------------------------------
// The Excel library is large and only needed when importing/exporting, so it is loaded on demand
// instead of slowing down every page load.
let xlsxPromise = null;
function loadXLSX() {
  if (!xlsxPromise) {
    xlsxPromise = import("xlsx")
      .then((m) => (m.utils ? m : m.default))
      .catch((e) => {
        xlsxPromise = null;
        try { alert("Impossible de charger le module Excel — vérifiez la connexion puis réessayez."); } catch (_) {}
        throw e;
      });
  }
  return xlsxPromise;
}
function normalizeRow(row) {
  const out = {};
  Object.keys(row).forEach((k) => {
    out[String(k).trim().toLowerCase()] = row[k];
  });
  return out;
}
function pick(norm, ...keys) {
  for (const k of keys) {
    const v = norm[k];
    if (v !== undefined && v !== null && String(v).trim() !== "") return String(v).trim();
  }
  return "";
}
async function parseWorkbook(file) {
  const XLSX = await loadXLSX();
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array", cellDates: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: "", raw: false });
  return rows.map(normalizeRow);
}
function pickLongestEstimate(n) {
  const pairs = [
    ["current delivery estimate from", "current delivery estimate to"],
    ["predicted delivery estimate from", "predicted delivery estimate to"],
    ["prev predicted delivery estimate from", "prev predicted delivery estimate to"],
  ];
  let best = null;
  for (const [fromKey, toKey] of pairs) {
    const from = pick(n, fromKey);
    const to = pick(n, toKey);
    if (!from || !to) continue;
    const endDate = parseExcelDateStr(to);
    if (!endDate) continue;
    if (!best || endDate > best.endDate) best = { from, to, endDate };
  }
  if (best) return `${best.from} - ${best.to}`;
  // Older export format (single combined column) — kept for compatibility.
  return pick(n, "delivery estimate");
}
function toOrderRecord(n) {
  return {
    concession: pick(n, "code concession"),
    orderNumber: pick(n, "n° de commande", "n de commande"),
    sourceOrderNumber: pick(n, "n° de commande source"),
    description: pick(n, "description"),
    vin: pick(n, "n° de série"),
    localisation: pick(n, "localisation"),
    dateStatut: pick(n, "date statut"),
    options: pick(n, "options"),
    codeDestination: pick(n, "code destination"),
    typeVente: pick(n, "type de vente global"),
    dateLivraisonSouhaitee: pick(n, "date de livraison souhaitée", "date de livraison souhaitee"),
    deliveryEstimate: pickLongestEstimate(n),
  };
}
function toStockRecord(n) {
  return {
    concession: pick(n, "code concession"),
    orderNumber: pick(n, "n° de commande", "n de commande"),
    joursStock: Number(pick(n, "jours de stock")) || 0,
    codesNotes: pick(n, "codes des notes"),
  };
}
function formatMaybeDate(v) {
  if (v instanceof Date) return v.toLocaleDateString("fr-FR");
  if (!v) return "";
  return String(v).trim();
}
function toDossierRecord(n) {
  return {
    numero: pick(n, "#"),
    dateCmd: formatMaybeDate(n["date de cmd."]),
    societe: pick(n, "société", "societe"),
    nom: pick(n, "nom"),
    prenom: pick(n, "prénom", "prenom"),
    vendeur: pick(n, "vendeur"),
    mailVendeur: pick(n, "mail vendeur"),
    bonCmd: pick(n, "bon de cmd."),
    numeroUsine: pick(n, "n° usine", "n usine"),
    localisation: pick(n, "localisation"),
    marque: pick(n, "marque"),
    modele: pick(n, "modèle", "modele"),
    financeOrganisme: pick(n, "organisme financement"),
    categorie: pick(n, "cat."),
    etat: pick(n, "etat"),
    statutLivraison: pick(n, "statut liv"),
  };
}
function parseExcelDateStr(str) {
  if (!str) return null;
  const m = String(str).match(/(\d{2})-([A-Z]{3})-(\d{4})/);
  if (!m) return null;
  const month = MONTHS[m[2]];
  if (month === undefined) return null;
  return new Date(Number(m[3]), month, Number(m[1]));
}
function parseDeliveryRange(str) {
  if (!str) return null;
  const re = /(\d{2}-[A-Z]{3}-\d{4})\s*-\s*(\d{2}-[A-Z]{3}-\d{4})/g;
  let match;
  let last = null;
  while ((match = re.exec(str)) !== null) last = match;
  if (!last) return null;
  return { start: parseExcelDateStr(last[1]), end: parseExcelDateStr(last[2]) };
}
function isVU(model) {
  const m = (model || "").toLowerCase();
  if (VP_OVERRIDE_MODELS.some((k) => m.includes(k))) return false;
  return VU_KEYWORDS.some((k) => m.includes(k));
}

const COLOR_KEYWORDS = [
  "blanc", "noir", "gris", "bleu", "rouge", "vert", "jaune", "orange", "marron", "beige",
  "argent", "bronze", "violet", "rose", "doré",
  "black", "white", "grey", "gray", "blue", "red", "green", "silver", "gold",
  "glacier", "agate", "magnetic", "magnétique", "cactus", "island", "iconic", "carbone",
  "lightning", "lucid", "artisan", "azur", "solar", "aqua", "matter", "lunaire", "absolute",
  "bursting", "mind", "onyx", "sand",
];
const COLOR_KEYWORD_RE = new RegExp("\\b(" + COLOR_KEYWORDS.join("|") + ")\\b", "i");
const TECH_SPEC_RE = /\d\s*(ch|kw|kwh|cv)\b|\d\s*l\b|bva\d*|bvm\d*|\bcvt\b|ecoblue|ecoboost|duratec|powershift|hybrid|diesel|essence|electrique|électrique|propulsion|traction|4x4|4wd|awd|rwd|stop\s*&\s*start|mhev|phev|vitesses|automatique/i;
const GEARBOX_RE = /\bBVA\s?\d{0,2}\b|\bBVM\s?\d{0,2}\b|\bBV\d{1,2}\b|\bCVT\b|\bPowershift\b/i;
const POWER_RE = /(\d{2,3})\s*(ch|cv)\b/i;
function parseDescription(description) {
  const parts = (description || "").split(",").map((p) => p.trim()).filter(Boolean);
  const model = parts[0] || "";
  const modelYearMatch = (parts[1] || "").match(/(\d{4}\.\d{2})/);
  const modelYear = modelYearMatch ? modelYearMatch[1] : "";
  const bodyType = parts[2] || "";
  let colorIdx = -1;
  let uphIdx = -1;
  let engineIdx = -1;
  let trim = "";
  for (let i = 1; i < parts.length; i++) {
    const seg = parts[i];
    if (/sellerie|leather|tissu|cuir|vinyl|sedili|trimmed/i.test(seg)) { uphIdx = i; break; }
    const isTech = TECH_SPEC_RE.test(seg);
    const isColorMatch = !isTech && !/blue\s*cruise/i.test(seg) && COLOR_KEYWORD_RE.test(seg);
    if (isTech && engineIdx === -1) engineIdx = i;
    if (isColorMatch && colorIdx === -1) colorIdx = i;
    if (!isTech && !isColorMatch && engineIdx === -1 && colorIdx === -1 && i >= 3 && !/^\d+\s*l[1-4]\b/i.test(seg)) trim = seg;
  }
  const color = colorIdx >= 0
    ? parts[colorIdx]
        .replace(/^peinture\s+(non[\s-]+)?m[ée]tallis[ée]e?\s*:?\s*-?\s*/i, "")
        .replace(/^peinture\s+solide\s*:?\s*-?\s*/i, "")
        .trim()
    : "";
  const specEnd = colorIdx >= 0 ? colorIdx : uphIdx >= 0 ? uphIdx : parts.length;
  const specText = parts.slice(1, specEnd).join(" | ");
  const powerMatch = specText.match(POWER_RE);
  const power = powerMatch ? powerMatch[1] : "";
  const gbMatch = specText.match(GEARBOX_RE);
  const gearbox = gbMatch ? gbMatch[0].toUpperCase().replace(/\s+/g, "") : "";
  const specLow = specText.toLowerCase();
  const modelLow = model.toLowerCase();
  let energy = "";
  if (/hybride\s*rechargeable|\bphev\b/.test(specLow)) energy = "Hybride rechargeable";
  else if (/\belectrique\b|électrique/.test(specLow)) energy = "Électrique";
  else if (/\d+\s?kwh/.test(specLow) && !/hybrid/.test(specLow)) energy = "Électrique";
  else if (/\bev\b|mach-e|gen-e/i.test(modelLow)) energy = "Électrique";
  else if (/\bhybrid(e)?\b/.test(specLow)) energy = "Hybride";
  else if (/\bmhev\b/.test(specLow)) energy = "Hybride léger";
  const batteryMatch = specText.match(/(\d{2,3}(?:[.,]\d+)?)\s*kwh/i);
  const battery = batteryMatch ? batteryMatch[1].replace(",", ".") : "";
  const lengthMatch = specText.match(/\bL[1-4]\b/i);
  const length = lengthMatch ? lengthMatch[0].toUpperCase() : "";
  const optionsStart = (uphIdx >= 0 ? uphIdx : Math.max(colorIdx, 0)) + 1;
  const options = parts.slice(optionsStart).filter(Boolean);
  return { model, modelYear, bodyType, trim, color, power, gearbox, energy, battery, length, options };
}
function ModelYearLabel({ v, dark, className }) {
  return (
    <span className={className}>
      {displayModelBase(v)}
      {v.modelYear && <span className={`font-normal italic ${dark ? "text-zinc-400" : "text-stone-500"}`}> - {v.modelYear}</span>}
    </span>
  );
}
function bodyCodeOf(model, bodyType) {
  if (model !== "Transit Custom") return "";
  const bt = (bodyType || "").toUpperCase().trim();
  if (bt.includes("KOMBI FG") || bt.includes("KOMBI-FG")) return "Kombi FG";
  if (bt.includes("MULTICAB")) return "Multicab";
  if (bt.includes("KOMBI")) return "Kombi";
  if (bt === "CA" || bt.includes("CABINE APPROFONDIE")) return "CA";
  if (bt === "FG" || bt.includes("FOURGON")) return "FG";
  return "";
}
function displayModelBase(v) {
  const bits = [v.model];
  const bc = v.bodyCode !== undefined ? v.bodyCode : bodyCodeOf(v.model, v.bodyType);
  if (bc) bits.push(bc);
  if (v.vu && v.length && !/courier/i.test(v.model)) bits.push(v.length);
  return bits.join(" ");
}
function displayModel(v) {
  const base = displayModelBase(v);
  return v.modelYear ? `${base} - ${v.modelYear}` : base;
}
function transmissionType(energy, gearbox) {
  if (energy === "Électrique") return "Automatique";
  const gb = (gearbox || "").toUpperCase();
  if (!gb) return "";
  if (gb.includes("BVA") || gb === "CVT" || gb === "POWERSHIFT" || gb === "BV10") return "Automatique";
  if (gb.includes("BVM") || /^BV\d+$/.test(gb)) return "Manuelle";
  return "";
}
function gearboxLabel(v) {
  if (v.energy === "Électrique") return "BVA";
  return v.gearbox || "—";
}
function powerLabel(v) {
  if (v.energy === "Électrique") return v.battery ? `${v.battery} kWh` : "—";
  return v.power ? `${v.power} ch` : "—";
}
async function exportVehiclesToExcel(vehicles) {
  const XLSX = await loadXLSX();
  const rows = vehicles.map((v) => ({
    "N° commande": v.orderNumber,
    "Véhicule": displayModel(v),
    "Finition": v.trim || "",
    "Couleur": v.color || "",
    "VIN": v.vin || "",
    "Concession": v.concession || "",
    "Statut": STATUS_META[v.baseStatus]?.label || v.baseStatus,
    "Réservé par": activeReservationVendeur(v),
    "Vendu par": v.venduPar || "",
    "Client": v.clientLabel || "",
    "Type de vente": v.typeVente || "",
    "Boîte": gearboxLabel(v),
    [v.energy === "Électrique" ? "Batterie" : "Puissance"]: powerLabel(v),
    "Jours en stock": v.inStock ? v.joursStock : "",
    "Fourchette d'arrivée": fmtRange(v.estRange) || "",
  }));
  const ws = XLSX.utils.json_to_sheet(rows);
  ws["!cols"] = Object.keys(rows[0] || {}).map((k) => ({ wch: Math.max(k.length, 14) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Véhicules");
  const stamp = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `parclive-export-${stamp}.xlsx`);
}
async function exportDossiersToExcel(dossiers) {
  const XLSX = await loadXLSX();
  const rows = dossiers.map((d) => ({
    "N° usine": d.numeroUsine || "",
    "Vendeur": d.vendeur || "",
    "Client": d.societe || [d.prenom, d.nom].filter(Boolean).join(" ") || "",
    "Modèle": d.vehicle ? displayModelBase(d.vehicle) : d.modele || "",
    "Localisation": d.localisation || "",
    "Catégorie": d.categorie || "",
    "Statut livraison": d.statutLivraison || "",
    "Date de commande": d.dateCmd || "",
    "Bon de commande": d.bonCmd || "",
    "Financement": d.financeOrganisme || "",
    "Rapproché": d.vehicle ? "Oui" : "Non",
  }));
  const ws = XLSX.utils.json_to_sheet(rows);
  ws["!cols"] = Object.keys(rows[0] || {}).map((k) => ({ wch: Math.max(k.length, 14) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Dossiers");
  const stamp = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `parclive-dossiers-${stamp}.xlsx`);
}
async function exportVendeursToExcel(vendeursList) {
  const XLSX = await loadXLSX();
  const rows = vendeursList.map((v) => ({
    "Nom": v.nom,
    "Email": v.email || "",
    "Site": v.site || "",
    "Rôle": v.role || "Vendeur",
    "Dernière connexion": v.lastLogin ? new Date(v.lastLogin).toLocaleString("fr-FR") : "Jamais",
  }));
  const ws = XLSX.utils.json_to_sheet(rows);
  ws["!cols"] = Object.keys(rows[0] || {}).map((k) => ({ wch: Math.max(k.length, 20) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Vendeurs");
  const stamp = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `parclive-vendeurs-${stamp}.xlsx`);
}
async function exportFullBackup(vehicles, dossiers, vendeursList) {
  const XLSX = await loadXLSX();
  const wb = XLSX.utils.book_new();

  const vRows = vehicles.map((v) => ({
    "N° commande": v.orderNumber,
    "Véhicule": displayModel(v),
    "VIN": v.vin || "",
    "Concession": v.concession || "",
    "Statut": STATUS_META[v.baseStatus]?.label || v.baseStatus,
    "Réservé par": activeReservationVendeur(v),
    "Vendu par": v.venduPar || "",
    "Client": v.clientLabel || v.reservation?.client || "",
    "Type de vente": v.typeVente || "",
  }));
  if (vRows.length > 0) {
    const wsV = XLSX.utils.json_to_sheet(vRows);
    wsV["!cols"] = Object.keys(vRows[0]).map((k) => ({ wch: Math.max(k.length, 14) }));
    XLSX.utils.book_append_sheet(wb, wsV, "Véhicules");
  }

  const dRows = dossiers.map((d) => ({
    "N° usine": d.numeroUsine || "",
    "Vendeur": d.vendeur || "",
    "Client": d.societe || [d.prenom, d.nom].filter(Boolean).join(" ") || "",
    "Modèle": d.vehicle ? displayModelBase(d.vehicle) : d.modele || "",
    "Localisation": d.localisation || "",
    "Statut livraison": d.statutLivraison || "",
  }));
  if (dRows.length > 0) {
    const wsD = XLSX.utils.json_to_sheet(dRows);
    wsD["!cols"] = Object.keys(dRows[0]).map((k) => ({ wch: Math.max(k.length, 14) }));
    XLSX.utils.book_append_sheet(wb, wsD, "Dossiers");
  }

  const vdRows = vendeursList.map((v) => ({
    "Nom": v.nom,
    "Site": v.site || "",
    "Rôle": v.role || "Vendeur",
  }));
  if (vdRows.length > 0) {
    const wsVd = XLSX.utils.json_to_sheet(vdRows);
    wsVd["!cols"] = Object.keys(vdRows[0]).map((k) => ({ wch: Math.max(k.length, 14) }));
    XLSX.utils.book_append_sheet(wb, wsVd, "Vendeurs");
  }

  const stamp = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `parclive-sauvegarde-complete-${stamp}.xlsx`);
}
const ROLES = ["Directeur de plaque", "Chef des ventes", "Responsable de site", "Vendeur", "Secrétariat", "Préparateur", "Marketing"];
const PERMISSION_KEYS = ["reserve", "reserveForOthers", "dashboard", "import", "dossiers", "accidentes", "vendeurs", "reset"];
const ROLE_PERMISSIONS = {
  "Directeur de plaque": { reserve: true, reserveForOthers: true, dashboard: true, import: true, dossiers: true, accidentes: true, vendeurs: true, reset: true },
  "Chef des ventes": { reserve: true, reserveForOthers: true, dashboard: true, import: true, dossiers: true, accidentes: true, vendeurs: true, reset: true },
  "Responsable de site": { reserve: true, reserveForOthers: true, dashboard: true, import: true, dossiers: true, accidentes: true, vendeurs: false, reset: false },
  "Vendeur": { reserve: true, reserveForOthers: false, dashboard: false, import: false, dossiers: false, accidentes: false, vendeurs: false, reset: false },
  "Secrétariat": { reserve: false, reserveForOthers: false, dashboard: true, import: true, dossiers: true, accidentes: true, vendeurs: false, reset: false },
  "Préparateur": { reserve: false, reserveForOthers: false, dashboard: false, import: false, dossiers: false, accidentes: true, vendeurs: false, reset: false },
  // Statut Marketing : consultation du stock et du tableau de bord ; l'onglet Marketing (bêta) est géré par marketing_members.
  "Marketing": { reserve: false, reserveForOthers: false, dashboard: true, import: false, dossiers: false, accidentes: false, vendeurs: false, reset: false },
};
const DEFAULT_PERMISSIONS = ROLE_PERMISSIONS["Vendeur"];
function isSuperAdmin(name) {
  const n = (name || "").toLowerCase();
  return n.includes("beaumont") && n.includes("steven");
}
function findVendeur(vendeursList, name) {
  return vendeursList.find((v) => v.nom === name) || null;
}
function getPermissions(vendorName, vendeursList) {
  if (isSuperAdmin(vendorName)) {
    const all = {};
    PERMISSION_KEYS.forEach((k) => (all[k] = true));
    return all;
  }
  const vd = findVendeur(vendeursList, vendorName);
  const base = ROLE_PERMISSIONS[vd?.role] || DEFAULT_PERMISSIONS;
  return { ...base, ...(vd?.permOverrides || {}) };
}
function activeReservationVendeur(v) {
  return v.reservation?.statut && v.reservation.statut !== "Réservation annulée" ? v.reservation.vendeur || "" : "";
}
function vehicleEffectiveSite(v, siteByVendeur) {
  if (v.siteLocation) return v.siteLocation;
  const nom = v.venduPar || activeReservationVendeur(v);
  return nom ? siteByVendeur.get(nom) || "" : "";
}
function normalizeOrderNum(s) {
  return String(s || "").trim().replace(/^0+(?=\d)/, "");
}
function groupCount(arr, keyFn) {
  const map = {};
  arr.forEach((x) => {
    const k = keyFn(x) || "—";
    map[k] = (map[k] || 0) + 1;
  });
  return Object.entries(map)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
}
function fmtRange(range) {
  if (!range || !range.start || !range.end || isNaN(range.start) || isNaN(range.end)) return null;
  const short = { day: "2-digit", month: "2-digit" };
  const long = { day: "2-digit", month: "2-digit", year: "numeric" };
  return `${range.start.toLocaleDateString("fr-FR", short)} → ${range.end.toLocaleDateString("fr-FR", long)}`;
}

const VENDU_TYPE_CODES = ["AAA", "DAD", "FAB", "FLA", "FLC", "FSA"];
function venduLabel(v) {
  if (!v.vendu) return "";
  return v.venduPar ? `Vendu par ${v.venduPar}` : `Vendu · type ${v.typeVente}`;
}
function clientLine(v) {
  if (v.vendu && v.clientLabel) return v.clientLabel;
  if (v.reservation?.client && activeReservationVendeur(v)) return v.reservation.client;
  return "";
}

// ---------------------------------------------------------------------------
// Vehicle derivation (join order + stock + user overlay, compute status/alerts)
// ---------------------------------------------------------------------------
const DEFAULT_ALERT_SETTINGS = { arriveeRecente: 3, resaExpireBientot: 2, resaLongue: 21, challengeSeuilJours: 45 };
const DEFAULT_CHALLENGE_CONFIG = { actif: false, montantParVehicule: 50, dateDebut: "", dateFin: "" };
const DEFAULT_DOCUMENTS_CONFIG = { folderUrl: "" };
function driveEmbedUrl(shareUrl) {
  if (!shareUrl) return "";
  const match = shareUrl.match(/\/folders\/([a-zA-Z0-9_-]+)/) || shareUrl.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  const id = match ? match[1] : null;
  if (!id) return "";
  return `https://drive.google.com/embeddedfolderview?id=${id}#grid`;
}
const COMMENT_CATEGORIES = {
  "Général": { light: "bg-stone-100 text-stone-600", dark: "bg-zinc-800 text-zinc-300" },
  "Livraison": { light: "bg-sky-50 text-sky-700", dark: "bg-sky-500/15 text-sky-300" },
  "Mécanique": { light: "bg-emerald-50 text-emerald-700", dark: "bg-emerald-500/15 text-emerald-300" },
  "Dommage": { light: "bg-rose-50 text-rose-700", dark: "bg-rose-500/15 text-rose-300" },
};
function buildVehicle(order, stock, overlay, dossier, isAccidented, manualSale, alertSettings, comments) {
  const { model, modelYear, bodyType, trim, color, power, gearbox, energy, battery, length, options: optionsList } = parseDescription(order.description);
  const vu = isVU(model);
  const inStock = !!stock;
  const deliveredToClient = /customer|livre client/i.test(order.localisation || "");
  const reservation = overlay?.reservation || null;
  const activeReservation = !!(reservation && reservation.statut && reservation.statut !== "Réservation annulée");
  const venduByCode = VENDU_TYPE_CODES.includes((order.typeVente || "").toUpperCase().trim());
  const vendu = !!dossier || venduByCode;
  const manualVendeur = typeof manualSale === "string" ? manualSale : manualSale?.vendeur || "";
  const manualClient = typeof manualSale === "string" ? "" : manualSale?.client || "";
  const venduPar = dossier?.vendeur || manualVendeur || "";
  const venduAttribManuelle = !dossier && (!!manualVendeur || !!manualClient);
  const clientLabel = dossier ? (dossier.societe || [dossier.prenom, dossier.nom].filter(Boolean).join(" ")) : manualClient;
  const siteLocation = overlay?.siteLocation || "";

  let baseStatus;
  if (deliveredToClient) baseStatus = "livre_client";
  else if (isAccidented) baseStatus = "hs";
  else if (vendu) baseStatus = "vendu";
  else if (!order.vin) baseStatus = "non_serialise";
  else if (!inStock) baseStatus = "commande";
  else if (activeReservation) baseStatus = "reserve";
  else baseStatus = "disponible";

  const rawOptionsCount = Number(order.options);
  const optionsMismatch = order.options !== "" && !isNaN(rawOptionsCount) && rawOptionsCount !== optionsList.length;
  const extractionWeak = !color && !trim && !!order.description;
  const dataWarning = extractionWeak || optionsMismatch;
  const dataWarningReason = extractionWeak
    ? "Aucune finition ni couleur détectée dans la description — format inhabituel"
    : optionsMismatch
    ? `Le fichier indique ${order.options} option(s), ${optionsList.length} détectée(s)`
    : "";

  const estRange = parseDeliveryRange(order.deliveryEstimate);
  const today = new Date();
  const AS = alertSettings || DEFAULT_ALERT_SETTINGS;
  const alerts = [];
  if (inStock && stock.joursStock <= AS.arriveeRecente) alerts.push({ type: "arrivee", label: "Arrivée récente" });
  if (!inStock && !deliveredToClient && estRange?.end && estRange.end < today)
    alerts.push({ type: "retard", label: "Délai de livraison dépassé" });
  if (activeReservation && reservation.dateFin) {
    const fin = new Date(reservation.dateFin);
    if (!isNaN(fin)) {
      const diffDays = (fin - today) / 86400000;
      if (diffDays < 0) alerts.push({ type: "resa_expiree", label: "Réservation expirée" });
      else if (diffDays <= AS.resaExpireBientot) alerts.push({ type: "resa_bientot", label: "Réservation expire bientôt" });
    }
  }
  if (activeReservation && reservation.dateDebut) {
    const debut = new Date(reservation.dateDebut);
    if (!isNaN(debut)) {
      const diffDays = (today - debut) / 86400000;
      if (diffDays > AS.resaLongue) alerts.push({ type: "resa_longue", label: "Réservé depuis longtemps" });
    }
  }

  return {
    ...order,
    model,
    modelYear,
    bodyType,
    bodyCode: bodyCodeOf(model, bodyType),
    siteLocation,
    comments: comments || [],
    transmission: transmissionType(energy, gearbox),
    trim,
    color,
    power,
    gearbox,
    energy,
    battery,
    length,
    optionsList,
    vu,
    inStock,
    joursStock: stock ? stock.joursStock : null,
    codesNotes: stock ? stock.codesNotes : "",
    deliveredToClient,
    reservation,
    vendu,
    venduPar,
    venduAttribManuelle,
    clientLabel,
    dataWarning,
    dataWarningReason,
    history: overlay?.history || [],
    baseStatus,
    alerts,
    estRange,
  };
}

const STATUS_META = {
  disponible: { label: "Disponible", dot: "bg-emerald-500", text: "text-emerald-800", bg: "bg-emerald-100", textDark: "text-emerald-300", bgDark: "bg-emerald-500/20" },
  reserve: { label: "Réservé", dot: "bg-orange-500", text: "text-orange-800", bg: "bg-orange-100", textDark: "text-orange-300", bgDark: "bg-orange-500/20" },
  vendu: { label: "Vendu", dot: "bg-violet-600", text: "text-violet-800", bg: "bg-violet-100", textDark: "text-violet-300", bgDark: "bg-violet-500/20" },
  hs: { label: "HS", dot: "bg-rose-600", text: "text-rose-800", bg: "bg-rose-100", textDark: "text-rose-300", bgDark: "bg-rose-500/20" },
  commande: { label: "Commandé", dot: "bg-zinc-400", text: "text-zinc-700", bg: "bg-zinc-200", textDark: "text-zinc-300", bgDark: "bg-zinc-500/20" },
  non_serialise: { label: "Non sérialisé", dot: "bg-indigo-500", text: "text-indigo-800", bg: "bg-indigo-100", textDark: "text-indigo-300", bgDark: "bg-indigo-500/20" },
  livre_client: { label: "Livré client", dot: "bg-zinc-600", text: "text-zinc-700", bg: "bg-zinc-200", textDark: "text-zinc-200", bgDark: "bg-zinc-600/20" },
};
const STATUS_ACCENT = {
  disponible: "#10B981",
  reserve: "#F97316",
  vendu: "#7C3AED",
  hs: "#E11D48",
  commande: "#A1A1AA",
  non_serialise: "#6366F1",
  livre_client: "#71717A",
};
const STATUS_LABEL_COLORS = Object.fromEntries(
  Object.entries(STATUS_META).map(([key, meta]) => [meta.label, STATUS_ACCENT[key]])
);

// ---------------------------------------------------------------------------
// Small presentational components
// ---------------------------------------------------------------------------
function StatusBadge({ vehicle, dark }) {
  const meta = STATUS_META[vehicle.baseStatus];
  const label = vehicle.baseStatus === "reserve" && vehicle.reservation?.statut ? vehicle.reservation.statut : meta.label;
  return (
    <span title={label} className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${dark ? meta.bgDark + " " + meta.textDark : meta.bg + " " + meta.text}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
      {label}
    </span>
  );
}

function VehicleTypeIcon({ vu, dark, size }) {
  const Icon = vu ? Truck : Car;
  const dims = size === "sm" ? "h-6 w-6" : "h-8 w-8";
  const iconSize = size === "sm" ? 13 : 16;
  return (
    <span
      className={`inline-flex ${dims} items-center justify-center rounded-lg ring-1 ${dark ? "bg-blue-700/10 text-blue-500 ring-blue-700/20" : "bg-blue-50 text-blue-800 ring-blue-200"}`}
      title={vu ? "Véhicule Utilitaire" : "Véhicule Particulier"}
    >
      <Icon size={iconSize} />
    </span>
  );
}

function PageHeader({ dark, title, subtitle }) {
  return (
    <div className="min-w-0 pb-1">
      <h1 className={`text-[26px] font-semibold leading-8 tracking-tight ${dark ? "text-zinc-50" : "text-stone-900"}`}>{title}</h1>
      {subtitle && <p className={`mt-0.5 text-sm ${dark ? "text-zinc-400" : "text-stone-500"}`}>{subtitle}</p>}
    </div>
  );
}

function EmptyState({ dark, icon: Icon, title, subtitle, size }) {
  const compact = size === "sm";
  return (
    <div className={`rounded-2xl border text-center ${compact ? "p-6" : "p-10"} ${dark ? "border-zinc-800 bg-zinc-900/40" : "border-stone-200 bg-white"}`}>
      {Icon && (
        <span className={`mx-auto mb-2.5 flex ${compact ? "h-9 w-9" : "h-11 w-11"} items-center justify-center rounded-full ${dark ? "bg-zinc-800 text-zinc-500" : "bg-stone-100 text-stone-400"}`}>
          <Icon size={compact ? 16 : 20} />
        </span>
      )}
      <div className={`font-medium ${compact ? "text-sm" : "text-sm"} ${dark ? "text-zinc-400" : "text-stone-500"}`}>{title}</div>
      {subtitle && <div className={`mt-1 text-xs ${dark ? "text-zinc-600" : "text-stone-400"}`}>{subtitle}</div>}
    </div>
  );
}
function KPICard({ label, value, dark, onClick, size }) {
  const compact = size === "sm";
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      onClick={onClick}
      className={`w-full rounded-2xl border text-left transition-all ${compact ? "px-3.5 py-3" : "px-5 py-4"} ${
        dark ? "bg-zinc-900/60 border-zinc-800" : "bg-white border-stone-200 shadow-sm"
      } ${onClick ? `pl-interactive cursor-pointer ${dark ? "hover:border-zinc-700 hover:bg-zinc-900" : "hover:border-stone-300 hover:shadow-md"}` : ""}`}
    >
      <div className={`font-medium ${compact ? "text-xs" : "text-[13px]"} ${dark ? "text-zinc-400" : "text-stone-500"}`}>{label}</div>
      <div className={`font-display font-semibold tabular-nums ${compact ? "mt-0.5 text-xl" : "mt-1 text-[32px] leading-9"} ${dark ? "text-zinc-50" : "text-stone-900"}`}>{value}</div>
    </Tag>
  );
}
function DashboardSection({ dark, icon: Icon, title, children }) {
  return (
    <div className="space-y-3">
      <div className={`flex items-center gap-2 text-[15px] font-semibold ${dark ? "text-zinc-100" : "text-stone-900"}`}>
        <Icon size={16} className={dark ? "text-zinc-500" : "text-stone-400"} />
        {title}
      </div>
      {children}
    </div>
  );
}


const NAV_ICONS = {
  vehicules: Car,
  logistique: Truck,
  convoyage: ArrowRightLeft,
  prospection: Target,
  marketing: Megaphone,
  challenge: Trophy,
  dashboard: TrendingUp,
  dossiers: FileText,
  documents: FolderOpen,
  reglages: Settings,
  vendeurs: Users,
  permissions: Lock,
  accidentes: AlertTriangle,
  rdv: CalendarClock,
};
function buildNavItems(permissions, dossierUnmatchedCount, canProspect, canMarketing, rdvMe, rdvOverdueCount) {
  return [
    { id: "vehicules", label: "Véhicules", group: "Stock" },
    { id: "logistique", label: "Logistique", group: "Stock" },
    permissions.accidentes && { id: "accidentes", label: "Accidentés", group: "Stock" },
    canProspect && { id: "prospection", label: "Prospection", group: "Commercial", beta: true },
    permissions.dossiers && { id: "dossiers", label: "Dossiers", count: dossierUnmatchedCount, group: "Commercial" },
    canMarketing && { id: "marketing", label: "Marketing", group: "Commercial", beta: true },
    rdvMe && { id: "rdv", label: rdvMe.role === "admin" ? "Rapports RDV" : "Mes RDV", group: "Commercial", beta: true, count: rdvOverdueCount },
    permissions.dashboard && { id: "dashboard", label: "Tableau de bord", group: "Pilotage" },
    permissions.vendeurs && { id: "reglages", label: "Réglages", group: "Administration" },
  ].filter(Boolean);
}
function Sidebar({ dark, tab, setTab, accidentCount, dossierUnmatchedCount, permissions, vendorName, canProspect, canMarketing, rdvMe, rdvOverdueCount }) {
  const items = buildNavItems(permissions, dossierUnmatchedCount, canProspect, canMarketing, rdvMe, rdvOverdueCount);
  let lastGroup = null;
  return (
    <nav className="sticky top-20 flex w-52 shrink-0 flex-col gap-0.5 self-start">
      {items.map((it, idx) => {
        const Icon = NAV_ICONS[it.id];
        const active = tab === it.id;
        const showGroupLabel = it.group !== lastGroup;
        lastGroup = it.group;
        return (
          <div key={it.id}>
            {showGroupLabel && (
              <div className={`px-3 pb-1.5 text-[11px] font-medium ${idx === 0 ? "pt-0" : "pt-5"} ${dark ? "text-zinc-500" : "text-stone-400"}`}>{it.group}</div>
            )}
            <button
              onClick={() => setTab(it.id)}
              className={`pl-interactive flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-[13.5px] font-medium transition-colors ${
                active ? (dark ? "bg-blue-500/10 text-blue-300" : "bg-blue-50 text-blue-700") : dark ? "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100" : "text-stone-500 hover:bg-stone-100 hover:text-stone-900"
              }`}
            >
              <Icon size={16} className="shrink-0" />
              <span className="flex-1 truncate text-left">{it.label}</span>
              {it.beta && !it.count && (isSuperAdmin(vendorName) || it.id === "marketing" || it.id === "rdv") && (
                <span className={`rounded-full px-1.5 py-px text-[9px] font-semibold ${dark ? "bg-blue-500/15 text-blue-300" : "bg-blue-100/70 text-blue-700"}`}>
                  Bêta
                </span>
              )}
              {!!it.count && (
                <span className="flex h-4 min-w-[16px] items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-semibold text-white">
                  {it.count}
                </span>
              )}
            </button>
          </div>
        );
      })}
    </nav>
  );
}

function Tabs({ dark, tab, setTab, accidentCount, dossierUnmatchedCount, permissions, vendorName, canProspect, canMarketing, rdvMe, rdvOverdueCount }) {
  const items = buildNavItems(permissions, dossierUnmatchedCount, canProspect, canMarketing, rdvMe, rdvOverdueCount);
  let lastGroup = null;
  return (
    <div className={`flex max-w-full items-center gap-1 overflow-x-auto rounded-xl border p-1 ${dark ? "bg-zinc-900/60 border-zinc-800" : "bg-white border-stone-200 shadow-sm"}`} style={{ scrollbarWidth: "none" }}>
      {items.map((it) => {
        const showDivider = it.group !== lastGroup && lastGroup !== null;
        lastGroup = it.group;
        return (
          <Fragment key={it.id}>
            {showDivider && <span className={`mx-0.5 h-5 w-px shrink-0 ${dark ? "bg-zinc-800" : "bg-stone-200"}`} />}
            <button
              onClick={() => setTab(it.id)}
              className={`pl-interactive flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium sm:px-4 ${
                tab === it.id
                  ? (dark ? "bg-blue-500/10 text-blue-300" : "bg-blue-50 text-blue-700")
                  : dark
                  ? "text-zinc-400 hover:text-zinc-200"
                  : "text-stone-500 hover:text-stone-800"
              }`}
            >
              {it.label}
              {it.beta && (isSuperAdmin(vendorName) || it.id === "marketing" || it.id === "rdv") && (
                <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${tab === it.id ? "bg-white/25 text-white" : dark ? "bg-blue-500/20 text-blue-400" : "bg-blue-100 text-blue-800"}`}>
                  Bêta
                </span>
              )}
              {!!it.count && (
                <span className={`flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 text-[10px] font-bold ${tab === it.id ? "bg-white/25 text-white" : "bg-rose-500 text-white"}`}>
                  {it.count}
                </span>
              )}
            </button>
          </Fragment>
        );
      })}
    </div>
  );
}

function TopBar({ dark, setDark, vendorName, onOpenPasswordModal, onLogout, onImport, onRefresh, lastSync, alertCount, onOpenAlerts, syncing, legendOpen, setLegendOpen, canImport, navAccess }) {
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const btnCls = `flex h-9 items-center justify-center rounded-lg transition-colors ${dark ? "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100" : "text-stone-500 hover:bg-stone-100 hover:text-stone-900"}`;
  const btnOutline = `border ${dark ? "border-zinc-800 hover:border-zinc-700" : "border-stone-200 hover:border-stone-300"}`;
  return (
    <div className={`sticky top-0 z-20 border-b backdrop-blur-md ${dark ? "border-zinc-800/80 bg-zinc-950/80" : "border-stone-200/70 bg-white/80"}`}>
    <div className="mx-auto flex w-full max-w-[1400px] flex-wrap items-center gap-1.5 px-4 py-2.5 md:px-8">
      <div className="mr-2 flex items-center gap-2.5">
        <span className="relative flex h-8 w-8 items-center justify-center rounded-[10px] bg-gradient-to-br from-blue-500 to-blue-800 text-white shadow-md">
          <Car size={16} />
          <span className={`absolute -bottom-0.5 -right-0.5 flex h-2.5 w-2.5 rounded-full border-2 ${dark ? "border-zinc-950 bg-emerald-400" : "border-white bg-emerald-500"}`} title="Synchronisé en direct" />
        </span>
        <span className={`text-[17px] font-semibold tracking-tight ${dark ? "text-zinc-50" : "text-stone-900"}`}>
          Parc<span className={dark ? "text-blue-400" : "text-blue-700"}>Live</span>
        </span>
      </div>
      <div className={`hidden text-xs sm:block ${dark ? "text-zinc-500" : "text-stone-400"}`}>
        {lastSync ? `Synchronisé à ${lastSync.toLocaleTimeString("fr-FR")}` : ""}
      </div>
      <div className="flex-1" />
      <button onClick={onOpenAlerts} className={`relative w-9 ${btnCls}`}>
        <Bell size={16} />
        {alertCount > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">
            {alertCount}
          </span>
        )}
      </button>
      <button onClick={onRefresh} className={`w-9 ${btnCls}`}>
        <RefreshCw size={16} className={syncing ? "animate-spin" : ""} />
      </button>
      {canImport && (
        <button onClick={onImport} title="Importer" className={`gap-1.5 px-2.5 text-sm font-medium sm:px-3 ${btnCls} ${btnOutline}`}>
          <Upload size={14} /> <span className="hidden sm:inline">Importer</span>
        </button>
      )}
      <div className="relative hidden sm:block">
        <button onClick={() => setLegendOpen((o) => !o)} className={`w-9 ${btnCls}`} title="Légende & aide">
          <Info size={16} />
        </button>
        {legendOpen && (
          <>
            <div className="fixed inset-0 z-30" onClick={() => setLegendOpen(false)} />
            <div className={`absolute right-0 z-40 mt-1 w-72 space-y-1.5 rounded-xl border p-3 shadow-lg ${dark ? "bg-zinc-900 border-zinc-800" : "bg-white border-stone-200"}`}>
              <div className={`mb-1.5 text-[11px] font-bold uppercase tracking-widest ${dark ? "text-zinc-400" : "text-stone-500"}`}>Statuts</div>
              {Object.entries(STATUS_META)
                .filter(([key]) => key !== "livre_client")
                .map(([key, meta]) => (
                  <div key={key} className="flex items-center gap-2 text-sm">
                    <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${meta.dot}`} />
                    <span className={dark ? "text-zinc-200" : "text-stone-700"}>{meta.label}</span>
                  </div>
                ))}
              <div className={`mb-1.5 mt-3 border-t pt-2.5 text-[11px] font-bold uppercase tracking-widest ${dark ? "border-zinc-800 text-zinc-400" : "border-stone-200 text-stone-500"}`}>Onglets</div>
              <ul className={`space-y-1.5 text-xs ${dark ? "text-zinc-400" : "text-stone-500"}`}>
                <li><span className={`font-semibold ${dark ? "text-zinc-200" : "text-stone-700"}`}>Véhicules</span> — parc complet, recherche, réservation</li>
                <li><span className={`font-semibold ${dark ? "text-zinc-200" : "text-stone-700"}`}>Logistique</span> — en stock, en transit, non sérialisés</li>
                <li><span className={`font-semibold ${dark ? "text-zinc-200" : "text-stone-700"}`}>Accidentés</span> — véhicules signalés HS</li>
                {navAccess?.prospect && <li><span className={`font-semibold ${dark ? "text-zinc-200" : "text-stone-700"}`}>Prospection</span> — carte et suivi des prospects B2B</li>}
                <li><span className={`font-semibold ${dark ? "text-zinc-200" : "text-stone-700"}`}>Dossiers</span> — import MyAna, attribution des ventes</li>
                {navAccess?.marketing && <li><span className={`font-semibold ${dark ? "text-zinc-200" : "text-stone-700"}`}>Marketing</span> — projets, tâches et relances</li>}
                {navAccess?.rdv && <li><span className={`font-semibold ${dark ? "text-zinc-200" : "text-stone-700"}`}>{navAccess.rdv === "admin" ? "Rapports RDV" : "Mes RDV"}</span> — rendez-vous clients et suivi</li>}
                <li><span className={`font-semibold ${dark ? "text-zinc-200" : "text-stone-700"}`}>Tableau de bord</span> — statistiques et tendances</li>
                <li><span className={`font-semibold ${dark ? "text-zinc-200" : "text-stone-700"}`}>Réglages</span> — vendeurs, sites, rôles & permissions</li>
              </ul>
            </div>
          </>
        )}
      </div>
      <button onClick={() => setDark(!dark)} className={`w-9 ${btnCls}`} title={dark ? "Mode clair" : "Mode sombre"}>
        {dark ? <Sun size={16} /> : <Moon size={16} />}
      </button>
      <div className="relative">
        <button onClick={() => setUserMenuOpen((o) => !o)} className={`gap-2 px-2.5 text-sm font-medium sm:px-3 ${btnCls} ${btnOutline}`}>
          <User size={14} /> <span className="hidden max-w-[180px] truncate sm:inline">{vendorName || "Compte non relié"}</span>
        </button>
        {userMenuOpen && (
          <>
            <div className="fixed inset-0 z-30" onClick={() => setUserMenuOpen(false)} />
            <div className={`absolute right-0 z-40 mt-1 w-56 rounded-xl border p-1.5 shadow-lg ${dark ? "bg-zinc-900 border-zinc-800" : "bg-white border-stone-200"}`}>
              <button
                onClick={() => { setUserMenuOpen(false); onOpenPasswordModal(); }}
                className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm transition-colors ${dark ? "text-zinc-300 hover:bg-zinc-800" : "text-stone-700 hover:bg-stone-100"}`}
              >
                <Lock size={14} /> Changer mon mot de passe
              </button>
              <button
                onClick={() => { setUserMenuOpen(false); onLogout(); }}
                className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm transition-colors ${dark ? "text-rose-400 hover:bg-zinc-800" : "text-rose-600 hover:bg-stone-100"}`}
              >
                <X size={14} /> Se déconnecter
              </button>
            </div>
          </>
        )}
      </div>
      </div>
    </div>
  );
}

function FiltersPopover({ dark, filters, setFilters, sitesList, typeVentes, vendeurs, models }) {
  const [open, setOpen] = useState(false);
  const selectCls = `h-9 w-full rounded-lg border px-3 text-sm outline-none transition-shadow focus:ring-2 ${dark ? "bg-zinc-950 border-zinc-800 text-zinc-200 focus:ring-blue-700/30" : "bg-white border-stone-200 text-stone-700 focus:ring-blue-700/20"}`;
  const labelCls = `mb-1.5 text-[11px] font-semibold uppercase tracking-widest ${dark ? "text-zinc-500" : "text-stone-400"}`;

  const activeCount =
    (filters.modele !== "all" ? 1 : 0) +
    (filters.site !== "all" ? 1 : 0) +
    (filters.vu !== "all" ? 1 : 0) +
    (filters.statut !== "all" ? 1 : 0) +
    (filters.vendeur !== "all" ? 1 : 0) +
    (filters.carrosserie !== "all" ? 1 : 0) +
    (filters.boite !== "all" ? 1 : 0) +
    (filters.typeVente.length > 0 ? 1 : 0);

  function chipCls(active) {
    return `rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
      active ? "bg-blue-700 text-white" : dark ? "bg-zinc-800 text-zinc-300 hover:bg-zinc-700" : "bg-stone-100 text-stone-600 hover:bg-stone-200"
    }`;
  }
  function toggleTypeVente(code) {
    setFilters((f) => ({ ...f, typeVente: f.typeVente.includes(code) ? f.typeVente.filter((c) => c !== code) : [...f.typeVente, code] }));
  }
  function reset() {
    setFilters((f) => ({ ...f, modele: "all", site: "all", vu: "all", statut: "all", vendeur: "all", carrosserie: "all", boite: "all", typeVente: [] }));
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className={`relative flex h-9 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium ${dark ? "border-zinc-800 text-zinc-300 hover:bg-zinc-800/70" : "border-stone-200 text-stone-600 hover:bg-stone-100"}`}
      >
        <SlidersHorizontal size={14} /> Filtres
        {activeCount > 0 && (
          <span className="flex h-4 min-w-[16px] items-center justify-center rounded-full bg-blue-700 px-1 text-[10px] font-bold text-white">{activeCount}</span>
        )}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className={`absolute right-0 z-20 mt-1 max-h-[75vh] w-72 overflow-y-auto rounded-xl border shadow-lg ${dark ? "bg-zinc-900 border-zinc-800" : "bg-white border-stone-200"}`}>
            {activeCount > 0 && (
              <div className={`border-b p-2.5 ${dark ? "border-zinc-800" : "border-stone-200"}`}>
                <button onClick={reset} className={`w-full rounded-lg py-1.5 text-xs font-semibold underline ${dark ? "text-zinc-400 hover:text-zinc-200" : "text-stone-500 hover:text-stone-800"}`}>
                  Réinitialiser les filtres
                </button>
              </div>
            )}
            <div className="space-y-3 p-3.5">
            <div>
              <div className={labelCls}>Véhicule (modèle)</div>
              <select className={selectCls} value={filters.modele} onChange={(e) => setFilters((f) => ({ ...f, modele: e.target.value }))}>
                <option value="all">Tous les modèles</option>
                {models.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>
            <div>
              <div className={labelCls}>Site</div>
              <select className={selectCls} value={filters.site} onChange={(e) => setFilters((f) => ({ ...f, site: e.target.value }))}>
                <option value="all">Tous les sites</option>
                {sitesList.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
            <div>
              <div className={labelCls}>Type</div>
              <div className="flex gap-1.5">
                {[["all", "VP & VU"], ["vp", "VP"], ["vu", "VU"]].map(([val, lbl]) => (
                  <button key={val} onClick={() => setFilters((f) => ({ ...f, vu: val }))} className={chipCls(filters.vu === val)}>{lbl}</button>
                ))}
              </div>
            </div>
            <div>
              <div className={labelCls}>Carrosserie</div>
              <div className="flex flex-wrap gap-1.5">
                {[["all", "Toutes"], ["CA", "CA"], ["FG", "FG"], ["Kombi", "Kombi"], ["Kombi FG", "Kombi FG"], ["Multicab", "Multicab"]].map(([val, lbl]) => (
                  <button key={val} onClick={() => setFilters((f) => ({ ...f, carrosserie: val }))} className={chipCls(filters.carrosserie === val)}>{lbl}</button>
                ))}
              </div>
            </div>
            <div>
              <div className={labelCls}>Boîte de vitesse</div>
              <div className="flex flex-wrap gap-1.5">
                {[["all", "Toutes"], ["Automatique", "Automatique"], ["Manuelle", "Manuelle"]].map(([val, lbl]) => (
                  <button key={val} onClick={() => setFilters((f) => ({ ...f, boite: val }))} className={chipCls(filters.boite === val)}>{lbl}</button>
                ))}
              </div>
            </div>
            <div>
              <div className={labelCls}>Statut</div>
              <div className="flex flex-wrap gap-1.5">
                {[["all", "Tous"], ["disponible", "Disponible"], ["reserve", "Réservé"], ["vendu", "Vendu"], ["commande", "Commandé"], ["non_serialise", "Non sérialisé"], ["hs", "HS"]].map(([val, lbl]) => (
                  <button key={val} onClick={() => setFilters((f) => ({ ...f, statut: val }))} className={chipCls(filters.statut === val)}>{lbl}</button>
                ))}
              </div>
            </div>
            <div>
              <div className={labelCls}>Type de vente</div>
              <div className={`max-h-28 space-y-0.5 overflow-y-auto rounded-lg border p-1.5 ${dark ? "border-zinc-800" : "border-stone-200"}`}>
                {typeVentes.map((t) => (
                  <label key={t} className={`flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-sm ${dark ? "hover:bg-zinc-800" : "hover:bg-stone-50"}`}>
                    <input type="checkbox" checked={filters.typeVente.includes(t)} onChange={() => toggleTypeVente(t)} className="accent-blue-700" />
                    <span className={dark ? "text-zinc-200" : "text-stone-700"}>{t}</span>
                  </label>
                ))}
              </div>
            </div>
            <div>
              <div className={labelCls}>Vendeur</div>
              <select className={selectCls} value={filters.vendeur} onChange={(e) => setFilters((f) => ({ ...f, vendeur: e.target.value }))}>
                <option value="all">Tous vendeurs</option>
                {vendeurs.map((v) => (
                  <option key={v} value={v}>{v}</option>
                ))}
              </select>
            </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function FilterBar({ dark, filters, setFilters, sitesList, typeVentes, vendeurs, models, sortBy, setSortBy, onExport }) {
  const inputCls = `h-9 rounded-lg border px-3 text-sm outline-none transition-shadow focus:ring-2 ${dark ? "bg-zinc-950 border-zinc-800 text-zinc-200 focus:ring-blue-700/30 focus:border-blue-700/40" : "bg-white border-stone-200 text-stone-700 focus:ring-blue-700/20 focus:border-blue-500"}`;
  return (
    <div className={`flex flex-wrap items-center gap-2 rounded-2xl border p-2.5 shadow-sm ${dark ? "bg-zinc-900/50 border-zinc-800" : "bg-white border-stone-200"}`}>
      <div className={`flex h-9 min-w-[220px] flex-1 items-center gap-2 rounded-lg border px-3 transition-shadow focus-within:ring-2 ${dark ? "bg-zinc-950 border-zinc-800 focus-within:ring-blue-700/30" : "bg-stone-50 border-stone-200 focus-within:ring-blue-700/20"}`}>
        <Search size={14} className={dark ? "text-zinc-500" : "text-stone-400"} />
        <input
          id="parclive-search"
          value={filters.query}
          onChange={(e) => setFilters((f) => ({ ...f, query: e.target.value }))}
          placeholder="Commande, VIN, modèle… (séparez par une virgule)"
          className={`w-full bg-transparent text-sm outline-none ${dark ? "text-zinc-200 placeholder:text-zinc-600" : "text-stone-700 placeholder:text-stone-400"}`}
        />
      </div>
      <FiltersPopover dark={dark} filters={filters} setFilters={setFilters} sitesList={sitesList} typeVentes={typeVentes} vendeurs={vendeurs} models={models} />
      <select className={inputCls} value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
        <option value="recent">Trier : arrivée récente</option>
        <option value="stock_asc">Trier : jours de stock (A→Z)</option>
        <option value="stock_desc">Trier : jours de stock (Z→A)</option>
        <option value="order">Trier : N° commande</option>
        <option value="model">Trier : Modèle</option>
      </select>
      <button
        onClick={onExport}
        className={`flex h-9 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium transition-colors ${dark ? "border-zinc-800 text-zinc-300 hover:bg-zinc-800/70" : "border-stone-200 text-stone-600 hover:bg-stone-100"}`}
      >
        <Download size={14} /> Exporter
      </button>
    </div>
  );
}

function VehicleRow({ v, dark, onSelect, expanded, zebra }) {
  const hasAlert = v.alerts.length > 0;
  const isElectric = v.energy === "Électrique";
  const isPHEV = v.energy === "Hybride rechargeable";
  const metaBits = [v.typeVente, v.trim, v.color, gearboxLabel(v), powerLabel(v)].filter((x) => x && x !== "—");
  const meta = metaBits.length ? metaBits.join(" · ") : "—";
  const baseBg = zebra ? (dark ? "bg-zinc-900/40" : "bg-stone-50") : dark ? "bg-transparent" : "bg-white";
  return (
    <tr
      onClick={() => onSelect(v)}
      className={`group cursor-pointer border-t transition-colors ${baseBg} ${
        expanded ? (dark ? "border-zinc-800 bg-zinc-900/70" : "border-stone-100 bg-blue-50/50") : dark ? "border-zinc-800/70 hover:bg-zinc-800/50" : "border-stone-100 hover:bg-stone-50"
      }`}
      style={{ boxShadow: `inset 3px 0 0 ${hasAlert ? "#E11D48" : STATUS_ACCENT[v.baseStatus] || "transparent"}` }}
    >
      <td className="px-3 py-3 text-center">
        <VehicleTypeIcon vu={v.vu} dark={dark} size="sm" />
        <div className={`mt-1 truncate font-mono text-[11px] font-semibold transition-colors ${dark ? "text-zinc-300 group-hover:text-blue-500" : "text-stone-600 group-hover:text-blue-800"}`}>
          {v.orderNumber}
        </div>
      </td>
      <td className="px-2 py-3" title={v.description}>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <ModelYearLabel v={v} dark={dark} className={`truncate font-semibold ${dark ? "text-zinc-50" : "text-stone-900"}`} />
            {(isElectric || isPHEV) && (
              <Zap size={13} className={`shrink-0 ${isElectric ? (dark ? "text-sky-400" : "text-sky-600") : (dark ? "text-violet-400" : "text-violet-600")}`} aria-label={v.energy}>
                <title>{v.energy}</title>
              </Zap>
            )}
            {v.siteLocation && (
              <span className={`shrink-0 truncate rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${dark ? "bg-sky-500/15 text-sky-300" : "bg-sky-50 text-sky-700"}`} title={`Localisation : ${v.siteLocation}`}>
                {v.siteLocation}
              </span>
            )}
          </div>
          <div className={`truncate text-xs ${dark ? "text-zinc-400" : "text-stone-500"}`} title={meta}>{meta}</div>
        </div>
      </td>
      <td className="px-2 py-3">
        <div className="flex flex-col items-start gap-1">
          <div className="flex items-center gap-1.5">
            <StatusBadge vehicle={v} dark={dark} />
            {v.baseStatus !== "reserve" && v.baseStatus !== "vendu" && activeReservationVendeur(v) && (
              <span title="Déjà réservé, en attente d'arrivée en stock" className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-bold ${dark ? "bg-orange-500/15 text-orange-300" : "bg-orange-50 text-orange-700"}`}>
                <span className="h-1.5 w-1.5 rounded-full bg-orange-500" /> Réservé
              </span>
            )}
            {hasAlert && <AlertTriangle size={13} className="shrink-0 text-rose-500" />}
            {v.comments.length > 0 && (
              <span title={`${v.comments.length} commentaire${v.comments.length > 1 ? "s" : ""}`} className={`flex shrink-0 items-center gap-0.5 text-[10px] font-semibold ${dark ? "text-zinc-500" : "text-stone-400"}`}>
                <MessageSquare size={12} />{v.comments.length}
              </span>
            )}
          </div>
          {v.baseStatus === "vendu" && (
            <>
              <div className={`flex items-center gap-1 truncate text-xs font-medium ${dark ? "text-violet-300" : "text-violet-700"}`} title={venduLabel(v)}>
                <User size={10} className="shrink-0" /> <span className="truncate">{venduLabel(v)}</span>
              </div>
              {clientLine(v) && (
                <div className={`truncate text-xs ${dark ? "text-zinc-500" : "text-stone-400"}`} title={clientLine(v)}>Client : {clientLine(v)}</div>
              )}
            </>
          )}
          {v.baseStatus !== "vendu" && activeReservationVendeur(v) && (
            <>
              <div className={`flex items-center gap-1 truncate text-xs font-medium ${dark ? "text-zinc-300" : "text-stone-600"}`} title={v.reservation.vendeur}>
                <User size={10} className="shrink-0" /> <span className="truncate">{v.reservation.vendeur}</span>
              </div>
              {v.reservation.client && (
                <div className={`truncate text-xs ${dark ? "text-zinc-500" : "text-stone-400"}`}>Client : {v.reservation.client}</div>
              )}
            </>
          )}
        </div>
      </td>
      <td className={`truncate px-2 py-2 font-mono text-xs ${dark ? "text-zinc-400" : "text-stone-500"}`} title={v.vin}>{v.vin || "—"}</td>
      <td className={`truncate px-2 py-2 pr-4 font-medium tabular-nums ${dark ? "text-zinc-200" : "text-stone-700"}`}>
        {v.inStock ? `${v.joursStock} j` : (fmtRange(v.estRange) || "—")}
      </td>
    </tr>
  );
}



function VehicleTable({ dark, vehicles, expandedOrder, onSelect }) {
  const thCls = `sticky top-0 z-10 py-3 text-left text-xs font-medium ${dark ? "bg-zinc-900 text-zinc-400 border-b border-zinc-800" : "bg-white text-stone-500 border-b border-stone-200"}`;
  return (
    <div className={`overflow-hidden rounded-2xl border shadow-sm ${dark ? "border-zinc-800 bg-zinc-900/40" : "border-stone-200 bg-white"}`}>
      <div className="max-h-[640px] overflow-auto">
        <table className="w-full table-fixed text-sm">
          <colgroup>
            <col style={{ width: "9%" }} />
            <col style={{ width: "34%" }} />
            <col style={{ width: "16%" }} />
            <col style={{ width: "16%" }} />
            <col style={{ width: "25%" }} />
          </colgroup>
          <thead>
            <tr>
              <th className={`${thCls} px-3 text-center`}>Véhicule</th>
              <th className={`${thCls} px-2`}>Modèle</th>
              <th className={`${thCls} px-2`}>Statut</th>
              <th className={`${thCls} px-2`}>VIN</th>
              <th className={`${thCls} px-2 pr-4`}>Stock / Arrivée</th>
            </tr>
          </thead>
          <tbody>
            {vehicles.map((v, i) => (
              <VehicleRow key={v.orderNumber} v={v} dark={dark} onSelect={onSelect} expanded={v.orderNumber === expandedOrder} zebra={false} />
            ))}
            {vehicles.length === 0 && (
              <tr>
                <td colSpan={5} className={`px-4 py-10 text-center text-sm ${dark ? "text-zinc-500" : "text-stone-400"}`}>
                  <Car size={20} className="mx-auto mb-2 opacity-50" />
                  Aucun véhicule ne correspond à ces filtres — essayez d'en retirer un.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function VehicleCard({ v, dark, onSelect, expanded }) {
  const hasAlert = v.alerts.length > 0;
  const isElectric = v.energy === "Électrique";
  const isPHEV = v.energy === "Hybride rechargeable";
  const subLine = [v.trim, v.color].filter(Boolean).join(" · ");
  const motorBits = [gearboxLabel(v), powerLabel(v)].filter((x) => x && x !== "—");
  const motor = motorBits.length ? motorBits.join(" · ") : "—";
  return (
    <div
      onClick={() => onSelect(v)}
      className={`pl-interactive cursor-pointer border p-3.5 shadow-sm transition-colors ${expanded ? "rounded-t-xl" : "rounded-xl"} ${
        expanded ? (dark ? "border-blue-700 bg-zinc-900/60" : "border-blue-500 bg-blue-50/50") : dark ? "border-zinc-800 bg-zinc-900/40 active:bg-zinc-800" : "border-stone-200 bg-white active:bg-stone-50"
      }`}
      style={{ boxShadow: `inset 4px 0 0 ${hasAlert ? "#E11D48" : STATUS_ACCENT[v.baseStatus] || "transparent"}` }}
    >
      <div className="flex items-start gap-3">
        <VehicleTypeIcon vu={v.vu} dark={dark} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <ModelYearLabel v={v} dark={dark} className={`truncate font-semibold ${dark ? "text-zinc-50" : "text-stone-900"}`} />
            {(isElectric || isPHEV) && (
              <Zap size={13} className={`shrink-0 ${isElectric ? (dark ? "text-sky-400" : "text-sky-600") : (dark ? "text-violet-400" : "text-violet-600")}`} />
            )}
          </div>
          <div className={`truncate text-xs font-medium ${dark ? "text-zinc-400" : "text-stone-600"}`}>{subLine || "—"}</div>
          <div className={`truncate text-xs ${dark ? "text-zinc-500" : "text-stone-500"}`}>{motor}</div>
        </div>
        <ChevronRight size={16} className={`mt-1 shrink-0 transition-transform ${expanded ? "rotate-90" : ""} ${dark ? "text-zinc-500" : "text-stone-400"}`} />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className={`font-mono text-xs font-semibold ${dark ? "text-zinc-200" : "text-stone-700"}`}>{v.orderNumber}</span>
        <StatusBadge vehicle={v} dark={dark} />
        {v.comments.length > 0 && (
          <span title={`${v.comments.length} commentaire${v.comments.length > 1 ? "s" : ""}`} className={`flex shrink-0 items-center gap-0.5 text-xs font-semibold ${dark ? "text-zinc-500" : "text-stone-400"}`}>
            <MessageSquare size={13} />{v.comments.length}
          </span>
        )}
        {v.baseStatus !== "reserve" && v.baseStatus !== "vendu" && activeReservationVendeur(v) && (
          <span title="Déjà réservé, en attente d'arrivée en stock" className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-bold ${dark ? "bg-orange-500/15 text-orange-300" : "bg-orange-50 text-orange-700"}`}>
            <span className="h-1.5 w-1.5 rounded-full bg-orange-500" /> Réservé
          </span>
        )}
        {v.siteLocation && (
          <span className={`shrink-0 truncate rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${dark ? "bg-sky-500/15 text-sky-300" : "bg-sky-50 text-sky-700"}`}>
            {v.siteLocation}
          </span>
        )}
        {v.baseStatus === "vendu" && (
          <span className={`flex items-center gap-1 text-xs font-medium ${dark ? "text-violet-300" : "text-violet-700"}`}>
            <User size={11} /> {venduLabel(v)}{clientLine(v) && ` · Client : ${clientLine(v)}`}
          </span>
        )}
        {v.baseStatus !== "vendu" && activeReservationVendeur(v) && (
          <span className={`flex items-center gap-1 text-xs font-medium ${dark ? "text-zinc-300" : "text-stone-600"}`}>
            <User size={11} /> {v.reservation.vendeur}{v.reservation.client && ` · Client : ${v.reservation.client}`}
          </span>
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className={`font-medium ${dark ? "text-zinc-300" : "text-stone-600"}`}>{v.typeVente || "—"}</span>
        <span className={`font-medium tabular-nums ${dark ? "text-zinc-300" : "text-stone-600"}`}>
          {v.inStock ? `${v.joursStock} j en stock` : fmtRange(v.estRange) || "—"}
        </span>
      </div>

      {hasAlert && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {v.alerts.map((a, i) => (
            <span key={i} className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${dark ? "bg-rose-500/20 text-rose-300" : "bg-rose-100 text-rose-800"}`}>
              <AlertTriangle size={10} /> {a.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function VehicleCardList({ dark, vehicles, expandedOrder, onSelect }) {
  if (vehicles.length === 0) {
    return <EmptyState dark={dark} icon={Car} title="Aucun véhicule ne correspond à ces filtres" subtitle="Essayez d'en retirer un pour élargir la recherche." />;
  }
  return (
    <div className="space-y-2.5">
      {vehicles.map((v) => (
        <VehicleCard key={v.orderNumber} v={v} dark={dark} onSelect={onSelect} expanded={v.orderNumber === expandedOrder} />
      ))}
    </div>
  );
}

const DONUT_COLORS_LIGHT = ["#1D4ED8", "#0284C7", "#059669", "#DB2777", "#7C3AED", "#64748B"];
const DONUT_COLORS_DARK = ["#3B82F6", "#38BDF8", "#34D399", "#F472B6", "#A78BFA", "#94A3B8"];

function DonutCard({ dark, title, data }) {
  const palette = dark ? DONUT_COLORS_DARK : DONUT_COLORS_LIGHT;
  const colorFor = (d, i) => STATUS_LABEL_COLORS[d.name] || palette[i % palette.length];
  const gridColor = dark ? "#27272A" : "#E7E5E4";
  const total = data.reduce((n, d) => n + d.count, 0);
  return (
    <div className={`rounded-2xl border p-4 ${dark ? "bg-zinc-900/60 border-zinc-800" : "bg-white border-stone-200"}`}>
      <div className={`mb-3 text-[11px] font-semibold uppercase tracking-widest ${dark ? "text-zinc-400" : "text-stone-500"}`}>{title}</div>
      {total === 0 ? (
        <div className={`flex h-[160px] items-center justify-center text-xs ${dark ? "text-zinc-600" : "text-stone-400"}`}>Aucune donnée</div>
      ) : (
        <div className="flex items-center gap-3">
          <ResponsiveContainer width="46%" height={150}>
            <PieChart>
              <Pie data={data} dataKey="count" nameKey="name" innerRadius={38} outerRadius={68} paddingAngle={2} strokeWidth={0}>
                {data.map((_, i) => (
                  <Cell key={i} fill={colorFor(data[i], i)} />
                ))}
              </Pie>
              <Tooltip contentStyle={{ background: dark ? "#18181B" : "#fff", border: `1px solid ${gridColor}`, borderRadius: 10, fontSize: 12 }} />
            </PieChart>
          </ResponsiveContainer>
          <ul className="min-w-0 flex-1 space-y-1.5">
            {data.map((d, i) => (
              <li key={d.name} className="flex items-center gap-2 text-xs">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: colorFor(d, i) }} />
                <span className={`min-w-0 flex-1 truncate ${dark ? "text-zinc-300" : "text-stone-600"}`}>{d.name}</span>
                <span className={`shrink-0 font-semibold tabular-nums ${dark ? "text-zinc-100" : "text-stone-800"}`}>{d.count}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function BarListCard({ dark, title, data, color, layout }) {
  const gridColor = dark ? "#27272A" : "#E7E5E4";
  const tickColor = dark ? "#71717A" : "#A8A29E";
  const tooltipStyle = { background: dark ? "#18181B" : "#fff", border: `1px solid ${gridColor}`, borderRadius: 10, fontSize: 12 };
  return (
    <div className={`rounded-2xl border p-4 ${dark ? "bg-zinc-900/60 border-zinc-800" : "bg-white border-stone-200"}`}>
      <div className={`mb-3 text-[11px] font-semibold uppercase tracking-widest ${dark ? "text-zinc-400" : "text-stone-500"}`}>{title}</div>
      {data.every((d) => d.count === 0) ? (
        <div className={`flex h-[180px] items-center justify-center text-xs ${dark ? "text-zinc-600" : "text-stone-400"}`}>Aucune donnée</div>
      ) : layout === "vertical" ? (
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={data} layout="vertical" margin={{ left: 10 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={gridColor} horizontal={false} />
            <XAxis type="number" tick={{ fill: tickColor, fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
            <YAxis type="category" dataKey="name" tick={{ fill: tickColor, fontSize: 11 }} axisLine={false} tickLine={false} width={100} />
            <Tooltip contentStyle={tooltipStyle} cursor={{ fill: dark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.03)" }} />
            <Bar dataKey="count" fill={color} radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      ) : (
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
            <XAxis dataKey="name" tick={{ fill: tickColor, fontSize: 11 }} axisLine={{ stroke: gridColor }} tickLine={false} />
            <YAxis tick={{ fill: tickColor, fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
            <Tooltip contentStyle={tooltipStyle} cursor={{ fill: dark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.03)" }} />
            <Bar dataKey="count" fill={color} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

function VendeurPerformanceTable({ dark, vehicles, vendeursList, dossiers }) {
  const rows = useMemo(() => {
    const siteByVendeur = new Map(vendeursList.map((v) => [v.nom, v.site]));
    const map = {};
    function ensure(nom) {
      if (!map[nom]) map[nom] = { nom, site: siteByVendeur.get(nom) || "—", ventes: 0, reservations: 0 };
      return map[nom];
    }
    vendeursList.forEach((v) => ensure(v.nom));
    vehicles.forEach((v) => {
      if (v.vendu && v.venduPar) ensure(v.venduPar).ventes++;
      if (activeReservationVendeur(v)) ensure(v.reservation.vendeur).reservations++;
    });
    return Object.values(map)
      .map((r) => ({ ...r, total: r.ventes + r.reservations }))
      .sort((a, b) => b.total - a.total || b.ventes - a.ventes);
  }, [vehicles, vendeursList]);

  const thCls = `px-4 py-2.5 text-xs font-bold uppercase tracking-widest ${dark ? "text-zinc-400" : "text-stone-500"}`;
  const tdCls = `px-4 py-2.5 text-right tabular-nums font-medium ${dark ? "text-zinc-200" : "text-stone-700"}`;

  if (rows.length === 0) {
    return <EmptyState dark={dark} icon={Users} title="Aucun vendeur enregistré" subtitle="Ajoutez-en depuis l'icône réglages en haut." />;
  }

  return (
    <div className={`overflow-hidden rounded-2xl border ${dark ? "border-zinc-800" : "border-stone-200"}`}>
      <table className="w-full text-sm">
        <thead>
          <tr className={dark ? "bg-zinc-900" : "bg-stone-100"}>
            <th className={`${thCls} text-left`}>Vendeur</th>
            <th className={`${thCls} text-left`}>Site</th>
            <th className={`${thCls} text-right`}>Ventes</th>
            <th className={`${thCls} text-right`}>Réservations</th>
            <th className={`${thCls} text-right`}>Total</th>
          </tr>
        </thead>
        <tbody className={`divide-y ${dark ? "divide-zinc-800" : "divide-stone-200"}`}>
          {rows.map((r, i) => (
            <tr key={r.nom} className={dark ? "hover:bg-zinc-900/60" : "hover:bg-blue-50/40"}>
              <td className={`px-4 py-2.5 font-semibold ${dark ? "text-zinc-100" : "text-stone-900"}`}>
                {i === 0 && r.total > 0 && "🥇 "}{i === 1 && r.total > 0 && "🥈 "}{i === 2 && r.total > 0 && "🥉 "}{r.nom}
              </td>
              <td className={`px-4 py-2.5 ${dark ? "text-zinc-400" : "text-stone-500"}`}>{r.site}</td>
              <td className={`${tdCls} ${dark ? "text-violet-400" : "text-violet-600"}`}>{r.ventes}</td>
              <td className={`${tdCls} ${dark ? "text-orange-400" : "text-orange-600"}`}>{r.reservations}</td>
              <td className={tdCls}>{r.total}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SiteComparisonTable({ dark, vehicles }) {
  const rows = useMemo(() => {
    const map = {};
    vehicles.forEach((v) => {
      const c = v.concession || "—";
      if (!map[c]) map[c] = { concession: c, total: 0, disponibles: 0, vendus: 0, reserves: 0, alertes: 0 };
      map[c].total++;
      if (v.baseStatus === "disponible") map[c].disponibles++;
      if (v.baseStatus === "vendu") map[c].vendus++;
      if (v.baseStatus === "reserve") map[c].reserves++;
      map[c].alertes += v.alerts.length;
    });
    return Object.values(map).sort((a, b) => b.total - a.total);
  }, [vehicles]);

  const thCls = `px-4 py-2.5 text-xs font-bold uppercase tracking-widest ${dark ? "text-zinc-400" : "text-stone-500"}`;
  const tdCls = `px-4 py-2.5 text-right tabular-nums font-medium ${dark ? "text-zinc-200" : "text-stone-700"}`;

  return (
    <div className={`overflow-hidden rounded-2xl border ${dark ? "border-zinc-800" : "border-stone-200"}`}>
      <table className="w-full text-sm">
        <thead>
          <tr className={dark ? "bg-zinc-900" : "bg-stone-100"}>
            <th className={`${thCls} text-left`}>Concession</th>
            <th className={`${thCls} text-right`}>Total</th>
            <th className={`${thCls} text-right`}>Disponibles</th>
            <th className={`${thCls} text-right`}>Réservés</th>
            <th className={`${thCls} text-right`}>Vendus</th>
            <th className={`${thCls} text-right`}>Alertes</th>
          </tr>
        </thead>
        <tbody className={`divide-y ${dark ? "divide-zinc-800" : "divide-stone-200"}`}>
          {rows.map((r) => (
            <tr key={r.concession} className={dark ? "hover:bg-zinc-900/60" : "hover:bg-blue-50/40"}>
              <td className={`px-4 py-2.5 font-semibold ${dark ? "text-zinc-100" : "text-stone-900"}`}>{r.concession}</td>
              <td className={tdCls}>{r.total}</td>
              <td className={`${tdCls} ${dark ? "text-emerald-400" : "text-emerald-600"}`}>{r.disponibles}</td>
              <td className={`${tdCls} ${dark ? "text-orange-400" : "text-orange-600"}`}>{r.reserves}</td>
              <td className={`${tdCls} ${dark ? "text-violet-400" : "text-violet-600"}`}>{r.vendus}</td>
              <td className={`${tdCls} ${r.alertes > 0 ? (dark ? "text-rose-400" : "text-rose-600") : ""}`}>{r.alertes}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AlertsSummaryCard({ dark, vehicles }) {
  const counts = {};
  vehicles.forEach((v) => v.alerts.forEach((a) => { counts[a.label] = (counts[a.label] || 0) + 1; }));
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  return (
    <div className={`rounded-2xl border p-4 ${dark ? "bg-zinc-900/60 border-zinc-800" : "bg-white border-stone-200"}`}>
      <div className={`mb-3 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-widest ${dark ? "text-zinc-400" : "text-stone-500"}`}>
        <AlertTriangle size={13} /> Alertes actives
      </div>
      {entries.length === 0 ? (
        <div className={`flex h-[100px] items-center justify-center text-xs ${dark ? "text-zinc-600" : "text-stone-400"}`}>Aucune alerte active</div>
      ) : (
        <ul className="space-y-2">
          {entries.map(([label, count]) => (
            <li key={label} className="flex items-center justify-between gap-2 text-sm">
              <span className={dark ? "text-zinc-300" : "text-stone-600"}>{label}</span>
              <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${dark ? "bg-rose-500/20 text-rose-300" : "bg-rose-100 text-rose-800"}`}>{count}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TrendChart({ dark }) {
  const [data, setData] = useState(null);
  useEffect(() => {
    (async () => {
      try {
        const since = new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);
        const { data: rows, error } = await supabase.from("parclive_snapshots").select("date, stats").gte("date", since).order("date", { ascending: true });
        if (error || !rows) { setData([]); return; }
        setData(rows.map((r) => ({ date: r.date.slice(5), total: r.stats.total ?? 0, disponibles: r.stats.disponibles ?? 0, avgJoursStock: r.stats.avgJoursStock ?? 0 })));
      } catch (e) {
        setData([]);
      }
    })();
  }, []);
  const gridColor = dark ? "#27272A" : "#E7E5E4";
  const tickColor = dark ? "#71717A" : "#A8A29E";
  return (
    <div className={`rounded-2xl border p-4 ${dark ? "bg-zinc-900/60 border-zinc-800" : "bg-white border-stone-200"}`}>
      <div className={`mb-3 text-[11px] font-semibold uppercase tracking-widest ${dark ? "text-zinc-400" : "text-stone-500"}`}>Évolution du parc (30 derniers jours)</div>
      {data === null ? (
        <div className="flex h-[220px] items-center justify-center">
          <RefreshCw size={18} className={`animate-spin ${dark ? "text-zinc-600" : "text-stone-300"}`} />
        </div>
      ) : data.length < 2 ? (
        <div className={`flex h-[220px] items-center justify-center px-6 text-center text-xs ${dark ? "text-zinc-600" : "text-stone-400"}`}>
          Pas encore assez d'historique pour tracer une courbe — un point est enregistré chaque jour, repassez dans quelques jours.
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
            <XAxis dataKey="date" tick={{ fill: tickColor, fontSize: 11 }} axisLine={{ stroke: gridColor }} tickLine={false} />
            <YAxis tick={{ fill: tickColor, fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
            <Tooltip contentStyle={{ background: dark ? "#18181B" : "#fff", border: `1px solid ${gridColor}`, borderRadius: 10, fontSize: 12 }} />
            <Line type="monotone" dataKey="total" stroke={dark ? "#3B82F6" : "#1D4ED8"} strokeWidth={2} dot={false} name="Total véhicules" />
            <Line type="monotone" dataKey="disponibles" stroke={dark ? "#34D399" : "#059669"} strokeWidth={2} dot={false} name="Disponibles" />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

function ExpandedDetail({ v, dark, onClose, onSave, vendorName, vendeursList, sitesList, onUpdateVehicleSite, onAddComment, onDeleteComment }) {
  const myPermissions = getPermissions(vendorName, vendeursList);
  const canReserveForOthers = myPermissions.reserveForOthers;
  const canReserve = myPermissions.reserve;
  function defaultForm() {
    if (v.reservation && v.reservation.statut !== "Réservation annulée") return { client: "", ...v.reservation };
    const today = new Date();
    const plus7 = new Date(Date.now() + 7 * 86400000);
    return { vendeur: vendorName || "", client: "", statut: "Réservé", dateDebut: today.toISOString().slice(0, 10), dateFin: plus7.toISOString().slice(0, 10), commentaire: "" };
  }
  const [form, setForm] = useState(defaultForm);
  const [saved, setSaved] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [commentText, setCommentText] = useState("");
  const [commentCategorie, setCommentCategorie] = useState("Général");
  const myRole = findVendeur(vendeursList, vendorName)?.role || "Vendeur";
  const canModerateComments = isSuperAdmin(vendorName) || myRole === "Chef des ventes" || myRole === "Directeur de plaque";
  function submitComment() {
    if (!commentText.trim()) return;
    onAddComment(v.orderNumber, commentCategorie, commentText.trim());
    setCommentText("");
  }
  useEffect(() => {
    setForm(defaultForm());
    setSaved(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v.orderNumber]);

  const inputCls = `w-full rounded-lg border px-3 py-2 text-sm outline-none transition-shadow focus:ring-2 ${dark ? "bg-zinc-950 border-zinc-800 text-zinc-200 focus:ring-blue-700/30 focus:border-blue-700/40" : "bg-white border-stone-200 text-stone-700 focus:ring-blue-700/20 focus:border-blue-500"}`;

  function save() {
    if (!form.client?.trim()) return;
    const vendeurFinal = form.vendeur || vendorName;
    const statutFinal = form.statut === "Réservation annulée" ? form.statut : "Réservé";
    onSave(v.orderNumber, { ...form, vendeur: vendeurFinal, statut: statutFinal });
    setForm((f) => ({ ...f, vendeur: vendeurFinal, statut: statutFinal }));
    setSaved(true);
    setTimeout(() => setSaved(false), 2200);
  }
  function cancelReservation() {
    const cleared = { ...form, statut: "Réservation annulée" };
    onSave(v.orderNumber, cleared);
    const today = new Date();
    const plus7 = new Date(Date.now() + 7 * 86400000);
    setForm({ vendeur: vendorName || "", client: "", statut: "Réservé", dateDebut: today.toISOString().slice(0, 10), dateFin: plus7.toISOString().slice(0, 10), commentaire: "" });
  }

  return (
    <div
      className={`border-t-2 border-l-4 border-blue-700 px-5 py-5 ${dark ? "bg-zinc-950 border-t-zinc-800" : "bg-stone-50 border-t-stone-200"}`}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2.5">
          <VehicleTypeIcon vu={v.vu} dark={dark} />
          <div>
            <ModelYearLabel v={v} dark={dark} className={`text-base font-bold ${dark ? "text-zinc-50" : "text-stone-900"}`} />
            <div className={`text-xs font-medium ${dark ? "text-zinc-400" : "text-stone-500"}`}>Commande {v.orderNumber} · {v.concession}</div>
          </div>
          <StatusBadge vehicle={v} dark={dark} />
          {v.baseStatus === "vendu" && (
            <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${dark ? "bg-violet-500/20 text-violet-300" : "bg-violet-100 text-violet-800"}`}>
              <User size={11} /> {venduLabel(v)}
            </span>
          )}
          {clientLine(v) && (
            <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${dark ? "bg-zinc-800 text-zinc-300" : "bg-stone-100 text-stone-600"}`}>
              Client : {clientLine(v)}
            </span>
          )}
          {(v.energy === "Électrique" || v.energy === "Hybride rechargeable") && (
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${
                v.energy === "Électrique" ? (dark ? "bg-sky-500/20 text-sky-300" : "bg-sky-100 text-sky-800") : (dark ? "bg-violet-500/20 text-violet-300" : "bg-violet-100 text-violet-800")
              }`}
            >
              <Zap size={11} /> {v.energy}
            </span>
          )}
          {v.alerts.map((a, i) => (
            <span key={i} className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${dark ? "bg-rose-500/20 text-rose-300" : "bg-rose-100 text-rose-800"}`}>
              <AlertTriangle size={11} /> {a.label}
            </span>
          ))}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            onClick={() => setHistoryOpen(true)}
            className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors ${dark ? "border-zinc-700 text-zinc-300 hover:bg-zinc-800" : "border-stone-300 text-stone-600 hover:bg-stone-100"}`}
          >
            <History size={13} /> Historique {v.history.length > 0 && `(${v.history.length})`}
          </button>
          <button onClick={onClose} className={`rounded-lg p-1.5 transition-colors ${dark ? "text-zinc-400 hover:bg-zinc-800" : "text-stone-500 hover:bg-stone-200"}`}>
            <X size={16} />
          </button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className={`space-y-4 rounded-xl border p-4 ${dark ? "bg-zinc-900/60 border-zinc-800" : "bg-white border-stone-200"}`}>
          <div className={`flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest ${dark ? "text-zinc-400" : "text-stone-500"}`}>
            <Info size={13} /> Fiche véhicule
          </div>
          {v.dataWarning && (
            <div className={`flex items-start gap-1.5 rounded-lg border px-2.5 py-2 text-xs font-medium ${dark ? "border-blue-900 bg-blue-700/10 text-blue-300" : "border-blue-300 bg-blue-50 text-blue-900"}`}>
              <AlertTriangle size={13} className="mt-0.5 shrink-0" /> {v.dataWarningReason}
            </div>
          )}
          <div className={`rounded-lg border p-3 text-xs leading-relaxed ${dark ? "border-zinc-800 bg-zinc-950 text-zinc-300" : "border-stone-200 bg-stone-50 text-stone-600"}`}>{v.description}</div>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-2.5 text-sm">
            <div><dt className={`text-[11px] font-medium ${dark ? "text-zinc-500" : "text-stone-400"}`}>VIN</dt><dd className={`font-mono font-medium ${dark ? "text-zinc-100" : "text-stone-800"}`}>{v.vin || "—"}</dd></div>
            <div>
              <dt className={`text-[11px] font-medium ${dark ? "text-zinc-500" : "text-stone-400"}`}>Site (localisation stock)</dt>
              <dd>
                <select
                  value={v.siteLocation || ""}
                  onChange={(e) => onUpdateVehicleSite(v.orderNumber, e.target.value)}
                  className={`mt-0.5 h-7 rounded-lg border px-1.5 text-xs font-medium outline-none transition-shadow focus:ring-2 ${dark ? "bg-zinc-950 border-zinc-800 text-zinc-100 focus:ring-blue-700/30" : "bg-white border-stone-200 text-stone-800 focus:ring-blue-700/20"}`}
                >
                  <option value="">Non renseigné</option>
                  {sitesList.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </dd>
            </div>
            {clientLine(v) && (
              <div className="col-span-2"><dt className={`text-[11px] font-medium ${dark ? "text-zinc-500" : "text-stone-400"}`}>Client</dt><dd className={`break-words font-medium ${dark ? "text-zinc-100" : "text-stone-800"}`}>{clientLine(v)}</dd></div>
            )}
            <div><dt className={`text-[11px] font-medium ${dark ? "text-zinc-500" : "text-stone-400"}`}>Type de vente</dt><dd className={`font-medium ${dark ? "text-zinc-100" : "text-stone-800"}`}>{v.typeVente || "—"}</dd></div>
            <div><dt className={`text-[11px] font-medium ${dark ? "text-zinc-500" : "text-stone-400"}`}>Finition</dt><dd className={`font-medium ${dark ? "text-zinc-100" : "text-stone-800"}`}>{v.trim || "—"}</dd></div>
            <div><dt className={`text-[11px] font-medium ${dark ? "text-zinc-500" : "text-stone-400"}`}>Couleur</dt><dd className={`font-medium ${dark ? "text-zinc-100" : "text-stone-800"}`}>{v.color || "—"}</dd></div>
            <div><dt className={`text-[11px] font-medium ${dark ? "text-zinc-500" : "text-stone-400"}`}>Boîte de vitesse</dt><dd className={`font-mono font-medium ${dark ? "text-zinc-100" : "text-stone-800"}`}>{gearboxLabel(v)}</dd></div>
            <div><dt className={`text-[11px] font-medium ${dark ? "text-zinc-500" : "text-stone-400"}`}>{v.energy === "Électrique" ? "Batterie" : "Puissance"}</dt><dd className={`font-medium ${dark ? "text-zinc-100" : "text-stone-800"}`}>{powerLabel(v)}</dd></div>
            <div><dt className={`text-[11px] font-medium ${dark ? "text-zinc-500" : "text-stone-400"}`}>Jours en stock</dt><dd className={`font-medium ${dark ? "text-zinc-100" : "text-stone-800"}`}>{v.inStock ? v.joursStock : "—"}</dd></div>
            <div><dt className={`text-[11px] font-medium ${dark ? "text-zinc-500" : "text-stone-400"}`}>Localisation</dt><dd className={`font-medium ${dark ? "text-zinc-100" : "text-stone-800"}`}>{(v.localisation || "—").split("\\").join(" · ")}</dd></div>
            <div className="col-span-2"><dt className={`text-[11px] font-medium ${dark ? "text-zinc-500" : "text-stone-400"}`}>Fourchette d'arrivée en concession</dt><dd className={`font-medium ${dark ? "text-zinc-100" : "text-stone-800"}`}>{fmtRange(v.estRange) || "—"}</dd></div>
          </dl>
          <div>
            <div className={`mb-2 text-[11px] font-medium ${dark ? "text-zinc-500" : "text-stone-400"}`}>Options ({v.optionsList.length})</div>
            <div className="flex flex-wrap gap-1.5">
              {v.optionsList.length === 0 && <span className={`text-xs ${dark ? "text-zinc-600" : "text-stone-400"}`}>—</span>}
              {v.optionsList.map((opt, i) => (
                <span key={i} className={`rounded-full border px-2.5 py-1 text-xs font-medium leading-tight ${dark ? "border-zinc-700 bg-zinc-800 text-zinc-200" : "border-stone-200 bg-stone-100 text-stone-700"}`}>
                  {opt}
                </span>
              ))}
            </div>
          </div>
        </div>

        <div className={`rounded-xl border p-4 ${dark ? "bg-zinc-900/60 border-zinc-800" : "bg-white border-stone-200"}`}>
          <div className={`mb-3 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest ${dark ? "text-zinc-400" : "text-stone-500"}`}>
            <CalendarClock size={13} /> Réservation
          </div>
          {v.baseStatus === "vendu" || v.baseStatus === "hs" ? (
            <div className={`rounded-lg border px-3 py-3 text-sm ${dark ? "border-zinc-800 bg-zinc-950 text-zinc-400" : "border-stone-200 bg-stone-50 text-stone-500"}`}>
              {v.baseStatus === "vendu"
                ? "Ce véhicule est déjà vendu — la réservation n'est pas disponible."
                : "Ce véhicule est signalé HS — la réservation n'est pas disponible."}
            </div>
          ) : !canReserve ? (
            <div className={`rounded-lg border px-3 py-3 text-sm ${dark ? "border-zinc-800 bg-zinc-950 text-zinc-400" : "border-stone-200 bg-stone-50 text-stone-500"}`}>
              Votre rôle ne permet pas de réserver de véhicule.
            </div>
          ) : (
          <div className="space-y-2.5">
            {canReserveForOthers ? (
              <select className={inputCls} value={form.vendeur || vendorName || ""} onChange={(e) => setForm((f) => ({ ...f, vendeur: e.target.value }))}>
                {[...vendeursList].sort((a, b) => a.nom.localeCompare(b.nom)).map((vd) => (
                  <option key={vd.nom} value={vd.nom}>{vd.nom}</option>
                ))}
              </select>
            ) : (
              <div className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm ${dark ? "border-zinc-800 bg-zinc-950 text-zinc-300" : "border-stone-200 bg-stone-50 text-stone-600"}`}>
                <User size={13} className="shrink-0" /> {form.vendeur || vendorName || "—"}
              </div>
            )}
            <input
              className={inputCls}
              placeholder="Nom du client *"
              value={form.client || ""}
              onChange={(e) => setForm((f) => ({ ...f, client: e.target.value }))}
            />
            <div className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium ${form.statut === "Réservation annulée" ? (dark ? "border-rose-800 bg-rose-500/10 text-rose-300" : "border-rose-200 bg-rose-50 text-rose-700") : (dark ? "border-blue-900 bg-blue-700/10 text-blue-300" : "border-blue-200 bg-blue-50 text-blue-800")}`}>
              <CheckCircle2 size={13} className="shrink-0" /> {form.statut === "Réservation annulée" ? "Réservation annulée" : "Réservé"}
            </div>
            <div className="flex gap-2">
              <input type="date" className={inputCls} value={form.dateDebut} onChange={(e) => setForm((f) => ({ ...f, dateDebut: e.target.value }))} />
              <input type="date" className={inputCls} value={form.dateFin} onChange={(e) => setForm((f) => ({ ...f, dateFin: e.target.value }))} />
            </div>
            <textarea className={inputCls} rows={3} placeholder="Commentaire libre" value={form.commentaire} onChange={(e) => setForm((f) => ({ ...f, commentaire: e.target.value }))} />
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button onClick={save} disabled={!form.client?.trim()} className="pl-interactive flex-1 rounded-lg bg-blue-700 px-3 py-2 text-sm font-bold text-white shadow-sm transition-colors hover:bg-blue-500 disabled:opacity-40">Enregistrer</button>
              {v.reservation?.statut && v.reservation.statut !== "Réservation annulée" && (
                <button onClick={cancelReservation} className={`rounded-lg border px-3 py-2 text-sm font-semibold transition-colors ${dark ? "border-zinc-700 text-zinc-200 hover:bg-zinc-800" : "border-stone-300 text-stone-700 hover:bg-stone-100"}`}>Annuler</button>
              )}
              {saved && (
                <span className={`pl-pop flex items-center gap-1 text-xs font-semibold ${dark ? "text-emerald-400" : "text-emerald-600"}`}>
                  <CheckCircle2 size={13} /> Enregistré
                </span>
              )}
            </div>
          </div>
          )}

          <div className={`mt-4 border-t pt-4 ${dark ? "border-zinc-800" : "border-stone-200"}`}>
            <div className={`mb-3 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest ${dark ? "text-zinc-400" : "text-stone-500"}`}>
              <Info size={13} /> Commentaires internes {v.comments.length > 0 && `(${v.comments.length})`}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={commentCategorie}
                onChange={(e) => setCommentCategorie(e.target.value)}
                className={`h-9 rounded-lg border px-2 text-sm outline-none focus:ring-2 ${dark ? "bg-zinc-950 border-zinc-800 text-zinc-200 focus:ring-blue-700/30" : "bg-white border-stone-200 text-stone-700 focus:ring-blue-700/20"}`}
              >
                {Object.keys(COMMENT_CATEGORIES).map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
              <input
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submitComment()}
                placeholder="Ex. Livraison prévue Août, Mécanique OK, véhicule abîmé…"
                className={`h-9 min-w-[160px] flex-1 rounded-lg border px-3 text-sm outline-none focus:ring-2 ${dark ? "bg-zinc-950 border-zinc-800 text-zinc-200 focus:ring-blue-700/30" : "bg-white border-stone-200 text-stone-700 focus:ring-blue-700/20"}`}
              />
              <button onClick={submitComment} disabled={!commentText.trim()} className="pl-interactive h-9 rounded-lg bg-blue-700 px-3.5 text-sm font-bold text-white transition-colors hover:bg-blue-500 disabled:opacity-40">
                Ajouter
              </button>
            </div>
            {v.comments.length > 0 && (
              <ul className="mt-3 space-y-2">
                {v.comments.map((c) => {
                  const cat = COMMENT_CATEGORIES[c.categorie] || COMMENT_CATEGORIES["Général"];
                  const canDelete = canModerateComments || c.auteur === vendorName;
                  return (
                    <li key={c.id} className={`flex items-start gap-2 rounded-lg border p-2.5 ${dark ? "border-zinc-800 bg-zinc-950/50" : "border-stone-100 bg-stone-50/70"}`}>
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${dark ? cat.dark : cat.light}`}>{c.categorie}</span>
                      <div className="min-w-0 flex-1">
                        <div className={`text-sm ${dark ? "text-zinc-200" : "text-stone-700"}`}>{c.texte}</div>
                        <div className={`mt-0.5 text-xs ${dark ? "text-zinc-600" : "text-stone-400"}`}>{c.auteur} · {c.date} {c.heure}</div>
                      </div>
                      {canDelete && (
                        <button onClick={() => onDeleteComment(c.id)} className={`shrink-0 rounded-lg p-1 transition-colors ${dark ? "text-zinc-600 hover:bg-zinc-800 hover:text-rose-400" : "text-stone-400 hover:bg-stone-100 hover:text-rose-600"}`}>
                          <Trash2 size={13} />
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </div>

      {historyOpen && (
        <Modal dark={dark} title={`Historique — ${v.orderNumber}`} onClose={() => setHistoryOpen(false)}>
          {v.history.length === 0 ? (
            <div className={`text-sm ${dark ? "text-zinc-500" : "text-stone-400"}`}>Aucune modification enregistrée.</div>
          ) : (
            <ul className="max-h-96 space-y-2 overflow-y-auto pr-1">
              {v.history.map((h, i) => (
                <li key={i} className={`rounded-lg border p-2.5 text-xs ${dark ? "border-zinc-800 bg-zinc-950" : "border-stone-200 bg-stone-50"}`}>
                  <div className={`flex items-center justify-between font-semibold ${dark ? "text-zinc-200" : "text-stone-700"}`}>
                    <span>{h.champ}</span>
                    <span className={`font-normal ${dark ? "text-zinc-500" : "text-stone-400"}`}>{h.date} · {h.heure}</span>
                  </div>
                  <div className={dark ? "text-zinc-400" : "text-stone-500"}>
                    {h.utilisateur} : <span className="line-through">{h.ancienne}</span> → <span className={`font-semibold ${dark ? "text-zinc-200" : "text-stone-700"}`}>{h.nouvelle}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Modal>
      )}
    </div>
  );
}

function AlertsDrawer({ dark, vehicles, onClose, onSelect }) {
  const flat = [];
  vehicles.forEach((v) => v.alerts.forEach((a) => { if (a.type === "resa_expiree" || a.type === "resa_bientot") flat.push({ v, a }); }));
  return (
    <div className="fixed inset-0 z-30 flex justify-end">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className={`relative flex h-full w-full max-w-sm flex-col overflow-y-auto border-l ${dark ? "bg-zinc-950/98 border-zinc-800" : "bg-white border-stone-200"}`}>
        <div className={`flex items-center justify-between border-b px-5 py-4 ${dark ? "border-zinc-800" : "border-stone-200"}`}>
          <div className={`text-sm font-semibold ${dark ? "text-zinc-100" : "text-stone-900"}`}>Réservations à surveiller ({flat.length})</div>
          <button onClick={onClose} className={`rounded-lg p-1.5 ${dark ? "text-zinc-400 hover:bg-zinc-800" : "text-stone-500 hover:bg-stone-100"}`}>
            <X size={16} />
          </button>
        </div>
        <div className="space-y-2 p-4">
          {flat.length === 0 && <EmptyState dark={dark} size="sm" icon={CheckCircle2} title="Aucune réservation à surveiller" subtitle="Rien n'expire ni n'est dépassé pour l'instant." />}
          {flat.map(({ v, a }, i) => (
            <button
              key={i}
              onClick={() => { onSelect(v); onClose(); }}
              className={`block w-full rounded-lg border p-3 text-left text-sm ${dark ? "border-zinc-800 hover:bg-zinc-900" : "border-stone-200 hover:bg-stone-50"}`}
            >
              <div className="flex items-center gap-1.5 text-xs font-medium text-rose-500"><AlertTriangle size={12} />{a.label}</div>
              <div className={`mt-1 ${dark ? "text-zinc-200" : "text-stone-800"}`}>
                <ModelYearLabel v={v} dark={dark} /> · {v.orderNumber}
              </div>
              <div className={`text-xs ${dark ? "text-zinc-500" : "text-stone-400"}`}>{v.concession}{activeReservationVendeur(v) ? ` · ${activeReservationVendeur(v)}` : ""}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function Modal({ dark, title, onClose, children, size }) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className={`relative max-h-[85vh] w-full overflow-y-auto rounded-2xl border p-5 ${size === "xl" ? "max-w-5xl" : "max-w-lg"} ${dark ? "bg-zinc-900 border-zinc-800" : "bg-white border-stone-200"}`}>
        <div className="mb-4 flex items-center justify-between">
          <div className={`text-sm font-semibold ${dark ? "text-zinc-100" : "text-stone-900"}`}>{title}</div>
          {onClose && (
            <button onClick={onClose} className={`rounded-lg p-1.5 ${dark ? "text-zinc-400 hover:bg-zinc-800" : "text-stone-500 hover:bg-stone-100"}`}>
              <X size={16} />
            </button>
          )}
        </div>
        {children}
      </div>
    </div>
  );
}

function LogisticsGroup({ dark, title, icon: Icon, iconColor, vehicles, emptyLabel, renderExtra, onOpen }) {
  return (
    <div className={`overflow-hidden rounded-2xl border ${dark ? "border-zinc-800" : "border-stone-200"}`}>
      <div className={`flex items-center gap-2 border-b px-4 py-3 ${dark ? "border-zinc-800 bg-zinc-900" : "border-stone-200 bg-stone-100"}`}>
        <Icon size={15} className={iconColor} />
        <span className={`text-sm font-bold ${dark ? "text-zinc-100" : "text-stone-800"}`}>{title}</span>
        <span className={`ml-auto rounded-full px-2 py-0.5 text-xs font-bold ${dark ? "bg-zinc-800 text-zinc-300" : "bg-white text-stone-600"}`}>{vehicles.length}</span>
      </div>
      {vehicles.length === 0 ? (
        <div className={`p-6 text-center text-sm ${dark ? "text-zinc-600" : "text-stone-400"}`}>{emptyLabel}</div>
      ) : (
        <ul className={`max-h-[440px] divide-y overflow-auto ${dark ? "divide-zinc-800" : "divide-stone-200"}`}>
          {vehicles.map((v) => (
            <li
              key={v.orderNumber}
              onClick={() => onOpen(v)}
              className={`flex cursor-pointer flex-wrap items-start gap-2.5 px-4 py-3 transition-colors ${dark ? "hover:bg-zinc-900/70" : "hover:bg-blue-50/40"}`}
            >
              <div className="mt-0.5"><VehicleTypeIcon vu={v.vu} dark={dark} size="sm" /></div>
              <div className="min-w-[140px] flex-1">
                <div className="flex items-center gap-1.5">
                  <span className={`truncate text-sm font-semibold ${dark ? "text-zinc-100" : "text-stone-900"}`}>{displayModel(v)}</span>
                  {(v.energy === "Électrique" || v.energy === "Hybride rechargeable") && (
                    <Zap
                      size={13}
                      className={`shrink-0 ${v.energy === "Électrique" ? (dark ? "text-sky-400" : "text-sky-600") : (dark ? "text-violet-400" : "text-violet-600")}`}
                      aria-label={v.energy}
                    >
                      <title>{v.energy}</title>
                    </Zap>
                  )}
                  {v.siteLocation && (
                    <span className={`shrink-0 truncate rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${dark ? "bg-sky-500/15 text-sky-300" : "bg-sky-50 text-sky-700"}`}>
                      {v.siteLocation}
                    </span>
                  )}
                  {v.comments.length > 0 && (
                    <span title={`${v.comments.length} commentaire${v.comments.length > 1 ? "s" : ""}`} className={`flex shrink-0 items-center gap-0.5 text-[10px] font-semibold ${dark ? "text-zinc-500" : "text-stone-400"}`}>
                      <MessageSquare size={11} />{v.comments.length}
                    </span>
                  )}
                </div>
                <div className={`truncate text-xs ${dark ? "text-zinc-500" : "text-stone-400"}`}>
                  {v.orderNumber}{clientLine(v) ? ` - ${clientLine(v)}` : v.vin ? ` - ${v.vin}` : ""}
                </div>
                {v.vendu && (
                  <div className={`flex items-center gap-1 truncate text-xs font-medium ${dark ? "text-violet-300" : "text-violet-700"}`}>
                    <User size={10} className="shrink-0" /> <span className="truncate">{venduLabel(v)}</span>
                  </div>
                )}
              </div>
              {renderExtra(v)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function VehiclePicker({ dark, vehicles, value, onChange }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const selected = vehicles.find((v) => v.orderNumber === value);
  const q = query.trim().toLowerCase();
  const results = q
    ? vehicles.filter((v) => `${v.orderNumber} ${v.vin} ${displayModelBase(v)}`.toLowerCase().includes(q)).slice(0, 30)
    : [];
  const inputCls = `w-full rounded-lg border px-3 py-2 text-sm outline-none transition-shadow focus:ring-2 ${dark ? "bg-zinc-950 border-zinc-800 text-zinc-200 focus:ring-blue-700/30" : "bg-white border-stone-200 text-stone-700 focus:ring-blue-700/20"}`;

  if (selected && !open) {
    return (
      <div className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${dark ? "bg-zinc-950 border-zinc-800 text-zinc-200" : "bg-white border-stone-200 text-stone-700"}`}>
        <Car size={14} className="shrink-0" />
        <span className="min-w-0 flex-1 truncate font-medium">{displayModelBase(selected)} — {selected.orderNumber}</span>
        <button onClick={() => { onChange(""); setQuery(""); setOpen(true); }} className={dark ? "text-zinc-500 hover:text-zinc-300" : "text-stone-400 hover:text-stone-600"}>
          <X size={14} />
        </button>
      </div>
    );
  }
  return (
    <div className="relative">
      <input
        value={query}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder="Commande, VIN, modèle…"
        className={inputCls}
      />
      {open && q && (
        <div className={`absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border shadow-lg ${dark ? "bg-zinc-900 border-zinc-800" : "bg-white border-stone-200"}`}>
          {results.length === 0 ? (
            <div className={`p-3 text-center text-xs ${dark ? "text-zinc-500" : "text-stone-400"}`}>Aucun véhicule trouvé.</div>
          ) : (
            results.map((v) => (
              <button
                key={v.orderNumber}
                onClick={() => { onChange(v.orderNumber); setQuery(""); setOpen(false); }}
                className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm ${dark ? "hover:bg-zinc-800 text-zinc-200" : "hover:bg-stone-100 text-stone-700"}`}
              >
                <span className="min-w-0 flex-1 truncate font-medium">{displayModelBase(v)}</span>
                <span className={`shrink-0 text-xs ${dark ? "text-zinc-500" : "text-stone-400"}`}>{v.orderNumber}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

const CONVOYAGE_STATUTS = ["Demandé", "Fait"];

function addBusinessDays(date, days) {
  const d = new Date(date);
  let added = 0;
  while (added < days) {
    d.setDate(d.getDate() + 1);
    const day = d.getDay();
    if (day !== 0 && day !== 6) added++;
  }
  return d;
}
function toDateInputValue(date) {
  return date.toISOString().slice(0, 10);
}
function DocumentsTab({ dark, folderUrl, canConfigure, onOpenSettings }) {
  const embedUrl = driveEmbedUrl(folderUrl);
  return (
    <div className="space-y-4">
      <div>
        <div className={`flex items-center gap-2 text-sm font-bold uppercase tracking-widest ${dark ? "text-zinc-400" : "text-stone-500"}`}>
          <FolderOpen size={15} className={dark ? "text-blue-500" : "text-blue-800"} />
          Documents
        </div>
        <p className={`mt-1 text-sm ${dark ? "text-zinc-500" : "text-stone-400"}`}>
          Aperçu en direct d'un dossier Google Drive partagé (factures, contrats, etc.) — le contenu reste géré depuis Drive, rien n'est stocké dans ParcLive.
        </p>
      </div>

      {embedUrl ? (
        <div className={`overflow-hidden rounded-2xl border ${dark ? "border-zinc-800" : "border-stone-200"}`}>
          <iframe src={embedUrl} title="Documents Google Drive" className="h-[70vh] w-full" style={{ colorScheme: "light" }} />
        </div>
      ) : (
        <EmptyState
          dark={dark}
          icon={FolderOpen}
          title="Aucun dossier configuré pour l'instant"
          subtitle={canConfigure ? "Ouvrez Réglages → Général pour coller le lien de partage de votre dossier Google Drive." : "Demandez à un administrateur de configurer le dossier dans Réglages."}
        />
      )}
      {canConfigure && !embedUrl && (
        <button onClick={onOpenSettings} className="pl-interactive rounded-lg bg-blue-700 px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-blue-500">
          Configurer maintenant
        </button>
      )}
    </div>
  );
}

function ChallengeTab({ dark, vehicles, vendeursList, seuilJours, challengeConfig, challengeEntries, onOpenVehicle }) {
  const stockAncien = useMemo(
    () => vehicles.filter((v) => v.baseStatus === "disponible" && v.inStock && v.joursStock >= seuilJours).sort((a, b) => b.joursStock - a.joursStock),
    [vehicles, seuilJours]
  );

  const classement = useMemo(() => {
    const totals = {};
    challengeEntries.forEach((e) => {
      if (!e.vendeur) return;
      if (!totals[e.vendeur]) totals[e.vendeur] = { montant: 0, count: 0 };
      totals[e.vendeur].montant += e.montant;
      totals[e.vendeur].count += 1;
    });
    const siteByVendeur = new Map(vendeursList.map((v) => [v.nom, v.site]));
    return Object.entries(totals)
      .map(([nom, t]) => ({ nom, ...t, site: siteByVendeur.get(nom) || "—" }))
      .sort((a, b) => b.montant - a.montant);
  }, [challengeEntries, vendeursList]);

  const avgAge = stockAncien.length ? Math.round(stockAncien.reduce((n, v) => n + v.joursStock, 0) / stockAncien.length) : 0;
  const cagnotteTotale = challengeEntries.reduce((n, e) => n + e.montant, 0);
  const today = new Date().toISOString().slice(0, 10);
  const enPeriode = !challengeConfig.dateDebut || !challengeConfig.dateFin || (today >= challengeConfig.dateDebut && today <= challengeConfig.dateFin);
  const challengeActif = challengeConfig.actif && enPeriode;
  const joursRestants = challengeConfig.dateFin ? Math.ceil((new Date(challengeConfig.dateFin) - new Date(today)) / 86400000) : null;

  return (
    <div className="space-y-8">
      <div>
        <div className={`flex items-center gap-2 text-sm font-bold uppercase tracking-widest ${dark ? "text-zinc-400" : "text-stone-500"}`}>
          <Trophy size={15} className={dark ? "text-blue-500" : "text-blue-800"} />
          Challenge stock ancien
        </div>
        <p className={`mt-1 text-sm ${dark ? "text-zinc-500" : "text-stone-400"}`}>
          Les véhicules disponibles depuis plus de {seuilJours} jours, à écouler en priorité.
        </p>
      </div>

      {challengeActif ? (
        <div className={`rounded-2xl border p-4 ${dark ? "border-blue-700/30 bg-blue-700/10" : "border-blue-200 bg-blue-50"}`}>
          <div className={`text-sm font-bold ${dark ? "text-blue-300" : "text-blue-900"}`}>
            Challenge en cours — {challengeConfig.montantParVehicule}€ par véhicule ancien vendu
          </div>
          <div className={`mt-1 text-xs ${dark ? "text-blue-300/80" : "text-blue-800"}`}>
            {challengeConfig.dateDebut && challengeConfig.dateFin ? `Du ${challengeConfig.dateDebut} au ${challengeConfig.dateFin}` : "Sans date de fin définie"}
            {joursRestants != null && joursRestants >= 0 && ` · ${joursRestants} jour${joursRestants > 1 ? "s" : ""} restant${joursRestants > 1 ? "s" : ""}`}
          </div>
        </div>
      ) : (
        <div className={`rounded-2xl border p-4 text-sm ${dark ? "border-zinc-800 bg-zinc-900/40 text-zinc-500" : "border-stone-200 bg-white text-stone-400"}`}>
          Aucun challenge en cours actuellement.
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KPICard dark={dark} label="Cagnotte distribuée" value={`${cagnotteTotale}€`} />
        <KPICard dark={dark} label="Véhicules à challenger" value={stockAncien.length} />
        <KPICard dark={dark} label="Âge moyen" value={`${avgAge} j`} />
        <KPICard dark={dark} label="Seuil actuel" value={`${seuilJours} j`} />
      </div>

      <div>
        <div className={`mb-3 text-xs font-bold uppercase tracking-widest ${dark ? "text-zinc-400" : "text-stone-500"}`}>
          Classement
        </div>
        {classement.length === 0 ? (
          <EmptyState dark={dark} icon={Trophy} title="Personne n'a encore challengé de stock ancien" subtitle="Le premier à vendre un véhicule ancien ouvre le classement." />
        ) : (
          <div className={`overflow-hidden rounded-2xl border ${dark ? "border-zinc-800" : "border-stone-200"}`}>
            <ul className={`divide-y ${dark ? "divide-zinc-800" : "divide-stone-200"}`}>
              {classement.map((r, i) => (
                <li key={r.nom} className={`flex items-center gap-3 px-4 py-2.5 ${dark ? "hover:bg-zinc-900/60" : "hover:bg-blue-50/40"}`}>
                  <span className={`font-semibold ${dark ? "text-zinc-100" : "text-stone-900"}`}>
                    {i === 0 && "🥇 "}{i === 1 && "🥈 "}{i === 2 && "🥉 "}{r.nom}
                  </span>
                  <span className={`text-xs ${dark ? "text-zinc-500" : "text-stone-400"}`}>{r.site} · {r.count} véhicule{r.count > 1 ? "s" : ""}</span>
                  <span className={`ml-auto font-bold tabular-nums ${dark ? "text-blue-500" : "text-blue-800"}`}>{r.montant}€</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div>
        <div className={`mb-3 text-xs font-bold uppercase tracking-widest ${dark ? "text-zinc-400" : "text-stone-500"}`}>
          Stock à challenger ({stockAncien.length})
        </div>
        {stockAncien.length === 0 ? (
          <EmptyState dark={dark} icon={Trophy} title="Bravo, aucun véhicule au-delà du seuil !" subtitle="Le stock est sain — continuez comme ça." />
        ) : (
          <ul className="space-y-2">
            {stockAncien.map((v) => (
              <li
                key={v.orderNumber}
                onClick={() => onOpenVehicle(v)}
                className={`pl-interactive flex cursor-pointer flex-wrap items-center gap-2 rounded-xl border px-4 py-2.5 transition-colors ${dark ? "border-zinc-800 bg-zinc-900/40 hover:bg-zinc-900/70" : "border-stone-200 bg-white hover:bg-blue-50/40"}`}
              >
                <span className={`min-w-0 flex-1 truncate text-sm font-semibold ${dark ? "text-zinc-100" : "text-stone-900"}`}>{displayModelBase(v)}</span>
                <span className={`text-xs ${dark ? "text-zinc-500" : "text-stone-400"}`}>{v.orderNumber}{v.siteLocation ? ` · ${v.siteLocation}` : ""}</span>
                <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${dark ? "bg-rose-500/15 text-rose-300" : "bg-rose-50 text-rose-700"}`}>
                  {v.joursStock} j
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function ConvoyageTab({ dark, vehicles, convoyages, sitesList, vendorName, onCreateConvoyage, onUpdateConvoyageStatut, onDeleteConvoyage, onUpdateVehicleSite, onOpenVehicle }) {
  const eligibleVehicles = useMemo(() => vehicles.filter((v) => v.baseStatus !== "vendu" && v.baseStatus !== "hs"), [vehicles]);
  const sansLocalisation = useMemo(() => eligibleVehicles.filter((v) => !v.siteLocation), [eligibleVehicles]);
  const [showSansLoc, setShowSansLoc] = useState(false);
  const [showHistorique, setShowHistorique] = useState(false);
  const [formOrder, setFormOrder] = useState("");
  const [siteDepart, setSiteDepart] = useState("");
  const [siteArrivee, setSiteArrivee] = useState("");
  const [dateSouhaitee, setDateSouhaitee] = useState("");
  const [commentaire, setCommentaire] = useState("");
  const vehicleByOrder = useMemo(() => new Map(vehicles.map((v) => [v.orderNumber, v])), [vehicles]);
  const minDate = useMemo(() => toDateInputValue(addBusinessDays(new Date(), 3)), []);

  useEffect(() => {
    if (formOrder) {
      const v = vehicleByOrder.get(formOrder);
      setSiteDepart(v?.siteLocation || "");
    }
  }, [formOrder]);

  const inputCls = `w-full rounded-lg border px-3 py-2 text-sm outline-none transition-shadow focus:ring-2 ${dark ? "bg-zinc-950 border-zinc-800 text-zinc-200 focus:ring-blue-700/30" : "bg-white border-stone-200 text-stone-700 focus:ring-blue-700/20"}`;
  const labelCls = `mb-1 text-[11px] font-bold uppercase tracking-widest ${dark ? "text-zinc-500" : "text-stone-400"}`;
  const dateTooSoon = dateSouhaitee && dateSouhaitee < minDate;

  function submit() {
    if (!formOrder || !siteDepart || !siteArrivee || siteDepart === siteArrivee || !dateSouhaitee || dateTooSoon) return;
    onCreateConvoyage({ orderNumber: formOrder, siteDepart, siteArrivee, dateSouhaitee, commentaire });
    setFormOrder("");
    setSiteDepart("");
    setSiteArrivee("");
    setDateSouhaitee("");
    setCommentaire("");
  }

  const [listQuery, setListQuery] = useState("");
  const lq = listQuery.trim().toLowerCase();
  const matchesQuery = (c) => {
    if (!lq) return true;
    const v = vehicleByOrder.get(c.orderNumber);
    const hay = `${c.orderNumber} ${v?.vin || ""} ${v ? displayModelBase(v) : ""}`.toLowerCase();
    return hay.includes(lq);
  };
  const enCours = convoyages.filter((c) => c.statut !== "Fait" && matchesQuery(c)).sort((a, b) => (b.demandeLe || "").localeCompare(a.demandeLe || ""));
  const historique = convoyages.filter((c) => c.statut === "Fait" && matchesQuery(c)).sort((a, b) => (b.demandeLe || "").localeCompare(a.demandeLe || ""));

  function ConvoyageRow({ c }) {
    const v = vehicleByOrder.get(c.orderNumber);
    const statutIdx = CONVOYAGE_STATUTS.indexOf(c.statut);
    return (
      <li className={`rounded-2xl border p-3.5 ${dark ? "bg-zinc-900/40 border-zinc-800" : "bg-white border-stone-200"}`}>
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => v && onOpenVehicle(v)} className={`min-w-0 flex-1 truncate text-left text-sm font-semibold hover:underline ${dark ? "text-zinc-100" : "text-stone-900"}`}>
            {v ? displayModelBase(v) : c.orderNumber} <span className={`font-normal ${dark ? "text-zinc-500" : "text-stone-400"}`}>— {c.orderNumber}</span>
          </button>
          <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${dark ? "bg-zinc-800 text-zinc-300" : "bg-stone-100 text-stone-600"}`}>
            {c.statut}
          </span>
        </div>
        <div className={`mt-1.5 flex flex-wrap items-center gap-1.5 text-sm ${dark ? "text-zinc-300" : "text-stone-700"}`}>
          <span className="font-medium">{c.siteDepart}</span>
          <ArrowRightLeft size={12} className={dark ? "text-zinc-600" : "text-stone-400"} />
          <span className="font-medium">{c.siteArrivee}</span>
          {c.dateSouhaitee && <span className={`text-xs ${dark ? "text-zinc-500" : "text-stone-400"}`}>· souhaité pour le {c.dateSouhaitee}</span>}
        </div>
        {c.commentaire && <div className={`mt-1 text-xs italic ${dark ? "text-zinc-500" : "text-stone-400"}`}>{c.commentaire}</div>}
        <div className={`mt-1 text-xs ${dark ? "text-zinc-600" : "text-stone-400"}`}>Demandé par {c.demandePar} le {c.demandeLe}</div>
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          {statutIdx < CONVOYAGE_STATUTS.length - 1 && (
            <button
              onClick={() => onUpdateConvoyageStatut(c.id, CONVOYAGE_STATUTS[statutIdx + 1])}
              className="pl-interactive rounded-lg bg-blue-700 px-3 py-1.5 text-xs font-bold text-white transition-colors hover:bg-blue-500"
            >
              Marquer "{CONVOYAGE_STATUTS[statutIdx + 1]}"
            </button>
          )}
          <button
            onClick={() => onDeleteConvoyage(c.id)}
            className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${dark ? "border-zinc-700 text-zinc-400 hover:bg-zinc-800" : "border-stone-300 text-stone-500 hover:bg-stone-100"}`}
          >
            {c.statut === "Fait" ? "Supprimer" : "Annuler"}
          </button>
        </div>
      </li>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <div className={`flex items-center gap-2 text-sm font-bold uppercase tracking-widest ${dark ? "text-zinc-400" : "text-stone-500"}`}>
          <ArrowRightLeft size={15} className={dark ? "text-blue-500" : "text-blue-800"} />
          Convoyage entre sites
        </div>
        <p className={`mt-1 text-sm ${dark ? "text-zinc-500" : "text-stone-400"}`}>
          Ouvert à tous les collaborateurs — demandez le transfert d'un véhicule d'un site à un autre, et gardez la localisation du stock à jour.
        </p>
      </div>

      {sansLocalisation.length > 0 && (
        <div className={`overflow-hidden rounded-2xl border ${dark ? "border-zinc-800" : "border-stone-200"}`}>
          <button
            onClick={() => setShowSansLoc((o) => !o)}
            className={`flex w-full items-center justify-between px-4 py-3 text-xs font-semibold uppercase tracking-widest transition-colors ${dark ? "bg-blue-700/10 text-blue-300 hover:bg-blue-700/15" : "bg-blue-50 text-blue-900 hover:bg-blue-100"}`}
          >
            <span className="flex items-center gap-2"><AlertTriangle size={13} /> {sansLocalisation.length} véhicule{sansLocalisation.length > 1 ? "s" : ""} sans localisation connue</span>
            <ChevronRight size={14} className={`transition-transform ${showSansLoc ? "rotate-90" : ""}`} />
          </button>
          {showSansLoc && (
            <ul className={`divide-y ${dark ? "divide-zinc-800" : "divide-stone-200"}`}>
              {sansLocalisation.map((v) => (
                <li key={v.orderNumber} className={`flex flex-wrap items-center gap-2 px-4 py-2.5 ${dark ? "hover:bg-zinc-900/70" : "hover:bg-blue-50/40"}`}>
                  <span className={`min-w-[160px] flex-1 truncate text-sm ${dark ? "text-zinc-200" : "text-stone-700"}`}>
                    {displayModelBase(v)} <span className={dark ? "text-zinc-500" : "text-stone-400"}>— {v.orderNumber}</span>
                  </span>
                  <select
                    defaultValue=""
                    onChange={(e) => e.target.value && onUpdateVehicleSite(v.orderNumber, e.target.value)}
                    className={`h-8 rounded-lg border px-2 text-xs outline-none focus:ring-2 ${dark ? "bg-zinc-950 border-zinc-800 text-zinc-300 focus:ring-blue-700/30" : "bg-white border-stone-200 text-stone-600 focus:ring-blue-700/20"}`}
                  >
                    <option value="">Où est-il ? —</option>
                    {sitesList.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className={`space-y-3 rounded-2xl border p-4 ${dark ? "bg-zinc-900/60 border-zinc-800" : "bg-white border-stone-200"}`}>
        <div className={`text-xs font-bold uppercase tracking-widest ${dark ? "text-zinc-400" : "text-stone-500"}`}>Nouvelle demande</div>
        <div>
          <div className={labelCls}>Véhicule</div>
          <VehiclePicker dark={dark} vehicles={eligibleVehicles} value={formOrder} onChange={setFormOrder} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <div className={labelCls}>Site de départ (où est-il actuellement)</div>
            <select value={siteDepart} onChange={(e) => setSiteDepart(e.target.value)} className={inputCls}>
              <option value="">— Choisir —</option>
              {sitesList.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          <div>
            <div className={labelCls}>Site d'arrivée souhaité</div>
            <select value={siteArrivee} onChange={(e) => setSiteArrivee(e.target.value)} className={inputCls}>
              <option value="">— Choisir —</option>
              {sitesList.filter((s) => s !== siteDepart).map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <div className={labelCls}>Date souhaitée *</div>
            <input type="date" min={minDate} value={dateSouhaitee} onChange={(e) => setDateSouhaitee(e.target.value)} className={`${inputCls} ${dateTooSoon ? "border-rose-500" : ""}`} />
            <p className={`mt-1 text-xs ${dateTooSoon ? "font-semibold text-rose-500" : dark ? "text-zinc-600" : "text-stone-400"}`}>
              {dateTooSoon ? "La date choisie est trop proche — 3 jours ouvrés minimum." : "Minimum 3 jours ouvrés à l'avance."}
            </p>
          </div>
          <div>
            <div className={labelCls}>Commentaire (optionnel)</div>
            <input value={commentaire} onChange={(e) => setCommentaire(e.target.value)} placeholder="Ex. client en attente" className={inputCls} />
          </div>
        </div>
        <button
          onClick={submit}
          disabled={!formOrder || !siteDepart || !siteArrivee || siteDepart === siteArrivee || !dateSouhaitee || dateTooSoon}
          className="pl-interactive rounded-lg bg-blue-700 px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-blue-500 disabled:opacity-40"
        >
          Demander le convoyage
        </button>
      </div>

      <div className={`flex h-9 items-center gap-2 rounded-lg border px-3 ${dark ? "bg-zinc-950 border-zinc-800" : "bg-stone-50 border-stone-200"}`}>
        <Search size={14} className={dark ? "text-zinc-500" : "text-stone-400"} />
        <input
          value={listQuery}
          onChange={(e) => setListQuery(e.target.value)}
          placeholder="Rechercher un véhicule (commande, VIN, modèle)…"
          className={`w-full bg-transparent text-sm outline-none ${dark ? "text-zinc-200 placeholder:text-zinc-600" : "text-stone-700 placeholder:text-stone-400"}`}
        />
      </div>

      <div>
        <div className={`mb-3 text-xs font-bold uppercase tracking-widest ${dark ? "text-zinc-400" : "text-stone-500"}`}>
          Convoyages en cours ({enCours.length})
        </div>
        {enCours.length === 0 ? (
          <EmptyState dark={dark} icon={ArrowRightLeft} title="Aucun convoyage en cours" subtitle="Tout le stock est là où il doit être, pour l'instant." />
        ) : (
          <ul className="space-y-2.5">
            {enCours.map((c) => (
              <ConvoyageRow key={c.id} c={c} />
            ))}
          </ul>
        )}
      </div>

      {historique.length > 0 && (
        <div>
          <button
            onClick={() => setShowHistorique((o) => !o)}
            className={`flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest ${dark ? "text-zinc-400 hover:text-zinc-200" : "text-stone-500 hover:text-stone-800"}`}
          >
            Historique ({historique.length})
            <ChevronRight size={13} className={`transition-transform ${showHistorique ? "rotate-90" : ""}`} />
          </button>
          {showHistorique && (
            <ul className="mt-3 space-y-2.5">
              {historique.map((c) => (
                <ConvoyageRow key={c.id} c={c} />
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function LogisticsTab({ dark, vehicles, vendeursList, sitesList, onOpenVehicle, simpleMode, onSave, vendorName, onUpdateVehicleSite, onAddComment, onDeleteComment }) {
  const [popupOrder, setPopupOrder] = useState(null);
  const popupVehicle = popupOrder ? vehicles.find((v) => v.orderNumber === popupOrder) || null : null;
  useEffect(() => {
    if (!popupOrder) return;
    function onKeyDown(e) {
      if (e.key === "Escape") setPopupOrder(null);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [popupOrder]);
  const [query, setQuery] = useState("");
  const [contremarqueFilter, setContremarqueFilter] = useState("all");
  const [vendeurFilter, setVendeurFilter] = useState("all");
  const [siteFilter, setSiteFilter] = useState("all");
  const vendeurSiteMap = useMemo(() => new Map(vendeursList.map((v) => [v.nom, v.site])), [vendeursList]);
  const vendorOf = (v) => v.venduPar || activeReservationVendeur(v);
  const q = query.trim().toLowerCase();
  const matches = (v) => {
    if (contremarqueFilter === "oui" && !v.vendu) return false;
    if (contremarqueFilter === "non" && v.vendu) return false;
    if (vendeurFilter !== "all" && vendorOf(v) !== vendeurFilter) return false;
    if (siteFilter !== "all" && vehicleEffectiveSite(v, vendeurSiteMap) !== siteFilter) return false;
    if (!q) return true;
    return `${v.orderNumber} ${v.vin} ${v.model} ${v.typeVente} ${v.venduPar || ""} ${v.clientLabel || ""}`.toLowerCase().includes(q);
  };

  const enStock = useMemo(
    () => vehicles.filter((v) => v.inStock && matches(v)).sort((a, b) => (b.joursStock ?? 0) - (a.joursStock ?? 0)),
    [vehicles, q, contremarqueFilter, vendeurFilter, siteFilter]
  );
  const enTransit = useMemo(
    () =>
      vehicles
        .filter((v) => !v.inStock && !!v.vin && matches(v))
        .sort((a, b) => (a.estRange?.end ? a.estRange.end.getTime() : Infinity) - (b.estRange?.end ? b.estRange.end.getTime() : Infinity)),
    [vehicles, q, contremarqueFilter, vendeurFilter, siteFilter]
  );
  const nonSerialises = useMemo(() => vehicles.filter((v) => !v.vin && matches(v)), [vehicles, q, contremarqueFilter, vendeurFilter, siteFilter]);

  const inputCls = `h-9 rounded-lg border px-3 text-sm outline-none transition-shadow focus:ring-2 ${dark ? "bg-zinc-950 border-zinc-800 text-zinc-200 focus:ring-blue-700/30" : "bg-white border-stone-200 text-stone-700 focus:ring-blue-700/20"}`;
  function chipCls(active) {
    return `rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
      active ? "bg-blue-700 text-white" : dark ? "bg-zinc-800 text-zinc-300 hover:bg-zinc-700" : "bg-stone-100 text-stone-600 hover:bg-stone-200"
    }`;
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-4">
        <KPICard dark={dark} label="En stock" value={enStock.length} />
        <KPICard dark={dark} label="En transit" value={enTransit.length} />
        <KPICard dark={dark} label="Non sérialisés" value={nonSerialises.length} />
      </div>
      <div className={`flex flex-wrap items-center gap-2 rounded-2xl border p-2.5 shadow-sm ${dark ? "bg-zinc-900/50 border-zinc-800" : "bg-white border-stone-200"}`}>
        <div className={`flex h-9 min-w-[220px] flex-1 items-center gap-2 rounded-lg border px-3 ${dark ? "bg-zinc-950 border-zinc-800" : "bg-stone-50 border-stone-200"}`}>
          <Search size={14} className={dark ? "text-zinc-500" : "text-stone-400"} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Commande, VIN, modèle, type de vente…" className={`w-full bg-transparent text-sm outline-none ${dark ? "text-zinc-200 placeholder:text-zinc-600" : "text-stone-700 placeholder:text-stone-400"}`} />
        </div>
        {!simpleMode && (
          <>
        <div className="flex items-center gap-1.5">
          <button onClick={() => setContremarqueFilter("all")} className={chipCls(contremarqueFilter === "all")}>Tous</button>
          <button onClick={() => setContremarqueFilter("oui")} className={chipCls(contremarqueFilter === "oui")}>Contremarqué</button>
          <button onClick={() => setContremarqueFilter("non")} className={chipCls(contremarqueFilter === "non")}>Non contremarqué</button>
        </div>
        <select value={vendeurFilter} onChange={(e) => setVendeurFilter(e.target.value)} className={inputCls}>
          <option value="all">Tous vendeurs</option>
          {[...vendeursList].sort((a, b) => a.nom.localeCompare(b.nom)).map((v) => (
            <option key={v.nom} value={v.nom}>{v.nom}</option>
          ))}
        </select>
        <select value={siteFilter} onChange={(e) => setSiteFilter(e.target.value)} className={inputCls}>
          <option value="all">Tous sites</option>
          {sitesList.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
          </>
        )}
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <LogisticsGroup
          dark={dark}
          title="En stock"
          icon={CheckCircle2}
          iconColor={dark ? "text-emerald-400" : "text-emerald-600"}
          vehicles={enStock}
          emptyLabel="Aucun véhicule en stock."
          onOpen={(v) => setPopupOrder(v.orderNumber)}
          renderExtra={(v) => (
            <div className="flex shrink-0 flex-col items-end gap-1">
              <span className={`text-xs font-semibold tabular-nums ${dark ? "text-zinc-300" : "text-stone-600"}`}>{v.joursStock} j</span>
              <StatusBadge vehicle={v} dark={dark} />
            </div>
          )}
        />
        <LogisticsGroup
          dark={dark}
          title="En transit"
          icon={Truck}
          iconColor={dark ? "text-sky-400" : "text-sky-600"}
          vehicles={enTransit}
          emptyLabel="Aucun véhicule en transit."
          onOpen={(v) => setPopupOrder(v.orderNumber)}
          renderExtra={(v) => (
            <div className="flex shrink-0 flex-col items-end gap-1">
              <span className={`text-xs font-medium ${dark ? "text-zinc-300" : "text-stone-600"}`}>{fmtRange(v.estRange) || "Date inconnue"}</span>
              <StatusBadge vehicle={v} dark={dark} />
            </div>
          )}
        />
        <LogisticsGroup
          dark={dark}
          title="Non sérialisés"
          icon={Info}
          iconColor={dark ? "text-indigo-400" : "text-indigo-600"}
          vehicles={nonSerialises}
          emptyLabel="Aucun véhicule non sérialisé."
          onOpen={(v) => setPopupOrder(v.orderNumber)}
          renderExtra={(v) => (
            <div className="flex shrink-0 flex-col items-end gap-1">
              <span className={`text-xs font-medium ${dark ? "text-zinc-300" : "text-stone-600"}`}>{v.typeVente || "—"}</span>
              <StatusBadge vehicle={v} dark={dark} />
            </div>
          )}
        />
      </div>
      {popupVehicle && (
        <div className="fixed inset-0 z-40 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setPopupOrder(null)} />
          <div className="relative max-h-[85vh] w-full max-w-4xl overflow-y-auto rounded-2xl shadow-xl">
            <ExpandedDetail
              v={popupVehicle}
              dark={dark}
              onClose={() => setPopupOrder(null)}
              onSave={onSave}
              vendorName={vendorName}
              vendeursList={vendeursList}
              sitesList={sitesList}
              onUpdateVehicleSite={onUpdateVehicleSite}
              onAddComment={onAddComment}
              onDeleteComment={onDeleteComment}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function DossierImportForm({ dark, onImport, existingMeta }) {
  const [file, setFile] = useState(null);
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function handleFile(f) {
    setError("");
    try {
      const parsed = await parseWorkbook(f);
      setFile(f);
      setRows(parsed);
    } catch (e) {
      setError("Impossible de lire ce fichier. Vérifiez qu'il s'agit bien d'un export de dossiers au format Excel.");
    }
  }
  async function submit() {
    if (!rows) { setError("Sélectionnez un fichier."); return; }
    setBusy(true);
    const ok = await onImport({ rows, fileName: file?.name });
    setBusy(false);
    if (!ok) setError("Échec de l'enregistrement (base de données injoignable). Ouvrez la console (F12) pour le détail.");
  }
  const dropCls = `flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-6 text-center cursor-pointer transition-colors ${dark ? "border-zinc-700 hover:border-blue-700/60 hover:bg-blue-700/5" : "border-stone-300 hover:border-blue-500 hover:bg-blue-50/50"}`;

  return (
    <div className={`rounded-2xl border p-4 shadow-sm ${dark ? "bg-zinc-900/50 border-zinc-800" : "bg-white border-stone-200"}`}>
      <label className={dropCls}>
        <FileSpreadsheet size={22} className={dark ? "text-zinc-500" : "text-stone-400"} />
        <div className={`text-sm font-medium ${dark ? "text-zinc-200" : "text-stone-700"}`}>Export dossiers (MyAna)</div>
        <div className={`text-xs ${dark ? "text-zinc-500" : "text-stone-400"}`}>{file ? `${file.name} · ${rows?.length ?? 0} lignes` : ".xlsx — dossiers en cours"}</div>
        <input type="file" accept=".xlsx,.xls" className="hidden" onChange={(e) => e.target.files[0] && handleFile(e.target.files[0])} />
      </label>
      {error && <div className="mt-2 text-sm text-rose-500">{error}</div>}
      {existingMeta && (
        <div className={`mt-2 text-xs ${dark ? "text-zinc-500" : "text-stone-400"}`}>
          Dernier import : {new Date(existingMeta.importedAt).toLocaleString("fr-FR")} · {existingMeta.count} dossiers
        </div>
      )}
      <button onClick={submit} disabled={!rows || busy} className="pl-interactive mt-3 w-full rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-500 disabled:opacity-40">
        {busy ? "Import en cours…" : "Valider l'import"}
      </button>
    </div>
  );
}

function DossierRow({ dark, d }) {
  const matched = !!d.vehicle;
  const clientLabel = d.societe || [d.prenom, d.nom].filter(Boolean).join(" ") || "—";
  const modelLabel = matched ? displayModelBase(d.vehicle) : d.modele || "—";
  return (
    <li className={`flex flex-wrap items-center gap-3 px-4 py-3.5 ${dark ? "hover:bg-zinc-900/70" : "hover:bg-blue-50/40"}`} style={{ boxShadow: `inset 4px 0 0 ${matched ? "transparent" : "#E11D48"}` }}>
      <div className="min-w-[130px]">
        <div className={`flex items-center gap-1.5 text-sm font-bold ${dark ? "text-blue-500" : "text-blue-800"}`}>
          <User size={12} className="shrink-0" /> <span className="truncate">{d.vendeur || "—"}</span>
        </div>
        <div className={`truncate text-xs ${dark ? "text-zinc-500" : "text-stone-400"}`}>{clientLabel}</div>
      </div>
      <div className="min-w-[190px] flex-1">
        <div className={`truncate font-semibold ${dark ? "text-zinc-100" : "text-stone-900"}`} title={d.modele}>{modelLabel}</div>
        <div className={`truncate text-xs ${dark ? "text-zinc-400" : "text-stone-500"}`}>
          N° usine <span className="font-mono">{d.numeroUsine || "—"}</span> · {d.localisation || "—"} · {d.categorie || "—"}
        </div>
      </div>
      {!matched && (
        <span className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-bold ${dark ? "bg-rose-500/20 text-rose-300" : "bg-rose-100 text-rose-800"}`}>
          <AlertTriangle size={11} /> Non rapproché
        </span>
      )}
      <span className={`shrink-0 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ${dark ? "bg-zinc-800 text-zinc-300" : "bg-stone-100 text-stone-600"}`}>{d.statutLivraison || "—"}</span>
      <span className={`shrink-0 text-xs tabular-nums ${dark ? "text-zinc-500" : "text-stone-400"}`}>{d.dateCmd || "—"}</span>
    </li>
  );
}

function ManualSaleRow({ dark, v, vendeursList, onAssign, initialVendeur, initialClient, isEdit }) {
  const [vendeur, setVendeur] = useState(initialVendeur || "");
  const [client, setClient] = useState(initialClient || "");
  const ready = vendeur.trim() && client.trim();
  const inputCls = `h-9 rounded-lg border px-2 text-sm outline-none transition-shadow focus:ring-2 ${dark ? "bg-zinc-950 border-zinc-800 text-zinc-200 focus:ring-blue-700/30" : "bg-white border-stone-200 text-stone-700 focus:ring-blue-700/20"}`;

  function confirm() {
    if (!ready) return;
    onAssign(v.orderNumber, { vendeur: vendeur.trim(), client: client.trim() });
  }

  return (
    <li className={`flex flex-wrap items-center gap-2 px-4 py-3 ${dark ? "hover:bg-zinc-900/70" : "hover:bg-blue-50/40"}`}>
      <div className="min-w-[160px] flex-1">
        <div className={`truncate font-semibold ${dark ? "text-zinc-100" : "text-stone-900"}`}>{displayModelBase(v)}</div>
        <div className={`truncate text-xs ${dark ? "text-zinc-500" : "text-stone-400"}`}>Commande {v.orderNumber} · Type {v.typeVente}</div>
      </div>
      <select value={vendeur} onChange={(e) => setVendeur(e.target.value)} className={inputCls}>
        <option value="">— Vendeur —</option>
        {[...vendeursList].sort((a, b) => a.nom.localeCompare(b.nom)).map((vd) => (
          <option key={vd.nom} value={vd.nom}>{vd.nom}</option>
        ))}
      </select>
      <input
        value={client}
        onChange={(e) => setClient(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && confirm()}
        placeholder="Nom du client"
        className={`${inputCls} w-40`}
      />
      <button onClick={confirm} disabled={!ready} className="pl-interactive flex h-9 items-center gap-1 rounded-lg bg-blue-700 px-3 text-sm font-bold text-white transition-colors hover:bg-blue-500 disabled:opacity-40">
        OK
      </button>
      {isEdit && (
        <button onClick={() => onAssign(v.orderNumber, { vendeur: "", client: "" })} className={`rounded-lg p-1.5 transition-colors ${dark ? "text-zinc-500 hover:bg-zinc-800 hover:text-rose-400" : "text-stone-400 hover:bg-stone-100 hover:text-rose-600"}`}>
          <Trash2 size={13} />
        </button>
      )}
    </li>
  );
}

function UnattributedSalesPanel({ dark, vehicles, vendeursList, onAssign }) {
  const unattributed = useMemo(() => vehicles.filter((v) => v.vendu && !v.venduPar && !v.clientLabel), [vehicles]);
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const filtered = unattributed.filter((v) => !q || `${v.orderNumber} ${v.model} ${v.typeVente}`.toLowerCase().includes(q));

  return (
    <div className="space-y-3">
      <p className={`text-sm ${dark ? "text-zinc-500" : "text-stone-400"}`}>
        Ces véhicules sont marqués "Vendu" d'après leur type de vente, sans dossier MyAna correspondant. Renseignez le vendeur et le nom du client, puis validez avec OK.
      </p>
      <div className={`flex h-9 items-center gap-2 rounded-lg border px-3 ${dark ? "bg-zinc-950 border-zinc-800" : "bg-stone-50 border-stone-200"}`}>
        <Search size={14} className={dark ? "text-zinc-500" : "text-stone-400"} />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Commande, modèle, type de vente…" className={`w-full bg-transparent text-sm outline-none ${dark ? "text-zinc-200 placeholder:text-zinc-600" : "text-stone-700 placeholder:text-stone-400"}`} />
      </div>
      {filtered.length === 0 ? (
        <EmptyState
          dark={dark}
          icon={CheckCircle2}
          title={unattributed.length === 0 ? "Toutes les ventes détectées sont attribuées" : "Aucune commande ne correspond"}
        />
      ) : (
        <div className={`overflow-hidden rounded-2xl border ${dark ? "border-zinc-800" : "border-stone-200"}`}>
          <ul className={`max-h-[420px] divide-y overflow-auto ${dark ? "divide-zinc-800" : "divide-stone-200"}`}>
            {filtered.map((v) => (
              <ManualSaleRow key={v.orderNumber} dark={dark} v={v} vendeursList={vendeursList} onAssign={onAssign} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function AttributedManuallyPanel({ dark, vehicles, vendeursList, onAssign }) {
  const attributedManually = useMemo(() => vehicles.filter((v) => v.venduAttribManuelle), [vehicles]);
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const filtered = attributedManually.filter(
    (v) => !q || `${v.orderNumber} ${v.model} ${v.venduPar || ""} ${v.clientLabel || ""}`.toLowerCase().includes(q)
  );

  return (
    <div className="space-y-3">
      <p className={`text-sm ${dark ? "text-zinc-500" : "text-stone-400"}`}>
        Ventes attribuées à la main — modifiables à tout moment.
      </p>
      {attributedManually.length === 0 ? (
        <EmptyState dark={dark} icon={CheckCircle2} title="Aucune attribution manuelle pour l'instant" />
      ) : (
        <>
          <div className={`flex h-9 items-center gap-2 rounded-lg border px-3 ${dark ? "bg-zinc-950 border-zinc-800" : "bg-stone-50 border-stone-200"}`}>
            <Search size={14} className={dark ? "text-zinc-500" : "text-stone-400"} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Commande, modèle, vendeur, client…"
              className={`w-full bg-transparent text-sm outline-none ${dark ? "text-zinc-200 placeholder:text-zinc-600" : "text-stone-700 placeholder:text-stone-400"}`}
            />
          </div>
          {filtered.length === 0 ? (
            <div className={`p-6 text-center text-sm ${dark ? "text-zinc-500" : "text-stone-400"}`}>Aucune correspondance.</div>
          ) : (
            <div className={`overflow-hidden rounded-2xl border ${dark ? "border-zinc-800" : "border-stone-200"}`}>
              <ul className={`max-h-[420px] divide-y overflow-auto ${dark ? "divide-zinc-800" : "divide-stone-200"}`}>
                {filtered.map((v) => (
                  <ManualSaleRow key={v.orderNumber} dark={dark} v={v} vendeursList={vendeursList} onAssign={onAssign} initialVendeur={v.venduPar} initialClient={v.clientLabel} isEdit />
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function DossierList({ dark, dossiers, onExport }) {
  const [query, setQuery] = useState("");
  const [vendeurFilter, setVendeurFilter] = useState("all");
  const [localisationFilter, setLocalisationFilter] = useState("all");
  const vendeurs = useMemo(() => [...new Set(dossiers.map((d) => d.vendeur).filter(Boolean))].sort(), [dossiers]);
  const localisations = useMemo(() => [...new Set(dossiers.map((d) => d.localisation).filter(Boolean))].sort(), [dossiers]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return dossiers.filter((d) => {
      if (vendeurFilter !== "all" && d.vendeur !== vendeurFilter) return false;
      if (localisationFilter !== "all" && d.localisation !== localisationFilter) return false;
      if (q) {
        const hay = `${d.vendeur} ${d.nom} ${d.prenom} ${d.societe} ${d.numeroUsine} ${d.modele}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [dossiers, query, vendeurFilter, localisationFilter]);
  const unmatchedCount = dossiers.filter((d) => !d.vehicle).length;
  const inputCls = `h-9 rounded-lg border px-3 text-sm outline-none transition-shadow focus:ring-2 ${dark ? "bg-zinc-950 border-zinc-800 text-zinc-200 focus:ring-blue-700/30" : "bg-white border-stone-200 text-stone-700 focus:ring-blue-700/20"}`;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <KPICard dark={dark} label="Dossiers" value={dossiers.length} />
        <KPICard dark={dark} label="Rapprochés" value={dossiers.length - unmatchedCount} />
        <KPICard dark={dark} label="Non rapprochés" value={unmatchedCount} />
        <KPICard dark={dark} label="Vendeurs actifs" value={vendeurs.length} />
      </div>
      <div className={`flex flex-wrap items-center gap-2 rounded-2xl border p-2.5 shadow-sm ${dark ? "bg-zinc-900/50 border-zinc-800" : "bg-white border-stone-200"}`}>
        <div className={`flex h-9 min-w-[220px] flex-1 items-center gap-2 rounded-lg border px-3 ${dark ? "bg-zinc-950 border-zinc-800" : "bg-stone-50 border-stone-200"}`}>
          <Search size={14} className={dark ? "text-zinc-500" : "text-stone-400"} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Vendeur, client, N° usine, modèle…" className={`w-full bg-transparent text-sm outline-none ${dark ? "text-zinc-200 placeholder:text-zinc-600" : "text-stone-700 placeholder:text-stone-400"}`} />
        </div>
        <select className={inputCls} value={vendeurFilter} onChange={(e) => setVendeurFilter(e.target.value)}>
          <option value="all">Tous vendeurs</option>
          {vendeurs.map((v) => (
            <option key={v} value={v}>{v}</option>
          ))}
        </select>
        <select className={inputCls} value={localisationFilter} onChange={(e) => setLocalisationFilter(e.target.value)}>
          <option value="all">Tous sites</option>
          {localisations.map((l) => (
            <option key={l} value={l}>{l}</option>
          ))}
        </select>
        <span className={`ml-auto text-xs ${dark ? "text-zinc-500" : "text-stone-400"}`}>{filtered.length} dossier{filtered.length > 1 ? "s" : ""}</span>
        <button onClick={() => onExport(filtered)} className={`flex h-9 items-center gap-1.5 rounded-lg border px-3 text-sm font-semibold transition-colors ${dark ? "border-zinc-700 text-zinc-200 hover:bg-zinc-800" : "border-stone-300 text-stone-700 hover:bg-stone-100"}`}>
          <Download size={14} /> Exporter
        </button>
      </div>
      <div className={`overflow-hidden rounded-2xl border shadow-sm ${dark ? "border-zinc-800" : "border-stone-200"}`}>
        {filtered.length === 0 ? (
          <div className={`p-10 text-center text-sm ${dark ? "text-zinc-500" : "text-stone-400"}`}>Aucun dossier ne correspond.</div>
        ) : (
          <ul className={`max-h-[560px] divide-y overflow-auto ${dark ? "divide-zinc-800" : "divide-stone-200"}`}>
            {filtered.map((d) => (
              <DossierRow key={d.numero || d.numeroUsine} dark={dark} d={d} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function ImportForm({ dark, onImport, existingMeta, onImportDossiers, existingDossiersMeta, dataWarningsCount, onReset, resetConfirm }) {
  const [ordersFile, setOrdersFile] = useState(null);
  const [stockFile, setStockFile] = useState(null);
  const [dossiersFile, setDossiersFile] = useState(null);
  const [ordersRows, setOrdersRows] = useState(null);
  const [stockRows, setStockRows] = useState(null);
  const [dossiersRows, setDossiersRows] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function handleFile(file, which) {
    setError("");
    try {
      const rows = await parseWorkbook(file);
      if (which === "orders") { setOrdersFile(file); setOrdersRows(rows); }
      else if (which === "stock") { setStockFile(file); setStockRows(rows); }
      else { setDossiersFile(file); setDossiersRows(rows); }
    } catch (e) {
      setError("Impossible de lire ce fichier. Vérifiez qu'il s'agit bien d'un export Excel.");
    }
  }

  async function submit() {
    if (!ordersRows) { setError("Le fichier des véhicules commandés est requis."); return; }
    setBusy(true);
    const ok = await onImport({ ordersRows, stockRows: stockRows || [], ordersFileName: ordersFile?.name, stockFileName: stockFile?.name });
    let dossiersOk = true;
    if (ok && dossiersRows && onImportDossiers) {
      dossiersOk = await onImportDossiers({ rows: dossiersRows, fileName: dossiersFile?.name });
    }
    setBusy(false);
    if (!ok) setError("Échec de l'enregistrement (base de données injoignable ou table absente). Ouvrez la console du navigateur (F12) pour le détail, et vérifiez la table Supabase.");
    else if (!dossiersOk) setError("Commandes/stock enregistrés, mais l'import des dossiers a échoué — réessayez.");
  }

  const dropCls = `flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-6 text-center cursor-pointer transition-colors ${dark ? "border-zinc-700 hover:border-blue-700/60 hover:bg-blue-700/5" : "border-stone-300 hover:border-blue-500 hover:bg-blue-50/50"}`;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <label className={dropCls}>
          <FileSpreadsheet size={22} className={dark ? "text-zinc-500" : "text-stone-400"} />
          <div className={`text-sm font-medium ${dark ? "text-zinc-200" : "text-stone-700"}`}>Véhicules commandés</div>
          <div className={`text-xs ${dark ? "text-zinc-500" : "text-stone-400"}`}>{ordersFile ? `${ordersFile.name} · ${ordersRows?.length ?? 0} lignes` : ".xlsx — obligatoire"}</div>
          <input type="file" accept=".xlsx,.xls" className="hidden" onChange={(e) => e.target.files[0] && handleFile(e.target.files[0], "orders")} />
        </label>
        <label className={dropCls}>
          <FileSpreadsheet size={22} className={dark ? "text-zinc-500" : "text-stone-400"} />
          <div className={`text-sm font-medium ${dark ? "text-zinc-200" : "text-stone-700"}`}>Véhicules en stock</div>
          <div className={`text-xs ${dark ? "text-zinc-500" : "text-stone-400"}`}>{stockFile ? `${stockFile.name} · ${stockRows?.length ?? 0} lignes` : ".xlsx — optionnel"}</div>
          <input type="file" accept=".xlsx,.xls" className="hidden" onChange={(e) => e.target.files[0] && handleFile(e.target.files[0], "stock")} />
        </label>
        <label className={dropCls}>
          <FileText size={22} className={dark ? "text-zinc-500" : "text-stone-400"} />
          <div className={`text-sm font-medium ${dark ? "text-zinc-200" : "text-stone-700"}`}>Dossiers (MyAna)</div>
          <div className={`text-xs ${dark ? "text-zinc-500" : "text-stone-400"}`}>{dossiersFile ? `${dossiersFile.name} · ${dossiersRows?.length ?? 0} lignes` : ".xlsx — optionnel"}</div>
          <input type="file" accept=".xlsx,.xls" className="hidden" onChange={(e) => e.target.files[0] && handleFile(e.target.files[0], "dossiers")} />
        </label>
      </div>
      {error && <div className="text-sm text-rose-500">{error}</div>}
      {(existingMeta || existingDossiersMeta) && (
        <div className={`space-y-0.5 text-xs ${dark ? "text-zinc-500" : "text-stone-400"}`}>
          {existingMeta && <div>Dernier import véhicules : {new Date(existingMeta.importedAt).toLocaleString("fr-FR")} · {existingMeta.ordersCount} commandes, {existingMeta.stockCount} en stock</div>}
          {existingDossiersMeta && <div>Dernier import dossiers : {new Date(existingDossiersMeta.importedAt).toLocaleString("fr-FR")} · {existingDossiersMeta.count} dossiers</div>}
          {dataWarningsCount > 0 && (
            <div className={dark ? "text-blue-500" : "text-blue-800"}>{dataWarningsCount} fiche{dataWarningsCount > 1 ? "s" : ""} véhicule à vérifier (données incomplètes)</div>
          )}
        </div>
      )}
      <button onClick={submit} disabled={!ordersRows || busy} className="pl-interactive w-full rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-500 disabled:opacity-40">
        {busy ? "Import en cours…" : "Valider l'import"}
      </button>
      {existingMeta && onReset && (
        <button onClick={onReset} className={`flex w-full items-center justify-center gap-1.5 text-xs transition-colors ${dark ? "text-zinc-500 hover:text-rose-400" : "text-stone-400 hover:text-rose-600"}`}>
          <RotateCcw size={12} /> {resetConfirm ? "Cliquer à nouveau pour confirmer" : "Réinitialiser toutes les données"}
        </button>
      )}
    </div>
  );
}

function ImportGate({ dark, onImport, onImportDossiers }) {
  return (
    <div className="flex min-h-[500px] items-center justify-center p-6">
      <div className={`w-full max-w-lg rounded-2xl border p-6 ${dark ? "bg-zinc-900/60 border-zinc-800" : "bg-white border-stone-200"}`}>
        <div className={`font-display mb-1 text-lg font-semibold ${dark ? "text-zinc-100" : "text-stone-900"}`}>Importer les données du jour</div>
        <div className={`mb-5 text-sm ${dark ? "text-zinc-500" : "text-stone-400"}`}>
          Chargez les deux exports DSR pour démarrer le suivi du parc. Ces données de référence resteront visibles par toute l'équipe et ne pourront pas être modifiées directement.
        </div>
        <ImportForm dark={dark} onImport={onImport} onImportDossiers={onImportDossiers} />
      </div>
    </div>
  );
}

function PasswordChangeModal({ dark, onClose, showToast }) {
  const [pw1, setPw1] = useState("");
  const [pw2, setPw2] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (pw1.length < 6) { setError("6 caractères minimum."); return; }
    if (pw1 !== pw2) { setError("Les deux mots de passe ne correspondent pas."); return; }
    setBusy(true);
    setError("");
    const { error: err } = await supabase.auth.updateUser({ password: pw1 });
    setBusy(false);
    if (err) setError("Échec de la mise à jour — réessayez.");
    else {
      showToast("Mot de passe mis à jour");
      onClose();
    }
  }

  const inputCls = `w-full rounded-lg border px-3 py-2 text-sm outline-none transition-shadow focus:ring-2 ${dark ? "bg-zinc-950 border-zinc-800 text-zinc-200 focus:ring-blue-700/30" : "bg-white border-stone-200 text-stone-700 focus:ring-blue-700/20"}`;

  return (
    <Modal dark={dark} title="Changer mon mot de passe" onClose={onClose}>
      <div className="space-y-2.5">
        <input type="password" autoFocus className={inputCls} placeholder="Nouveau mot de passe" value={pw1} onChange={(e) => setPw1(e.target.value)} />
        <input type="password" className={inputCls} placeholder="Confirmer le mot de passe" value={pw2} onChange={(e) => setPw2(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} />
        {error && <div className="text-xs font-semibold text-rose-500">{error}</div>}
        <button onClick={submit} disabled={busy} className="pl-interactive w-full rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-500 disabled:opacity-50">
          {busy ? "Mise à jour…" : "Valider"}
        </button>
      </div>
    </Modal>
  );
}

const PERMISSION_LABELS = {
  reserve: "Réserver des véhicules",
  reserveForOthers: "Réserver au nom de n'importe qui",
  dashboard: "Onglet Tableau de bord",
  import: "Importer (commandes / stock / dossiers MyAna)",
  dossiers: "Onglet Dossiers (attribution manuelle des ventes)",
  accidentes: "Onglet Accidentés",
  vendeurs: "Onglet Vendeurs (gestion, sites, rôles)",
  reset: "Réinitialiser toutes les données",
};

function VendeursManager({ dark, vendeurs, vehicles, dossiers, sitesList, onAdd, onRemove, onUpdateSite, onUpdateRole, onUpdatePermission, onRename, onUpdateEmail }) {
  const [name, setName] = useState("");
  const [site, setSite] = useState("");
  const [siteFilter, setSiteFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkText, setBulkText] = useState("");
  const [bulkSite, setBulkSite] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);

  const usage = useMemo(() => {
    const counts = {};
    vehicles.forEach((v) => {
      if (v.vendu && v.venduPar) counts[v.venduPar] = (counts[v.venduPar] || 0) + 1;
      const resaVendeur = activeReservationVendeur(v);
      if (resaVendeur) counts[resaVendeur] = (counts[resaVendeur] || 0) + 1;
    });
    return counts;
  }, [vehicles]);

  function submit() {
    if (!name.trim()) return;
    onAdd(name.trim(), site);
    setName("");
    setSite("");
  }

  async function submitBulk() {
    const names = [...new Set(bulkText.split("\n").map((s) => s.trim()).filter(Boolean))];
    if (names.length === 0) return;
    setBulkBusy(true);
    for (const n of names) {
      await onAdd(n, bulkSite);
    }
    setBulkBusy(false);
    setBulkText("");
    setBulkOpen(false);
  }

  const inputCls = `h-9 rounded-lg border px-3 text-sm outline-none transition-shadow focus:ring-2 ${dark ? "bg-zinc-950 border-zinc-800 text-zinc-200 focus:ring-blue-700/30" : "bg-white border-stone-200 text-stone-700 focus:ring-blue-700/20"}`;

  const filtered = (siteFilter === "all" ? vendeurs : vendeurs.filter((v) => v.site === siteFilter)).filter(
    (v) => !query.trim() || v.nom.toLowerCase().includes(query.trim().toLowerCase())
  );

  return (
    <div className="space-y-4">
      <div className={`flex flex-wrap items-center gap-2 rounded-2xl border p-3.5 shadow-sm ${dark ? "bg-zinc-900/60 border-zinc-800" : "bg-white border-stone-200"}`}>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="Nom du vendeur (ex. NEE Alexandre)"
          className={`${inputCls} min-w-[220px] flex-1`}
        />
        <select value={site} onChange={(e) => setSite(e.target.value)} className={inputCls}>
          <option value="">— Site (optionnel) —</option>
          {sitesList.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <button onClick={submit} disabled={!name.trim()} className="pl-interactive flex h-9 items-center gap-1.5 rounded-lg bg-blue-700 px-3.5 text-sm font-bold text-white transition-colors hover:bg-blue-500 disabled:opacity-40">
          <Plus size={15} /> Ajouter
        </button>
        <button
          onClick={() => exportVendeursToExcel(vendeurs)}
          disabled={vendeurs.length === 0}
          className={`flex h-9 items-center gap-1.5 rounded-lg border px-3 text-sm font-semibold transition-colors disabled:opacity-40 ${dark ? "border-zinc-700 text-zinc-200 hover:bg-zinc-800" : "border-stone-300 text-stone-700 hover:bg-stone-100"}`}
        >
          <Download size={14} /> Exporter
        </button>
        <button onClick={() => setBulkOpen((o) => !o)} className={`text-xs font-semibold underline-offset-2 hover:underline ${dark ? "text-zinc-400" : "text-stone-500"}`}>
          {bulkOpen ? "Annuler l'ajout groupé" : "Ajouter plusieurs à la fois"}
        </button>
      </div>

      {bulkOpen && (
        <div className={`space-y-2.5 rounded-2xl border p-3.5 shadow-sm ${dark ? "bg-zinc-900/60 border-zinc-800" : "bg-white border-stone-200"}`}>
          <p className={`text-xs ${dark ? "text-zinc-500" : "text-stone-400"}`}>Un nom par ligne, collez directement depuis une liste ou un tableur.</p>
          <textarea
            value={bulkText}
            onChange={(e) => setBulkText(e.target.value)}
            rows={5}
            placeholder={"LEROY Anthony\nPAILLETTE Nicolas\nNEE Alexandre"}
            className={`w-full rounded-lg border px-3 py-2 font-mono text-sm outline-none transition-shadow focus:ring-2 ${dark ? "bg-zinc-950 border-zinc-800 text-zinc-200 focus:ring-blue-700/30" : "bg-white border-stone-200 text-stone-700 focus:ring-blue-700/20"}`}
          />
          <div className="flex flex-wrap items-center gap-2">
            <select value={bulkSite} onChange={(e) => setBulkSite(e.target.value)} className={inputCls}>
              <option value="">— Site pour tous (optionnel) —</option>
              {sitesList.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <button onClick={submitBulk} disabled={!bulkText.trim() || bulkBusy} className="pl-interactive flex h-9 items-center gap-1.5 rounded-lg bg-blue-700 px-3.5 text-sm font-bold text-white transition-colors hover:bg-blue-500 disabled:opacity-40">
              {bulkBusy ? "Ajout en cours…" : "Ajouter la liste"}
            </button>
          </div>
        </div>
      )}

      {vendeurs.length > 0 && (
        <div className={`flex h-9 items-center gap-2 rounded-lg border px-3 ${dark ? "bg-zinc-950 border-zinc-800" : "bg-stone-50 border-stone-200"}`}>
          <Search size={14} className={dark ? "text-zinc-500" : "text-stone-400"} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Rechercher un vendeur…"
            className={`w-full bg-transparent text-sm outline-none ${dark ? "text-zinc-200 placeholder:text-zinc-600" : "text-stone-700 placeholder:text-stone-400"}`}
          />
        </div>
      )}
      {vendeurs.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <button onClick={() => setSiteFilter("all")} className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${siteFilter === "all" ? "bg-blue-700 text-white" : dark ? "bg-zinc-800 text-zinc-300 hover:bg-zinc-700" : "bg-stone-100 text-stone-600 hover:bg-stone-200"}`}>
            Tous les sites
          </button>
          {sitesList.map((s) => (
            <button key={s} onClick={() => setSiteFilter(s)} className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${siteFilter === s ? "bg-blue-700 text-white" : dark ? "bg-zinc-800 text-zinc-300 hover:bg-zinc-700" : "bg-stone-100 text-stone-600 hover:bg-stone-200"}`}>
              {s}
            </button>
          ))}
        </div>
      )}

      {filtered.length === 0 ? (
        <EmptyState dark={dark} icon={Users} title={vendeurs.length === 0 ? "Aucun vendeur enregistré pour l'instant" : "Aucun vendeur sur ce site"} />
      ) : (
        <ul className="space-y-2.5">
          {[...filtered].sort((a, b) => a.nom.localeCompare(b.nom)).map((v) => (
            <VendeurManageRow
              key={v.nom}
              dark={dark}
              v={v}
              usage={usage[v.nom] || 0}
              sitesList={sitesList}
              onUpdateSite={onUpdateSite}
              onUpdateRole={onUpdateRole}
              onUpdatePermission={onUpdatePermission}
              onRemove={onRemove}
              onRename={onRename}
              onUpdateEmail={onUpdateEmail}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function VendeurManageRow({ dark, v, usage, sitesList, onUpdateSite, onUpdateRole, onUpdatePermission, onRemove, onRename, onUpdateEmail }) {
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState(v.nom);
  const [emailEditing, setEmailEditing] = useState(false);
  const [emailValue, setEmailValue] = useState(v.email || "");
  const role = v.role || "Vendeur";
  const overrides = v.permOverrides || {};
  const effective = { ...ROLE_PERMISSIONS[role], ...overrides };
  const hasOverrides = Object.keys(overrides).length > 0;
  const superAdmin = isSuperAdmin(v.nom);
  const selectCls = `h-9 rounded-lg border px-2.5 text-sm outline-none transition-shadow focus:ring-2 ${dark ? "bg-zinc-950 border-zinc-800 text-zinc-300 focus:ring-blue-700/30" : "bg-white border-stone-200 text-stone-600 focus:ring-blue-700/20"}`;
  const initials = v.nom.split(" ").filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();

  function confirmRename() {
    if (newName.trim() && newName.trim() !== v.nom) onRename(v.nom, newName.trim());
    setRenaming(false);
  }
  function confirmEmail() {
    onUpdateEmail(v.nom, emailValue);
    setEmailEditing(false);
  }

  return (
    <li className={`rounded-2xl border p-4 ${dark ? "bg-zinc-900/40 border-zinc-800" : "bg-white border-stone-200"}`}>
      <div className="flex flex-wrap items-start gap-3">
        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold ring-1 ${dark ? "bg-blue-700/10 text-blue-500 ring-blue-700/20" : "bg-blue-50 text-blue-800 ring-blue-200"}`}>
          {initials}
        </span>

        <div className="min-w-[160px] flex-1 space-y-1">
          {renaming ? (
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") confirmRename(); if (e.key === "Escape") setRenaming(false); }}
              onBlur={confirmRename}
              className={`h-8 w-full rounded-lg border px-2 text-sm font-semibold outline-none focus:ring-2 ${dark ? "bg-zinc-950 border-zinc-800 text-zinc-200 focus:ring-blue-700/30" : "bg-white border-stone-200 text-stone-700 focus:ring-blue-700/20"}`}
            />
          ) : (
            <button onClick={() => { setNewName(v.nom); setRenaming(true); }} className={`truncate text-left text-sm font-semibold hover:underline ${dark ? "text-zinc-100" : "text-stone-900"}`} title="Cliquer pour renommer">
              {v.nom}
            </button>
          )}
          <div className="flex items-center gap-1.5">
            <Lock size={11} className={`shrink-0 ${dark ? "text-zinc-600" : "text-stone-400"}`} />
            {emailEditing ? (
              <input
                autoFocus
                type="email"
                value={emailValue}
                onChange={(e) => setEmailValue(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") confirmEmail(); if (e.key === "Escape") setEmailEditing(false); }}
                onBlur={confirmEmail}
                placeholder="prenom.nom@groupe-legrand.fr"
                className={`h-7 min-w-[200px] flex-1 rounded-lg border px-2 text-xs outline-none focus:ring-2 ${dark ? "bg-zinc-950 border-zinc-800 text-zinc-200 focus:ring-blue-700/30" : "bg-white border-stone-200 text-stone-700 focus:ring-blue-700/20"}`}
              />
            ) : (
              <button onClick={() => { setEmailValue(v.email || ""); setEmailEditing(true); }} className={`truncate text-left text-xs hover:underline ${v.email ? (dark ? "text-zinc-400" : "text-stone-500") : "italic text-blue-700"}`}>
                {v.email || "email non renseigné — cliquer pour ajouter"}
              </button>
            )}
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          <select value={v.site || ""} onChange={(e) => onUpdateSite(v.nom, e.target.value)} className={selectCls} title="Site">
            <option value="">Site non défini</option>
            {sitesList.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          {superAdmin ? (
            <span className={`rounded-full px-2.5 py-1.5 text-xs font-bold ${dark ? "bg-blue-700/20 text-blue-300" : "bg-blue-100 text-blue-900"}`}>Accès complet</span>
          ) : (
            <select value={role} onChange={(e) => onUpdateRole(v.nom, e.target.value)} className={selectCls} title="Rôle">
              {ROLES.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          )}
        </div>

        <button onClick={() => onRemove(v.nom)} className={`shrink-0 rounded-lg p-2 transition-colors ${dark ? "text-zinc-500 hover:bg-zinc-800 hover:text-rose-400" : "text-stone-400 hover:bg-stone-100 hover:text-rose-600"}`}>
          <Trash2 size={15} />
        </button>
      </div>

      <div className={`mt-3 flex flex-wrap items-center gap-2 border-t pt-3 ${dark ? "border-zinc-800" : "border-stone-100"}`}>
        {!superAdmin && (
          <button
            onClick={() => setOpen((o) => !o)}
            className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors ${dark ? "border-zinc-700 text-zinc-300 hover:bg-zinc-800" : "border-stone-300 text-stone-600 hover:bg-stone-100"}`}
          >
            {hasOverrides && <span className={`h-1.5 w-1.5 rounded-full ${dark ? "bg-blue-500" : "bg-blue-700"}`} />}
            <Lock size={12} /> Personnaliser les permissions
            <ChevronRight size={12} className={`transition-transform ${open ? "rotate-90" : ""}`} />
          </button>
        )}
        <span className="ml-auto flex items-center gap-1.5">
          {v.lastLogin ? (
            <span title={new Date(v.lastLogin).toLocaleString("fr-FR")} className={`flex items-center gap-1 text-xs ${dark ? "text-zinc-500" : "text-stone-400"}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${(Date.now() - new Date(v.lastLogin).getTime()) / 86400000 <= 7 ? "bg-emerald-500" : "bg-zinc-400"}`} />
              Connecté le {new Date(v.lastLogin).toLocaleDateString("fr-FR")}
            </span>
          ) : (
            <span className={`flex items-center gap-1 text-xs ${dark ? "text-zinc-600" : "text-stone-400"}`}>
              <span className="h-1.5 w-1.5 rounded-full bg-zinc-400" /> Jamais connecté
            </span>
          )}
          <span className={`text-xs font-medium ${dark ? "text-zinc-500" : "text-stone-400"}`}>· {usage} vente{usage > 1 ? "s" : ""}/résa.</span>
        </span>
      </div>

      {open && !superAdmin && (
        <div className={`mt-3 grid gap-2 rounded-xl border p-3 sm:grid-cols-2 ${dark ? "border-zinc-800 bg-zinc-950/50" : "border-stone-100 bg-stone-50/70"}`}>
          {PERMISSION_KEYS.map((key) => (
            <div key={key} className="flex items-center gap-2">
              <input type="checkbox" checked={!!effective[key]} onChange={(e) => onUpdatePermission(v.nom, key, e.target.checked)} className="accent-blue-700" />
              <span className={`flex-1 text-sm ${dark ? "text-zinc-300" : "text-stone-700"}`}>{PERMISSION_LABELS[key]}</span>
              {overrides[key] !== undefined && (
                <button onClick={() => onUpdatePermission(v.nom, key, null)} className={`text-xs underline-offset-2 hover:underline ${dark ? "text-zinc-500" : "text-stone-400"}`}>
                  défaut
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </li>
  );
}

function SitesManager({ dark, sitesList, vendeurs, onUpdate }) {
  const [name, setName] = useState("");
  const [editing, setEditing] = useState(null);
  const [editValue, setEditValue] = useState("");
  const inputCls = `h-9 rounded-lg border px-3 text-sm outline-none transition-shadow focus:ring-2 ${dark ? "bg-zinc-950 border-zinc-800 text-zinc-200 focus:ring-blue-700/30" : "bg-white border-stone-200 text-stone-700 focus:ring-blue-700/20"}`;
  const countBySite = useMemo(() => {
    const c = {};
    vendeurs.forEach((v) => { if (v.site) c[v.site] = (c[v.site] || 0) + 1; });
    return c;
  }, [vendeurs]);

  function add() {
    const clean = name.trim();
    if (!clean || sitesList.includes(clean)) return;
    onUpdate([...sitesList, clean]);
    setName("");
  }
  function remove(s) {
    onUpdate(sitesList.filter((x) => x !== s));
  }
  function confirmEdit() {
    const clean = editValue.trim();
    if (clean && clean !== editing) {
      onUpdate(sitesList.map((x) => (x === editing ? clean : x)));
    }
    setEditing(null);
  }

  return (
    <div className="space-y-4">
      <p className={`text-sm ${dark ? "text-zinc-500" : "text-stone-400"}`}>
        Ces sites sont proposés partout où un site est attribué à un vendeur (filtres, listes déroulantes).
      </p>
      <div className={`flex items-center gap-2 rounded-2xl border p-3.5 shadow-sm ${dark ? "bg-zinc-900/60 border-zinc-800" : "bg-white border-stone-200"}`}>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          placeholder="Nom du site (ex. Ford Argentan)"
          className={`${inputCls} min-w-[220px] flex-1`}
        />
        <button onClick={add} disabled={!name.trim()} className="pl-interactive flex h-9 items-center gap-1.5 rounded-lg bg-blue-700 px-3.5 text-sm font-bold text-white transition-colors hover:bg-blue-500 disabled:opacity-40">
          <Plus size={15} /> Ajouter
        </button>
      </div>
      {sitesList.length === 0 ? (
        <EmptyState dark={dark} icon={Truck} title="Aucun site enregistré pour l'instant" />
      ) : (
        <ul className="space-y-2.5">
          {sitesList.map((s) => (
            <li key={s} className={`flex items-center gap-3 rounded-2xl border p-4 ${dark ? "bg-zinc-900/40 border-zinc-800" : "bg-white border-stone-200"}`}>
              <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ring-1 ${dark ? "bg-sky-500/10 text-sky-400 ring-sky-500/20" : "bg-sky-50 text-sky-700 ring-sky-200"}`}>
                <Truck size={16} />
              </span>
              {editing === s ? (
                <input
                  autoFocus
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") confirmEdit(); if (e.key === "Escape") setEditing(null); }}
                  onBlur={confirmEdit}
                  className={`h-8 min-w-0 flex-1 rounded-lg border px-2 text-sm font-semibold outline-none focus:ring-2 ${dark ? "bg-zinc-950 border-zinc-800 text-zinc-200 focus:ring-blue-700/30" : "bg-white border-stone-200 text-stone-700 focus:ring-blue-700/20"}`}
                />
              ) : (
                <button onClick={() => { setEditing(s); setEditValue(s); }} className={`min-w-0 flex-1 truncate text-left text-sm font-semibold hover:underline ${dark ? "text-zinc-100" : "text-stone-900"}`} title="Cliquer pour renommer">
                  {s}
                </button>
              )}
              <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${dark ? "bg-zinc-800 text-zinc-400" : "bg-stone-100 text-stone-500"}`}>
                {countBySite[s] || 0} vendeur{(countBySite[s] || 0) > 1 ? "s" : ""}
              </span>
              <button onClick={() => remove(s)} className={`shrink-0 rounded-lg p-2 transition-colors ${dark ? "text-zinc-500 hover:bg-zinc-800 hover:text-rose-400" : "text-stone-400 hover:bg-stone-100 hover:text-rose-600"}`}>
                <Trash2 size={15} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AlertSettingsPanel({ dark, alertSettings, onUpdate }) {
  const [values, setValues] = useState(alertSettings);
  const inputCls = `h-9 w-20 rounded-lg border px-3 text-sm outline-none transition-shadow focus:ring-2 ${dark ? "bg-zinc-950 border-zinc-800 text-zinc-200 focus:ring-blue-700/30" : "bg-white border-stone-200 text-stone-700 focus:ring-blue-700/20"}`;
  const rows = [
    { key: "arriveeRecente", label: "Arrivée récente (véhicule en stock depuis moins de X jours)" },
    { key: "resaExpireBientot", label: "Réservation qui expire bientôt (dans moins de X jours)" },
    { key: "resaLongue", label: "Réservé depuis longtemps (plus de X jours)" },
    { key: "challengeSeuilJours", label: "Stock ancien à challenger (plus de X jours) — onglet Challenge" },
  ];
  return (
    <div className="space-y-4">
      <p className={`text-sm ${dark ? "text-zinc-500" : "text-stone-400"}`}>Ajustez les seuils qui déclenchent les alertes dans l'application.</p>
      <div className={`space-y-3 rounded-2xl border p-4 ${dark ? "border-zinc-800 bg-zinc-900/60" : "border-stone-200 bg-white"}`}>
        {rows.map((r) => (
          <div key={r.key} className="flex items-center gap-3">
            <span className={`flex-1 text-sm ${dark ? "text-zinc-300" : "text-stone-700"}`}>{r.label}</span>
            <input
              type="number"
              min={0}
              value={values[r.key]}
              onChange={(e) => setValues((v) => ({ ...v, [r.key]: Number(e.target.value) }))}
              className={inputCls}
            />
          </div>
        ))}
      </div>
      <button onClick={() => onUpdate(values)} className="pl-interactive rounded-lg bg-blue-700 px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-blue-500">
        Enregistrer les seuils
      </button>
    </div>
  );
}

function ChallengeSettingsPanel({ dark, challengeConfig, entriesCount, onUpdate, onReset }) {
  const [values, setValues] = useState(challengeConfig);
  const [resetConfirm, setResetConfirm] = useState(false);
  const inputCls = `h-9 rounded-lg border px-3 text-sm outline-none transition-shadow focus:ring-2 ${dark ? "bg-zinc-950 border-zinc-800 text-zinc-200 focus:ring-blue-700/30" : "bg-white border-stone-200 text-stone-700 focus:ring-blue-700/20"}`;

  return (
    <div className="space-y-4">
      <p className={`text-sm ${dark ? "text-zinc-500" : "text-stone-400"}`}>
        Motivez l'équipe à écouler le stock ancien avec une prime en euros par véhicule vendu, sur une période définie. Visible par tous dans l'onglet Challenge.
      </p>
      <div className={`space-y-3 rounded-2xl border p-4 ${dark ? "border-zinc-800 bg-zinc-900/60" : "border-stone-200 bg-white"}`}>
        <div className="flex items-center gap-3">
          <span className={`flex-1 text-sm ${dark ? "text-zinc-300" : "text-stone-700"}`}>Challenge actif</span>
          <button
            onClick={() => setValues((v) => ({ ...v, actif: !v.actif }))}
            className={`h-6 w-11 rounded-full transition-colors ${values.actif ? "bg-blue-700" : dark ? "bg-zinc-700" : "bg-stone-300"}`}
          >
            <span className={`block h-5 w-5 translate-x-0.5 rounded-full bg-white transition-transform ${values.actif ? "translate-x-[22px]" : ""}`} />
          </button>
        </div>
        <div className="flex items-center gap-3">
          <span className={`flex-1 text-sm ${dark ? "text-zinc-300" : "text-stone-700"}`}>Prime par véhicule vendu (€)</span>
          <input type="number" min={0} value={values.montantParVehicule} onChange={(e) => setValues((v) => ({ ...v, montantParVehicule: Number(e.target.value) }))} className={`${inputCls} w-24`} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <div className={`mb-1 text-xs ${dark ? "text-zinc-500" : "text-stone-400"}`}>Date de début</div>
            <input type="date" value={values.dateDebut} onChange={(e) => setValues((v) => ({ ...v, dateDebut: e.target.value }))} className={`${inputCls} w-full`} />
          </div>
          <div>
            <div className={`mb-1 text-xs ${dark ? "text-zinc-500" : "text-stone-400"}`}>Date de fin</div>
            <input type="date" value={values.dateFin} onChange={(e) => setValues((v) => ({ ...v, dateFin: e.target.value }))} className={`${inputCls} w-full`} />
          </div>
        </div>
      </div>
      <button onClick={() => onUpdate(values)} className="pl-interactive rounded-lg bg-blue-700 px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-blue-500">
        Enregistrer le challenge
      </button>
      <div className={`rounded-2xl border p-4 ${dark ? "border-zinc-800 bg-zinc-900/60" : "border-stone-200 bg-white"}`}>
        <div className={`text-sm ${dark ? "text-zinc-300" : "text-stone-700"}`}>{entriesCount} vente{entriesCount > 1 ? "s" : ""} comptabilisée{entriesCount > 1 ? "s" : ""} depuis le dernier début de challenge.</div>
        <button
          onClick={() => (resetConfirm ? onReset() : setResetConfirm(true))}
          onBlur={() => setResetConfirm(false)}
          className={`mt-2 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${resetConfirm ? "border-rose-500 text-rose-500" : dark ? "border-zinc-700 text-zinc-300 hover:bg-zinc-800" : "border-stone-300 text-stone-600 hover:bg-stone-100"}`}
        >
          {resetConfirm ? "Confirmer la réinitialisation" : "Réinitialiser les compteurs (nouvelle période)"}
        </button>
      </div>
    </div>
  );
}

const HISTORY_STORES = [
  [STORE_KEYS.overlays, "Réservations, sites et historiques des véhicules"],
  [STORE_KEYS.orders, "Véhicules commandés"],
  [STORE_KEYS.stock, "Véhicules en stock"],
  [STORE_KEYS.dossiers, "Dossiers"],
  [STORE_KEYS.manualSales, "Ventes attribuées manuellement"],
  [STORE_KEYS.vendeurs, "Liste des vendeurs"],
  [STORE_KEYS.accidents, "Véhicules accidentés"],
  [STORE_KEYS.vehicleComments, "Commentaires sur les véhicules"],
];
// Restore an earlier state of a shared data set. Every change keeps the previous state in
// parclive_data_history (database trigger), so a mistake — a bad import, a reset — can be undone.
function VersionHistoryPanel({ dark, onRestore }) {
  const [key, setKey] = useState(STORE_KEYS.overlays);
  const [rows, setRows] = useState(null);
  const [available, setAvailable] = useState(true);
  const [confirmId, setConfirmId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let off = false;
    setRows(null);
    setConfirmId(null);
    (async () => {
      try {
        const { data, error } = await supabase.from("parclive_data_history").select("id, saved_at").eq("key", key).order("saved_at", { ascending: false }).limit(30);
        if (off) return;
        if (error) { setAvailable(false); setRows([]); return; }
        setAvailable(true);
        setRows(data || []);
      } catch (e) {
        if (!off) { setAvailable(false); setRows([]); }
      }
    })();
    return () => { off = true; };
  }, [key, tick]);
  const label = (HISTORY_STORES.find(([k]) => k === key) || [])[1] || key;
  const fmt = (iso) => new Date(iso).toLocaleString("fr-FR", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  async function doRestore(row) {
    setBusy(true);
    const ok = await onRestore(key, row, label, fmt(row.saved_at));
    setBusy(false);
    setConfirmId(null);
    if (ok) setTick((t) => t + 1);
  }
  const selectCls = `h-9 w-full rounded-lg border px-3 text-sm outline-none ${dark ? "bg-zinc-950 border-zinc-800 text-zinc-200" : "bg-white border-stone-200 text-stone-800"}`;
  return (
    <div>
      <div className={`mb-2 text-xs font-bold uppercase tracking-widest ${dark ? "text-zinc-400" : "text-stone-500"}`}>Restaurer une version</div>
      <p className={`mb-2 text-sm ${dark ? "text-zinc-500" : "text-stone-400"}`}>
        En cas d'erreur (mauvais import, réinitialisation, suppression), revenez à l'état des données juste avant une modification. La restauration est elle-même annulable.
      </p>
      <select value={key} onChange={(e) => setKey(e.target.value)} className={selectCls}>
        {HISTORY_STORES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
      </select>
      {rows === null ? (
        <p className={`mt-3 text-sm ${dark ? "text-zinc-500" : "text-stone-400"}`}>Chargement…</p>
      ) : !available ? (
        <p className={`mt-3 text-sm font-semibold ${dark ? "text-amber-400" : "text-amber-600"}`}>L'historique des versions n'est pas encore activé sur la base de données.</p>
      ) : rows.length === 0 ? (
        <p className={`mt-3 text-sm ${dark ? "text-zinc-500" : "text-stone-400"}`}>Aucune version enregistrée pour l'instant — elles apparaissent à chaque modification.</p>
      ) : (
        <ul className={`mt-3 max-h-64 space-y-1 overflow-y-auto rounded-2xl border p-2 ${dark ? "border-zinc-800" : "border-stone-200"}`}>
          {rows.map((r) => (
            <li key={r.id} className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm ${dark ? "hover:bg-zinc-800/50" : "hover:bg-stone-50"}`}>
              <span className={`min-w-0 flex-1 ${dark ? "text-zinc-300" : "text-stone-600"}`}>État avant la modification du <span className="font-semibold">{fmt(r.saved_at)}</span></span>
              {confirmId === r.id ? (
                <>
                  <button disabled={busy} onClick={() => doRestore(r)} className="rounded-lg bg-rose-600 px-3 py-1 text-xs font-bold text-white hover:bg-rose-500 disabled:opacity-60">{busy ? "Restauration…" : "Confirmer"}</button>
                  <button disabled={busy} onClick={() => setConfirmId(null)} className={`rounded-lg border px-3 py-1 text-xs font-semibold ${dark ? "border-zinc-700 text-zinc-300" : "border-stone-300 text-stone-600"}`}>Annuler</button>
                </>
              ) : (
                <button onClick={() => setConfirmId(r.id)} className={`flex items-center gap-1 rounded-lg border px-3 py-1 text-xs font-semibold transition-colors ${dark ? "border-zinc-700 text-zinc-200 hover:bg-zinc-800" : "border-stone-300 text-stone-700 hover:bg-stone-100"}`}><RotateCcw size={12} /> Restaurer</button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function GeneralSettingsPanel({ dark, activityLog, onExportBackup, documentsConfig, onUpdateDocumentsConfig, onRestoreVersion }) {
  const [folderUrl, setFolderUrl] = useState(documentsConfig.folderUrl || "");
  const inputCls = `h-9 w-full rounded-lg border px-3 text-sm outline-none transition-shadow focus:ring-2 ${dark ? "bg-zinc-950 border-zinc-800 text-zinc-200 focus:ring-blue-700/30" : "bg-white border-stone-200 text-stone-700 focus:ring-blue-700/20"}`;
  return (
    <div className="space-y-4">
      <div>
        <div className={`mb-2 text-xs font-bold uppercase tracking-widest ${dark ? "text-zinc-400" : "text-stone-500"}`}>Documents (Google Drive)</div>
        <p className={`mb-2 text-sm ${dark ? "text-zinc-500" : "text-stone-400"}`}>
          Collez le lien de partage d'un dossier Google Drive (menu "Partager" → "Copier le lien" dans Drive, avec un accès "Toute personne disposant du lien"). Il apparaîtra dans l'onglet Documents pour toute l'équipe.
        </p>
        <div className="flex flex-wrap gap-2">
          <input
            value={folderUrl}
            onChange={(e) => setFolderUrl(e.target.value)}
            placeholder="https://drive.google.com/drive/folders/…"
            className={`${inputCls} min-w-[240px] flex-1`}
          />
          <button
            onClick={() => onUpdateDocumentsConfig({ folderUrl: folderUrl.trim() })}
            className="pl-interactive h-9 rounded-lg bg-blue-700 px-4 text-sm font-bold text-white transition-colors hover:bg-blue-500"
          >
            Enregistrer
          </button>
        </div>
        {folderUrl && !driveEmbedUrl(folderUrl) && (
          <p className="mt-2 text-xs font-semibold text-rose-500">Lien non reconnu — vérifiez qu'il s'agit bien d'un lien de dossier Google Drive.</p>
        )}
      </div>
      <div>
        <div className={`mb-2 text-xs font-bold uppercase tracking-widest ${dark ? "text-zinc-400" : "text-stone-500"}`}>Sauvegarde</div>
        <button onClick={onExportBackup} className={`flex items-center gap-2 rounded-lg border px-3.5 py-2 text-sm font-semibold transition-colors ${dark ? "border-zinc-700 text-zinc-200 hover:bg-zinc-800" : "border-stone-300 text-stone-700 hover:bg-stone-100"}`}>
          <Download size={15} /> Exporter une sauvegarde complète (Excel)
        </button>
      </div>
      {onRestoreVersion && <VersionHistoryPanel dark={dark} onRestore={onRestoreVersion} />}
      <div>
        <div className={`mb-2 text-xs font-bold uppercase tracking-widest ${dark ? "text-zinc-400" : "text-stone-500"}`}>Journal d'activité récente</div>
        {activityLog.length === 0 ? (
          <EmptyState dark={dark} size="sm" icon={History} title="Aucune action enregistrée pour l'instant" />
        ) : (
          <ul className={`max-h-72 space-y-1.5 overflow-y-auto rounded-2xl border p-2 ${dark ? "border-zinc-800" : "border-stone-200"}`}>
            {activityLog.map((entry, i) => (
              <li key={i} className={`flex items-start gap-2 rounded-lg px-2 py-1.5 text-sm ${dark ? "hover:bg-zinc-800/50" : "hover:bg-stone-50"}`}>
                <span className={`shrink-0 text-xs tabular-nums ${dark ? "text-zinc-600" : "text-stone-400"}`}>{entry.date} {entry.heure}</span>
                <span className={`min-w-0 flex-1 ${dark ? "text-zinc-300" : "text-stone-600"}`}>
                  <span className="font-medium">{entry.utilisateur}</span> — {entry.action}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function SettingsPanel({ dark, vendeurs, vehicles, dossiers, sitesList, alertSettings, activityLog, challengeConfig, challengeEntries, documentsConfig, onAdd, onRemove, onUpdateSite, onUpdateRole, onUpdatePermission, onRename, onUpdateEmail, onUpdateSites, onUpdateAlertSettings, onUpdateChallengeConfig, onResetChallengeEntries, onExportBackup, onUpdateDocumentsConfig, onRestoreVersion }) {
  const [settingsTab, setSettingsTab] = useState("vendeurs");
  const items = [
    { id: "vendeurs", label: "Vendeurs", icon: Users, group: "equipe" },
    { id: "sites", label: "Sites", icon: Truck, group: "equipe" },
    { id: "alertes", label: "Alertes", icon: AlertTriangle, group: "config" },
    { id: "challenge", label: "Challenge", icon: Trophy, group: "config" },
    { id: "general", label: "Général", icon: Settings, group: "systeme" },
  ];
  return (
    <div className="space-y-4">
      <div className={`inline-flex flex-wrap items-center gap-1 rounded-xl border p-1 ${dark ? "bg-zinc-900/60 border-zinc-800" : "bg-white border-stone-200"}`}>
        {items.map((it, i) => (
          <Fragment key={it.id}>
            {i > 0 && items[i - 1].group !== it.group && <span className={`mx-0.5 h-5 w-px ${dark ? "bg-zinc-800" : "bg-stone-200"}`} />}
            <button
              onClick={() => setSettingsTab(it.id)}
              className={`pl-interactive flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-sm font-medium ${
                settingsTab === it.id ? (dark ? "bg-blue-500/10 text-blue-300" : "bg-blue-50 text-blue-700") : dark ? "text-zinc-400 hover:text-zinc-200" : "text-stone-500 hover:text-stone-800"
              }`}
            >
              <it.icon size={14} />
              {it.label}
            </button>
          </Fragment>
        ))}
      </div>
      {settingsTab === "vendeurs" ? (
        <VendeursManager
          dark={dark}
          vendeurs={vendeurs}
          vehicles={vehicles}
          dossiers={dossiers}
          sitesList={sitesList}
          onAdd={onAdd}
          onRemove={onRemove}
          onUpdateSite={onUpdateSite}
          onUpdateRole={onUpdateRole}
          onUpdatePermission={onUpdatePermission}
          onRename={onRename}
          onUpdateEmail={onUpdateEmail}
        />
      ) : settingsTab === "sites" ? (
        <SitesManager dark={dark} sitesList={sitesList} vendeurs={vendeurs} onUpdate={onUpdateSites} />
      ) : settingsTab === "alertes" ? (
        <AlertSettingsPanel dark={dark} alertSettings={alertSettings} onUpdate={onUpdateAlertSettings} />
      ) : settingsTab === "challenge" ? (
        <ChallengeSettingsPanel dark={dark} challengeConfig={challengeConfig} entriesCount={challengeEntries.length} onUpdate={onUpdateChallengeConfig} onReset={onResetChallengeEntries} />
      ) : (
        <GeneralSettingsPanel dark={dark} activityLog={activityLog} onExportBackup={onExportBackup} documentsConfig={documentsConfig} onUpdateDocumentsConfig={onUpdateDocumentsConfig} onRestoreVersion={onRestoreVersion} />
      )}
    </div>
  );
}

function AccidentManualList({ dark, accidents, vehicles, vendorName, onAdd, onRemove }) {
  const [orderNumber, setOrderNumber] = useState("");
  const [note, setNote] = useState("");

  const inputCls = `h-9 rounded-lg border px-3 text-sm outline-none transition-shadow focus:ring-2 ${dark ? "bg-zinc-950 border-zinc-800 text-zinc-200 focus:ring-rose-500/30" : "bg-white border-stone-200 text-stone-700 focus:ring-rose-500/20"}`;

  function submit() {
    if (!orderNumber.trim()) return;
    onAdd({ orderNumber: orderNumber.trim(), note: note.trim(), addedBy: vendorName || "Vendeur" });
    setOrderNumber("");
    setNote("");
  }

  return (
    <div className="space-y-4">
      <div className={`flex flex-wrap items-center gap-2 rounded-2xl border p-3.5 ${dark ? "bg-zinc-900/60 border-zinc-800" : "bg-white border-stone-200"}`}>
        <input
          value={orderNumber}
          onChange={(e) => setOrderNumber(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="N° de commande"
          className={`${inputCls} w-40`}
        />
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="Détail du sinistre (facultatif)"
          className={`${inputCls} min-w-[200px] flex-1`}
        />
        <button
          onClick={submit}
          disabled={!orderNumber.trim()}
          className="flex h-9 items-center gap-1.5 rounded-lg bg-rose-600 px-3.5 text-sm font-bold text-white transition-colors hover:bg-rose-500 disabled:opacity-40"
        >
          <Plus size={15} /> Ajouter
        </button>
      </div>

      {accidents.length === 0 ? (
        <EmptyState dark={dark} icon={CheckCircle2} title="Aucun véhicule accidenté signalé" subtitle="Tant mieux !" />
      ) : (
        <div className={`overflow-hidden rounded-2xl border ${dark ? "border-zinc-800" : "border-stone-200"}`}>
          <ul className={`divide-y ${dark ? "divide-zinc-800" : "divide-stone-200"}`}>
            {accidents.map((a) => {
              const match = vehicles.find((v) => normalizeOrderNum(v.orderNumber) === normalizeOrderNum(a.orderNumber));
              return (
                <li key={a.id} className={`flex flex-wrap items-center gap-3 px-4 py-3.5 ${dark ? "hover:bg-zinc-900/70" : "hover:bg-rose-50/40"}`}>
                  {match ? <VehicleTypeIcon vu={match.vu} dark={dark} /> : <span className={`inline-flex h-8 w-8 items-center justify-center rounded-lg ${dark ? "bg-zinc-800 text-zinc-500" : "bg-stone-100 text-stone-400"}`}><AlertTriangle size={14} /></span>}
                  <div className="min-w-[170px]">
                    <div className={`font-semibold ${dark ? "text-zinc-100" : "text-stone-900"}`}>{match ? displayModel(match) : "Véhicule introuvable dans l'import"}</div>
                    <div className={`font-mono text-xs ${dark ? "text-zinc-400" : "text-stone-500"}`}>Commande {a.orderNumber}{match?.vin ? ` · ${match.vin}` : ""}</div>
                  </div>
                  <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-bold ${dark ? "bg-rose-500/20 text-rose-300" : "bg-rose-100 text-rose-800"}`}>
                    <AlertTriangle size={11} /> HS
                  </span>
                  <div className={`min-w-[140px] flex-1 truncate text-sm ${dark ? "text-zinc-300" : "text-stone-600"}`}>{a.note || "Aucun détail renseigné"}</div>
                  <div className={`text-xs ${dark ? "text-zinc-500" : "text-stone-400"}`}>Ajouté par {a.addedBy} · {a.addedAt}</div>
                  <button onClick={() => onRemove(a.id)} className={`rounded-lg p-1.5 transition-colors ${dark ? "text-zinc-500 hover:bg-zinc-800 hover:text-rose-400" : "text-stone-400 hover:bg-stone-100 hover:text-rose-600"}`}>
                    <Trash2 size={15} />
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

function Toast({ dark, toast, onDismiss }) {
  if (!toast) return null;
  const isError = toast.type === "error";
  const isCelebrate = toast.type === "celebrate";
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-4">
      <div
        className={`pl-pop pointer-events-auto flex items-center gap-3 rounded-xl border px-4 py-2.5 text-sm font-medium shadow-lg ${
          isError
            ? dark
              ? "bg-rose-950 border-rose-800 text-rose-200"
              : "bg-rose-50 border-rose-200 text-rose-800"
            : isCelebrate
            ? dark
              ? "bg-blue-700/15 border-blue-700/40 text-blue-200"
              : "bg-blue-50 border-blue-300 text-blue-950"
            : dark
            ? "bg-zinc-900 border-zinc-700 text-zinc-100"
            : "bg-zinc-900 border-zinc-800 text-white"
        }`}
      >
        {isError ? (
          <AlertTriangle size={15} className="shrink-0" />
        ) : isCelebrate ? (
          <Trophy size={16} className="pl-celebrate shrink-0 text-blue-500" />
        ) : (
          <CheckCircle2 size={15} className="shrink-0 text-emerald-400" />
        )}
        <span>{toast.message}</span>
        {toast.action && (
          <button onClick={() => { toast.action.onClick(); onDismiss(); }} className="pl-interactive ml-1 shrink-0 rounded-md bg-blue-700 px-2.5 py-1 text-xs font-bold text-white hover:bg-blue-500">
            {toast.action.label}
          </button>
        )}
        <button onClick={onDismiss} className="ml-1 shrink-0 opacity-60 hover:opacity-100">
          <X size={14} />
        </button>
      </div>
    </div>
  );
}

function LoginScreen({ dark, onLogin }) {
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);
  const [resetSent, setResetSent] = useState(false);

  async function submit() {
    if (!email.trim() || !password || checking) return;
    setChecking(true);
    setError("");
    const { error: err } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
    setChecking(false);
    if (err) setError("Email ou mot de passe incorrect.");
    else onLogin();
  }

  async function submitReset() {
    if (!email.trim() || checking) return;
    setChecking(true);
    setError("");
    const redirectTo = window.location.origin + window.location.pathname;
    const { error: err } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), { redirectTo });
    setChecking(false);
    if (err) setError("Échec de l'envoi — vérifiez l'adresse email.");
    else setResetSent(true);
  }

  const inputCls = `w-full rounded-lg border px-3.5 py-2.5 text-left text-sm outline-none transition-shadow focus:ring-2 ${dark ? "bg-zinc-950 border-zinc-800 text-zinc-200 focus:ring-blue-700/30" : "bg-white border-stone-200 text-stone-700 focus:ring-blue-700/20"}`;

  return (
    <div className="flex min-h-[85vh] items-center justify-center p-6">
      <div className={`w-full max-w-sm rounded-2xl border p-8 text-center ${dark ? "bg-zinc-900 border-zinc-800 shadow-xl" : "bg-white border-stone-200 shadow-lg"}`}>
        <div className="mb-6 flex flex-col items-center">
          <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 to-blue-800 text-white shadow-lg">
            <Car size={22} />
          </span>
          <div className={`text-2xl font-semibold tracking-tight ${dark ? "text-zinc-50" : "text-stone-900"}`}>
            Parc<span className={dark ? "text-blue-400" : "text-blue-700"}>Live</span>
          </div>
          <div className={`mt-1 text-sm ${dark ? "text-zinc-400" : "text-stone-500"}`}>Le parc Ford Caen, en temps réel</div>
        </div>
        {mode === "login" ? (
          <>
            <p className={`mb-4 text-sm ${dark ? "text-zinc-500" : "text-stone-400"}`}>Connectez-vous avec votre adresse professionnelle.</p>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
              placeholder="prenom.nom@groupe-legrand.fr"
              autoFocus
              autoCapitalize="off"
              className={inputCls}
            />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
              placeholder="Mot de passe"
              className={`mt-2 ${inputCls} ${error ? "border-rose-500 focus:ring-rose-500/30" : ""}`}
            />
            {error && <div className="mt-2 text-xs font-semibold text-rose-500">{error}</div>}
            <button onClick={submit} disabled={checking} className="pl-interactive mt-3 w-full rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-blue-500 disabled:opacity-50">
              {checking ? "Connexion…" : "Se connecter"}
            </button>
            <button
              onClick={() => { setMode("reset"); setError(""); setResetSent(false); }}
              className={`mt-3 text-xs underline-offset-2 hover:underline ${dark ? "text-zinc-500" : "text-stone-400"}`}
            >
              Mot de passe oublié ?
            </button>
          </>
        ) : (
          <>
            <p className={`mb-4 mt-1 text-sm ${dark ? "text-zinc-500" : "text-stone-400"}`}>
              Saisissez votre email, nous vous envoyons un lien pour réinitialiser votre mot de passe.
            </p>
            {resetSent ? (
              <div className={`rounded-lg border px-3 py-3 text-sm ${dark ? "border-emerald-800 bg-emerald-500/10 text-emerald-300" : "border-emerald-200 bg-emerald-50 text-emerald-700"}`}>
                Email envoyé — vérifiez votre boîte de réception (et vos spams).
              </div>
            ) : (
              <>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && submitReset()}
                  placeholder="prenom.nom@groupe-legrand.fr"
                  autoFocus
                  autoCapitalize="off"
                  className={inputCls}
                />
                {error && <div className="mt-2 text-xs font-semibold text-rose-500">{error}</div>}
                <button onClick={submitReset} disabled={checking} className="pl-interactive mt-3 w-full rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-blue-500 disabled:opacity-50">
                  {checking ? "Envoi…" : "Envoyer le lien"}
                </button>
              </>
            )}
            <button
              onClick={() => { setMode("login"); setError(""); }}
              className={`mt-3 text-xs underline-offset-2 hover:underline ${dark ? "text-zinc-500" : "text-stone-400"}`}
            >
              Retour à la connexion
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function SetNewPasswordScreen({ dark, onDone }) {
  const [pw1, setPw1] = useState("");
  const [pw2, setPw2] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (pw1.length < 6) { setError("6 caractères minimum."); return; }
    if (pw1 !== pw2) { setError("Les deux mots de passe ne correspondent pas."); return; }
    setBusy(true);
    setError("");
    const { error: err } = await supabase.auth.updateUser({ password: pw1 });
    setBusy(false);
    if (err) setError("Échec de la mise à jour — réessayez ou redemandez un lien.");
    else onDone();
  }

  const inputCls = `w-full rounded-lg border px-3.5 py-2.5 text-left text-sm outline-none transition-shadow focus:ring-2 ${dark ? "bg-zinc-950 border-zinc-800 text-zinc-200 focus:ring-blue-700/30" : "bg-white border-stone-200 text-stone-700 focus:ring-blue-700/20"}`;

  return (
    <div className="flex min-h-[520px] items-center justify-center p-6">
      <div className={`w-full max-w-sm rounded-2xl border p-6 text-center shadow-sm ${dark ? "bg-zinc-900 border-zinc-800" : "bg-white border-stone-200"}`}>
        <div className="mb-4 flex justify-center">
          <span className={`flex h-12 w-12 items-center justify-center rounded-full ring-1 ${dark ? "bg-blue-700/10 text-blue-500 ring-blue-700/20" : "bg-blue-50 text-blue-800 ring-blue-200"}`}>
            <Lock size={20} />
          </span>
        </div>
        <div className={`font-display text-lg font-semibold ${dark ? "text-zinc-50" : "text-stone-900"}`}>Nouveau mot de passe</div>
        <p className={`mb-4 mt-1 text-sm ${dark ? "text-zinc-500" : "text-stone-400"}`}>Choisissez votre nouveau mot de passe.</p>
        <input type="password" autoFocus className={inputCls} placeholder="Nouveau mot de passe" value={pw1} onChange={(e) => setPw1(e.target.value)} />
        <input type="password" className={`mt-2 ${inputCls}`} placeholder="Confirmer" value={pw2} onChange={(e) => setPw2(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} />
        {error && <div className="mt-2 text-xs font-semibold text-rose-500">{error}</div>}
        <button onClick={submit} disabled={busy} className="pl-interactive mt-3 w-full rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-blue-500 disabled:opacity-50">
          {busy ? "Mise à jour…" : "Valider"}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main app
// ---------------------------------------------------------------------------
function resolveConvoyageRecipients(orderNumber, siteDepart, siteArrivee, vehicles, vendeursList) {
  const emails = new Set();
  vendeursList.forEach((v) => {
    if (!v.email) return;
    if (v.role === "Directeur de plaque" || v.role === "Chef des ventes") emails.add(v.email);
    else if (v.role === "Responsable de site" && (v.site === siteDepart || v.site === siteArrivee)) emails.add(v.email);
  });
  const vehicle = vehicles.find((v) => v.orderNumber === orderNumber);
  if (vehicle) {
    const concernedName = vehicle.venduPar || activeReservationVendeur(vehicle);
    const concerned = concernedName && vendeursList.find((v) => v.nom === concernedName);
    if (concerned?.email) emails.add(concerned.email);
  }
  return [...emails];
}
function openConvoyageMailDraft({ orderNumber, siteDepart, siteArrivee, dateSouhaitee, commentaire, demandePar, vehicles, vendeursList }) {
  const recipients = resolveConvoyageRecipients(orderNumber, siteDepart, siteArrivee, vehicles, vendeursList);
  const vehicle = vehicles.find((v) => v.orderNumber === orderNumber);
  const vehicleLabel = vehicle ? displayModelBase(vehicle) : orderNumber;
  const subject = `Demande de convoyage — ${vehicleLabel} (${orderNumber})`;
  const body = [
    "Une demande de convoyage a été enregistrée dans ParcLive :",
    "",
    `Véhicule : ${vehicleLabel} — commande ${orderNumber}`,
    `Départ : ${siteDepart}`,
    `Arrivée : ${siteArrivee}`,
    `Date souhaitée : ${dateSouhaitee}`,
    commentaire ? `Commentaire : ${commentaire}` : null,
    `Demandé par : ${demandePar}`,
  ]
    .filter(Boolean)
    .join("\n");
  const mailto = `mailto:${recipients.join(",")}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  window.location.href = mailto;
  return recipients;
}
function computeStats(vehicles) {
  const inStockList = vehicles.filter((v) => v.inStock);
  const avgJoursStock = inStockList.length ? Math.round(inStockList.reduce((n, v) => n + v.joursStock, 0) / inStockList.length) : 0;
  const buckets = [
    { name: "0-7j", count: 0 },
    { name: "7-15j", count: 0 },
    { name: "15-30j", count: 0 },
    { name: "30j+", count: 0 },
  ];
  inStockList.forEach((v) => {
    if (v.joursStock <= 7) buckets[0].count++;
    else if (v.joursStock <= 15) buckets[1].count++;
    else if (v.joursStock <= 30) buckets[2].count++;
    else buckets[3].count++;
  });
  const STATUS_LABELS = { disponible: "Disponible", reserve: "Réservé", vendu: "Vendu", commande: "Commandé", non_serialise: "Non sérialisé", hs: "HS" };
  return {
    total: vehicles.length,
    vp: vehicles.filter((v) => !v.vu).length,
    vu: vehicles.filter((v) => v.vu).length,
    disponibles: vehicles.filter((v) => v.baseStatus === "disponible").length,
    reserves: vehicles.filter((v) => v.baseStatus === "reserve").length,
    vendus: vehicles.filter((v) => v.baseStatus === "vendu").length,
    hsCount: vehicles.filter((v) => v.baseStatus === "hs").length,
    arrivees: vehicles.filter((v) => v.inStock && v.joursStock <= 3).length,
    nonSerialises: vehicles.filter((v) => v.baseStatus === "non_serialise").length,
    electriques: vehicles.filter((v) => v.energy === "Électrique").length,
    hybridesRecharge: vehicles.filter((v) => v.energy === "Hybride rechargeable").length,
    activeAlerts: vehicles.reduce((n, v) => n + v.alerts.length, 0),
    avgJoursStock,
    dataWarnings: vehicles.filter((v) => v.dataWarning).length,
    byTypeVente: groupCount(vehicles, (v) => v.typeVente),
    byVendeur: groupCount(vehicles.filter((v) => activeReservationVendeur(v)), (v) => v.reservation.vendeur),
    byVenteVendeur: groupCount(vehicles.filter((v) => v.vendu && v.venduPar), (v) => v.venduPar),
    byStatus: groupCount(vehicles, (v) => STATUS_LABELS[v.baseStatus] || v.baseStatus).map((d) => ({ ...d, name: d.name === "—" ? "Autre" : d.name })),
    byConcession: groupCount(vehicles, (v) => v.concession),
    byType: [
      { name: "VP", count: vehicles.filter((v) => !v.vu).length },
      { name: "VU", count: vehicles.filter((v) => v.vu).length },
    ],
    stockBuckets: buckets,
    topModels: groupCount(vehicles, (v) => v.model).slice(0, 5),
  };
}

// ---------------------------------------------------------------------------
// Module Prospection B2B (intégré depuis parclive-prospection.zip)
// Onglet visible uniquement pour les comptes présents dans prospection_members
// (accès géré côté base via RLS — voir useProspectionAccess ci-dessous).
// ---------------------------------------------------------------------------
// Quatre statuts : « Prospect » (en cours de prospection), « Proposition envoyée » (relance en général à 72 h),
// « Gagné » et « Perdu » (avec un motif : ex. ne veut plus entendre parler de la marque).
// Un Prospect et une Proposition envoyée ont toujours une date de relance.
const PROSPECTION_STATUTS = ["Prospect", "Proposition envoyée", "Gagné", "Perdu"];
// Orange volontairement absent de cette palette : il reste réservé au statut "Réservé" des véhicules.
const PROSPECTION_STATUT_COLORS = {
  "Prospect": "#0EA5E9",
  "Proposition envoyée": "#7C3AED",
  "Gagné": "#16A34A",
  "Perdu": "#94A3B8",
};
const PROSPECTION_MOTIFS_PERTE = ["Ne veut plus entendre parler de la marque", "Pas de besoin durable", "Parti chez un concurrent", "Injoignable", "Société fermée / disparue", "Autre"];
// Anciens statuts : « Offre envoyée » devient « Proposition envoyée » ; À contacter / Contacté / RDV fixé -> Prospect.
function prospectionStatutOf(statut) {
  if (statut === "Gagné" || statut === "Perdu" || statut === "Proposition envoyée") return statut;
  return statut === "Offre envoyée" ? "Proposition envoyée" : "Prospect";
}
function prospectionNeedsRelance(statut) {
  return statut === "Prospect" || statut === "Proposition envoyée";
}
const PROSPECTION_COMMERCIAL_COLORS = ["#1D4ED8", "#0D9488", "#7C3AED", "#DB2777", "#0891B2", "#65A30D"];
// Couleur des clients existants (CRM) sur la carte — volontairement distincte de toutes les couleurs
// de statut/commercial ci-dessus, et associée à une forme de marqueur différente (losange vs rond).
// Volontairement claire/discrète : avec plusieurs centaines de clients affichés en permanence,
// une couleur sombre sature visuellement la carte et masque les prospects actifs.
const PROSPECTION_CLIENT_COLOR = "#94A3B8";
const PROSPECTION_SECTEURS = ["BTP", "Artisans", "Transport et logistique", "Agriculture", "Commerce", "Services", "Santé", "Collectivités", "Industrie", "Location / VTC"];
const PROSPECTION_MODELES = ["Transit", "Transit Custom", "Transit Connect", "Transit Courier", "E-Transit", "Ranger", "Puma", "Kuga", "Explorer", "Mustang Mach-E", "Flotte mixte"];
const PROSPECTION_TYPES_ACTION = ["Appel", "Email", "Visite", "RDV", "Relance", "Autre"];
// Critères de qualification du parc automobile de l'entreprise (taille = champ « flotte » existant).
const PROSPECTION_MARQUES = ["Ford", "Renault", "Peugeot", "Citroën", "Volkswagen", "Mercedes", "Toyota", "Fiat", "Opel", "Iveco", "Nissan", "Dacia"];
const PROSPECTION_ENERGIES = ["Gazole", "Essence", "Électrique", "Hybride"];
const PROSPECTION_PERIODICITES = [[6, "Tous les 6 mois"], [12, "Tous les ans"], [24, "Tous les 2 ans"], [36, "Tous les 3 ans"], [48, "Tous les 4 ans"], [60, "Tous les 5 ans"]];
const PROSPECTION_RAPPEL_AVANCE_MOIS = 2; // on rappelle 2 mois avant l'échéance estimée si le dernier renouvellement est connu
const PROSPECTION_PROPOSITION_RELANCE_JOURS = 3; // relance 72 h après l'envoi d'une proposition
const PROSPECTION_RELANCE_DEFAUT_JOURS = 10; // date de relance proposée quand aucune périodicité n'est renseignée
// Colonnes ajoutées par sql/prospection-criteres.sql
const PROSPECTION_CRITERE_COLS = ["marques", "energies", "decideur", "renouvellement_mois", "dernier_renouvellement", "motif_perte", "derniere_proposition"];
const PROSPECTION_CAEN_CENTER = { lat: 49.1829, lng: -0.3707 };
const PROSPECTION_OBJECTIF_SEMAINE = 25;

// Aucun rôle ParcLive existant ne distingue les commerciaux B2B des autres vendeurs —
// liste à éditer ici en attendant un éventuel champ dédié. Signalé dans le récapitulatif de livraison.
const PROSPECTION_COMMERCIAUX = ["Anthony", "Thao", "Tom", "Julia"];
// Binômes : Anthony + Thao (équipe A, zone sud), Tom + Julia (équipe B, zone nord).
// Thao et Julia sont les alternants respectifs d'Anthony et Tom.
const PROSPECTION_TEAMS = { Anthony: "A", Thao: "A", Tom: "B", Julia: "B" };
const PROSPECTION_TEAM_ZONE_LAT = 49.178; // ligne de partage nord/sud, au niveau de la Prairie de Caen
const PROSPECTION_TEAM_COLORS = {
  A: { main: "#1D4ED8", light: "#93C5FD" }, // Anthony (fonce) / Thao, alternante (clair)
  B: { main: "#047857", light: "#6EE7B7" }, // Tom (fonce) / Julia, alternante (clair)
};

function prospectionTodayISO(d) {
  const base = d || new Date();
  const z = new Date(base.getTime() - base.getTimezoneOffset() * 60000);
  return z.toISOString().slice(0, 10);
}
function prospectionAddDaysISO(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return prospectionTodayISO(d);
}
function prospectionFrDate(s) {
  return s ? new Date(s + "T00:00").toLocaleDateString("fr-FR", { day: "numeric", month: "short" }) : "";
}
function prospectionInitials(n) {
  return (n || "?").split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
}
function prospectionRelanceState(p) {
  if (!p.relance || p.statut === "Gagné" || p.statut === "Perdu") return "";
  const t = prospectionTodayISO();
  if (p.relance < t) return "late";
  if (p.relance === t) return "due";
  return "future";
}
function prospectionMapsDirectionsUrl(p) {
  return p.lat != null
    ? `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}`
    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([p.adresse, p.code_postal, p.commune].filter(Boolean).join(" "))}`;
}

// --- Commercial automatique : « LEROY Anthony » (nom de compte) -> « Anthony » (liste des commerciaux B2B).
function prospectionNorm(s) {
  return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}
function prospectionCommercialFor(name) {
  const tokens = prospectionNorm(name).split(/[^a-z0-9]+/).filter(Boolean);
  return PROSPECTION_COMMERCIAUX.find((c) => tokens.includes(prospectionNorm(c))) || "";
}

// --- Champs multi-valeurs stockés en texte « Ford, Renault ».
function prospectionListOf(s) {
  return String(s || "").split(",").map((x) => x.trim()).filter(Boolean);
}
function prospectionToggleInList(s, item) {
  const l = prospectionListOf(s);
  const i = l.findIndex((x) => prospectionNorm(x) === prospectionNorm(item));
  if (i >= 0) l.splice(i, 1); else l.push(item);
  return l.join(", ");
}

// --- Dates de rappel selon la périodicité de renouvellement du parc.
function prospectionAddMonthsISO(iso, n) {
  const [y, m, d] = (iso || prospectionTodayISO()).split("-").map(Number);
  const t = new Date(y, m - 1 + n, 1);
  const last = new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate();
  t.setDate(Math.min(d, last));
  return prospectionTodayISO(t);
}
// Prochain renouvellement estimé = dernier renouvellement (si connu, sinon aujourd'hui) + périodicité.
// Le rappel est posé 2 mois avant l'échéance quand le dernier renouvellement est connu (pour préparer l'offre),
// jamais avant demain.
// Retourne null tant que la périodicité n'est pas renseignée (la date de relance est alors à définir à la main).
function prospectionRenewalPlan(p, todayISO) {
  const today = todayISO || prospectionTodayISO();
  const per = parseInt(p.renouvellement_mois, 10) || 0;
  if (!per) return null;
  const known = !!p.dernier_renouvellement;
  const next = prospectionAddMonthsISO(known ? p.dernier_renouvellement : today, per);
  let rappel = known ? prospectionAddMonthsISO(next, -PROSPECTION_RAPPEL_AVANCE_MOIS) : next;
  const t = new Date(today + "T00:00");
  t.setDate(t.getDate() + 1);
  const tomorrow = prospectionTodayISO(t);
  if (rappel < tomorrow) rappel = tomorrow;
  return { months: per, next, rappel, known };
}
// Position GPS du navigateur (null si refusée / indisponible).
function prospectionGetPosition() {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) { resolve(null); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  });
}

// Géocodage via l'API Géoplateforme de l'IGN (ex-API Adresse) : gratuite, sans clé.
const PROSPECTION_GEOCODE_BASE = "https://data.geopf.fr/geocodage/search";
async function prospectionGeocode({ adresse, code_postal, commune }) {
  const q = [adresse, code_postal, commune].filter(Boolean).join(" ").trim();
  if (q.length < 3) return null;
  try {
    const r = await fetch(`${PROSPECTION_GEOCODE_BASE}?q=${encodeURIComponent(q)}&limit=1`);
    if (!r.ok) return null;
    const f = (await r.json()).features?.[0];
    if (!f) return null;
    const [lng, lat] = f.geometry.coordinates;
    return { lat, lng, score: f.properties.score };
  } catch (e) {
    return null;
  }
}
async function prospectionReverseGeocode(lat, lng) {
  try {
    const r = await fetch(`https://data.geopf.fr/geocodage/reverse?lon=${lng}&lat=${lat}&limit=1`);
    if (!r.ok) return null;
    const f = (await r.json()).features?.[0];
    if (!f) return null;
    return {
      adresse: f.properties.name || "",
      code_postal: f.properties.postcode || "",
      commune: f.properties.city || "",
    };
  } catch (e) {
    return null;
  }
}
// Retrouve, si possible, l'entreprise/le lieu nommé exactement à l'endroit cliqué (appui long),
// pour proposer directement son nom plutôt que de laisser le champ Société vide.
async function prospectionFindPlaceAt(lat, lng, radiusM) {
  const r = radiusM || 35;
  const query = `[out:json][timeout:8];(node["name"](around:${r},${lat},${lng});way["name"](around:${r},${lat},${lng}););out center tags 8;`;
  try {
    const res = await fetch(PROSPECTION_OVERPASS_URL, { method: "POST", body: "data=" + encodeURIComponent(query) });
    if (!res.ok) return null;
    const data = await res.json();
    let best = null;
    let bestDist = Infinity;
    for (const el of data.elements || []) {
      if (!el.tags?.name) continue;
      const elat = el.center?.lat ?? el.lat;
      const elng = el.center?.lon ?? el.lon;
      if (elat == null || elng == null) continue;
      const d = Math.hypot(elat - lat, elng - lng);
      if (d < bestDist) { bestDist = d; best = el; }
    }
    if (!best) return null;
    return {
      societe: best.tags.name,
      secteur: best.tags.shop || best.tags.office || best.tags.craft || best.tags.amenity || "",
      adresse: [best.tags["addr:housenumber"], best.tags["addr:street"]].filter(Boolean).join(" ") || undefined,
      code_postal: best.tags["addr:postcode"] || undefined,
      commune: best.tags["addr:city"] || undefined,
      tel: best.tags.phone || best.tags["contact:phone"] || "",
      email: best.tags.email || best.tags["contact:email"] || "",
    };
  } catch (e) {
    return null;
  }
}
async function prospectionSuggestAdresses(q) {
  if (!q || q.trim().length < 4) return [];
  try {
    const r = await fetch(`${PROSPECTION_GEOCODE_BASE}?q=${encodeURIComponent(q)}&limit=5&autocomplete=1&lat=49.18&lon=-0.37`);
    if (!r.ok) return [];
    return ((await r.json()).features || []).map((f) => ({
      label: f.properties.label,
      adresse: f.properties.name,
      code_postal: f.properties.postcode,
      commune: f.properties.city,
      lat: f.geometry.coordinates[1],
      lng: f.geometry.coordinates[0],
    }));
  } catch (e) {
    return [];
  }
}

// Découverte d'entreprises à proximité, à partir des données OpenStreetMap elles-mêmes (Overpass) —
// gratuit, sans clé. Ne renvoie que ce qui est dans le rectangle visible, d'où l'obligation de zoomer.
const PROSPECTION_OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const PROSPECTION_OSM_MIN_ZOOM = 15;
// En dessous de ce zoom (vue large de l'agglo), les clients existants sont masqués : à 582 clients,
// les afficher sur toute la carte la rend illisible. Ils réapparaissent dès qu'on zoome sur un secteur.
const PROSPECTION_CLIENT_MIN_ZOOM = 13;
async function prospectionSearchNearbyBusinesses(bounds, signal) {
  const bbox = `${bounds.getSouth()},${bounds.getWest()},${bounds.getNorth()},${bounds.getEast()}`;
  const amenities = ["car_rental", "car_wash", "fuel", "bank", "bureau_de_change", "pharmacy", "veterinary", "driving_school", "dentist", "doctors", "clinic", "hospital", "post_office"];
  const tagFilters = ["shop", "office", "craft", ...amenities.map((a) => `amenity"="${a}`)];
  // Beaucoup d'entreprises sont représentées par le contour de leur bâtiment ("way"), pas par un
  // simple point ("node") — chercher uniquement les nodes en faisait manquer une bonne partie.
  const clauses = tagFilters.flatMap((t) => [`node["${t}"](${bbox});`, `way["${t}"](${bbox});`]).join("");
  const query = `[out:json][timeout:10];(${clauses});out center 90;`;
  try {
    const r = await fetch(PROSPECTION_OVERPASS_URL, { method: "POST", body: "data=" + encodeURIComponent(query), signal });
    if (!r.ok) return [];
    const data = await r.json();
    return (data.elements || [])
      .filter((el) => el.tags?.name)
      .map((el) => {
        const lat = el.lat ?? el.center?.lat;
        const lng = el.lon ?? el.center?.lon;
        if (lat == null || lng == null) return null;
        return {
          osmId: `${el.type?.[0] || "n"}${el.id}`,
          lat,
          lng,
          societe: el.tags.name,
          secteur: el.tags.shop || el.tags.office || el.tags.craft || el.tags.amenity || "",
          adresse: [el.tags["addr:housenumber"], el.tags["addr:street"]].filter(Boolean).join(" "),
          code_postal: el.tags["addr:postcode"] || "",
          commune: el.tags["addr:city"] || "",
          tel: el.tags.phone || el.tags["contact:phone"] || "",
          email: el.tags.email || el.tags["contact:email"] || "",
        };
      })
      .filter(Boolean);
  } catch (e) {
    return [];
  }
}

// Recherche ponctuelle des zones d'activité / zones industrielles (ZA/ZI) dans un large rayon —
// différente de la découverte de proximité (qui ne fonctionne qu'en zoomant de près) : ici on
// interroge une seule fois tout le rayon demandé, quel que soit le niveau de zoom affiché.
async function prospectionSearchIndustrialZones(center, radiusKm) {
  const around = `around:${Math.round(radiusKm * 1000)},${center.lat},${center.lng}`;
  const query = `[out:json][timeout:25];(way["landuse"="industrial"](${around});way["landuse"="commercial"](${around}););out center tags 300;`;
  try {
    const r = await fetch(PROSPECTION_OVERPASS_URL, { method: "POST", body: "data=" + encodeURIComponent(query) });
    if (!r.ok) return [];
    const data = await r.json();
    return (data.elements || [])
      .map((el) => {
        const lat = el.center?.lat ?? el.lat;
        const lng = el.center?.lon ?? el.lon;
        if (lat == null || lng == null) return null;
        const nom = el.tags?.name || el.tags?.["addr:city"] || null;
        if (!nom) return null; // pas assez d'info pour identifier la zone sur la carte
        return {
          zoneId: `${el.type?.[0] || "w"}${el.id}`,
          lat,
          lng,
          nom,
          type: el.tags?.landuse === "commercial" ? "Zone commerciale" : "Zone industrielle",
        };
      })
      .filter(Boolean);
  } catch (e) {
    return [];
  }
}

// Import/export CSV compatibles avec l'export de l'ancienne application de prospection (séparateur ";").
const PROSPECTION_CSV_COLS = ["societe", "secteur", "adresse", "code_postal", "commune", "contact", "fonction", "tel", "email", "flotte", "marques", "energies", "decideur", "renouvellement_mois", "dernier_renouvellement", "modele", "statut", "commercial", "relance", "derniere_proposition", "motif_perte", "notes"];
function prospectionParseCsvLine(line, sep) {
  const out = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === sep) { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out;
}
function parseProspectsCsv(text) {
  const clean = text.replace(/^\ufeff/, "").replace(/\r/g, "");
  const lines = clean.split("\n").filter((l) => l.trim());
  if (!lines.length) return [];
  const sep = (lines[0].match(/;/g) || []).length >= (lines[0].match(/,/g) || []).length ? ";" : ",";
  const head = prospectionParseCsvLine(lines[0], sep).map((h) => h.trim().toLowerCase());
  return lines
    .slice(1)
    .map((l) => {
      const cells = prospectionParseCsvLine(l, sep);
      const row = {};
      head.forEach((h, i) => { if (PROSPECTION_CSV_COLS.includes(h)) row[h] = cells[i]; });
      return row;
    })
    .filter((r) => r.societe);
}
function prospectsToCsv(prospects) {
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  return "\ufeff" + [PROSPECTION_CSV_COLS.join(";"), ...prospects.map((p) => PROSPECTION_CSV_COLS.map((c) => esc(p[c])).join(";"))].join("\n");
}

// { allowed, readOnly } : allowed = le compte est dans prospection_members ; readOnly = membre en lecture seule
// (colonne lecture_seule, ex. marketing / direction). La vraie restriction est appliquée par la RLS côté base.
function useProspectionAccess(userId) {
  const [access, setAccess] = useState({ allowed: false, readOnly: false });
  useEffect(() => {
    let alive = true;
    if (!userId) { setAccess({ allowed: false, readOnly: false }); return; }
    supabase
      .from("prospection_members")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle()
      .then(({ data }) => { if (alive) setAccess({ allowed: !!data, readOnly: !!data?.lecture_seule }); });
    return () => { alive = false; };
  }, [userId]);
  return access;
}

const PROSPECTION_EDITABLE_FIELDS = ["societe", "secteur", "adresse", "code_postal", "commune", "lat", "lng", "contact", "fonction", "tel", "email", "flotte", ...PROSPECTION_CRITERE_COLS, "modele", "statut", "commercial", "relance", "notes", "client_existant"];
function prospectionCleanRow(p) {
  const row = {};
  for (const k of PROSPECTION_EDITABLE_FIELDS) {
    let v = p[k];
    if (k === "client_existant") { row[k] = !!v; continue; }
    if (k === "statut") { row[k] = prospectionStatutOf(typeof v === "string" ? v.trim() : v); continue; }
    if (typeof v === "string") v = v.trim();
    if (v === "" || v === undefined) v = null;
    if ((k === "flotte" || k === "renouvellement_mois") && v != null) v = parseInt(v, 10) || null;
    if ((k === "marques" || k === "energies") && v != null) v = prospectionListOf(v).join(", ") || null;
    if ((k === "relance" || k === "dernier_renouvellement" || k === "derniere_proposition") && v != null && !/^\d{4}-\d{2}-\d{2}$/.test(v)) {
      // import CSV : accepte aussi JJ/MM/AAAA
      const m = String(v).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      v = m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : null;
    }
    row[k] = v;
  }
  return row;
}
// Tant que sql/prospection-criteres.sql n'a pas été exécuté, la base ignore les 5 critères :
// on enregistre le reste de la fiche plutôt que de perdre la saisie.
function prospectionIsMissingCritereCol(err) {
  const m = `${err?.message || ""} ${err?.details || ""}`;
  return PROSPECTION_CRITERE_COLS.some((c) => m.includes(c)) && /column|schema cache/i.test(m);
}
function prospectionStripCriteres(row) {
  const r = { ...row };
  PROSPECTION_CRITERE_COLS.forEach((c) => delete r[c]);
  return r;
}

// Sur le terrain, le réseau peut couper un instant — on retente automatiquement avant d'abandonner,
// plutôt que de faire perdre sa saisie au commercial pour un simple aléa de connexion.
async function prospectionWithRetry(fn, attempts = 3) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, 700 * (i + 1)));
    }
  }
  throw lastErr;
}

function useProspection() {
  const [prospects, setProspects] = useState([]);
  const [actions, setActions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const timer = useRef(null);
  const lastSig = useRef("");

  const load = useCallback(async () => {
    const [p, a] = await Promise.all([
      supabase.from("prospects").select("*").order("updated_at", { ascending: false }),
      supabase.from("prospect_actions").select("*").order("created_at", { ascending: false }).limit(3000),
    ]);
    const err = p.error || a.error;
    if (err) { setError(err.message); setLoading(false); return; }
    // Détection de changement : on ne re-rend que si les données ont réellement bougé.
    const sig = `${p.data.length}:${p.data[0]?.updated_at}|${a.data.length}:${a.data[0]?.created_at}`;
    if (sig !== lastSig.current) {
      lastSig.current = sig;
      setProspects(p.data.map((x) => ({ ...x, statut: prospectionStatutOf(x.statut) })));
      setActions(a.data);
    }
    setError(null);
    setLoading(false);
  }, []);

  const scheduleLoad = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(load, 300);
  }, [load]);

  useEffect(() => {
    load();
    const ch = supabase
      .channel("prospection-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "prospects" }, scheduleLoad)
      .on("postgres_changes", { event: "*", schema: "public", table: "prospect_actions" }, scheduleLoad)
      .subscribe();
    return () => { clearTimeout(timer.current); supabase.removeChannel(ch); };
  }, [load, scheduleLoad]);

  const save = useCallback(async (p, previous) => {
    const row = prospectionCleanRow(p);
    const adresseChanged = !previous || ["adresse", "code_postal", "commune"].some((k) => (previous[k] || "") !== (row[k] || ""));
    if ((adresseChanged && !p._coordsFromSuggestion) || row.lat == null) {
      const g = await prospectionGeocode(row);
      row.lat = g?.lat ?? null;
      row.lng = g?.lng ?? null;
    }
    const send = (r) => prospectionWithRetry(() =>
      p.id ? supabase.from("prospects").update(r).eq("id", p.id).select().single() : supabase.from("prospects").insert(r).select().single()
    );
    let { data, error: err } = await send(row);
    let criteresIgnores = false;
    if (err && prospectionIsMissingCritereCol(err)) {
      ({ data, error: err } = await send(prospectionStripCriteres(row)));
      criteresIgnores = !err;
    }
    if (err) throw err;
    lastSig.current = "";
    await load();
    return criteresIgnores ? { ...data, _criteresIgnores: true } : data;
  }, [load]);

  const remove = useCallback(async (id) => {
    const { error: err } = await prospectionWithRetry(() => supabase.from("prospects").delete().eq("id", id));
    if (err) throw err;
    lastSig.current = "";
    await load();
  }, [load]);

  const addAction = useCallback(async (prospect_id, type, texte, par) => {
    const { error: err } = await prospectionWithRetry(() => supabase.from("prospect_actions").insert({ prospect_id, type, texte, par }));
    if (err) throw err;
    lastSig.current = "";
    await load();
  }, [load]);

  const patch = useCallback(async (id, fields) => {
    const { error: err } = await prospectionWithRetry(() => supabase.from("prospects").update(fields).eq("id", id));
    if (err) throw err;
    lastSig.current = "";
    await load();
  }, [load]);

  const geocodeMissing = useCallback(async (onProgress) => {
    const missing = prospects.filter((p) => p.lat == null && (p.adresse || p.commune));
    let ok = 0;
    for (let i = 0; i < missing.length; i++) {
      const g = await prospectionGeocode(missing[i]);
      if (g) { await supabase.from("prospects").update({ lat: g.lat, lng: g.lng }).eq("id", missing[i].id); ok++; }
      onProgress?.(i + 1, missing.length);
      await new Promise((r) => setTimeout(r, 60)); // reste sous la limite de 50 req/s de l'IGN
    }
    lastSig.current = "";
    await load();
    return { ok, total: missing.length };
  }, [prospects, load]);

  const bulkInsert = useCallback(async (rows, onProgress, extra) => {
    let done = 0;
    for (const r of rows) {
      const row = prospectionCleanRow({ ...r, ...extra });
      if (!row.societe) continue;
      const g = await prospectionGeocode(row);
      if (g) { row.lat = g.lat; row.lng = g.lng; }
      let { error: err } = await supabase.from("prospects").insert(row);
      if (err && prospectionIsMissingCritereCol(err)) ({ error: err } = await supabase.from("prospects").insert(prospectionStripCriteres(row)));
      if (err) throw err;
      onProgress?.(++done, rows.length);
      await new Promise((res) => setTimeout(res, 60));
    }
    lastSig.current = "";
    await load();
    return done;
  }, [load]);

  return { prospects, actions, loading, error, save, remove, addAction, patch, geocodeMissing, bulkInsert, reload: load };
}

function ProspectionAdresseInput({ dark, value, onPick, onChange }) {
  const [sugg, setSugg] = useState([]);
  const t = useRef(null);
  const inputCls = `w-full rounded-lg border px-3 py-2 text-sm outline-none transition-shadow focus:ring-2 ${dark ? "bg-zinc-950 border-zinc-800 text-zinc-200 focus:ring-blue-700/30" : "bg-white border-stone-200 text-stone-700 focus:ring-blue-700/20"}`;
  const change = (v) => {
    onChange(v);
    clearTimeout(t.current);
    t.current = setTimeout(async () => setSugg(await prospectionSuggestAdresses(v)), 300);
  };
  return (
    <div className="relative">
      <input
        className={inputCls}
        value={value || ""}
        onChange={(e) => change(e.target.value)}
        onBlur={() => setTimeout(() => setSugg([]), 150)}
        placeholder="Commencez à taper l'adresse…"
        autoComplete="off"
      />
      {sugg.length > 0 && (
        <ul className={`absolute z-20 mt-1 w-full overflow-hidden rounded-lg border shadow-lg ${dark ? "bg-zinc-900 border-zinc-800" : "bg-white border-stone-200"}`}>
          {sugg.map((s) => (
            <li key={s.label}>
              <button
                type="button"
                onMouseDown={() => { onPick(s); setSugg([]); }}
                className={`block w-full px-3 py-2 text-left text-sm ${dark ? "text-zinc-200 hover:bg-zinc-800" : "text-stone-800 hover:bg-stone-100"}`}
              >
                {s.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ProspectFiche({ dark, prospectId, prospects, actions, commerciaux, me, readOnly, newPrefill, onClose, onSave, onDelete, onAddAction, showToast }) {
  // Toujours relu en direct par identifiant (jamais une copie figée) — se remonte automatiquement
  // avec les mises à jour temps réel de useProspection tant que le popup reste ouvert.
  // Nouveau prospect : le commercial est celui du compte connecté (si c'est un des commerciaux B2B).
  const autoCommercial = prospectionCommercialFor(me);
  const prospect = prospectId === "new" ? { statut: "Prospect", commercial: autoCommercial, relance: prospectionAddDaysISO(PROSPECTION_RELANCE_DEFAUT_JOURS), ...newPrefill } : prospects.find((x) => x.id === prospectId);
  const isNew = prospectId === "new";
  const [p, setP] = useState(prospect);
  const [locating, setLocating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [logType, setLogType] = useState("Appel");
  const [logTxt, setLogTxt] = useState("");
  const set = (k) => (e) => setP((x) => ({ ...x, [k]: e.target.value }));

  useEffect(() => {
    function onKeyDown(e) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  // Position GPS -> adresse. En création, lancée automatiquement (silencieuse si refusée) ; le bouton « Ma position » la relance.
  const locate = useCallback(async (manual) => {
    setLocating(true);
    const pos = await prospectionGetPosition();
    if (!pos) {
      setLocating(false);
      if (manual) showToast("Position indisponible — autorisez la localisation ou saisissez l'adresse", { type: "error" });
      return;
    }
    const a = await prospectionReverseGeocode(pos.lat, pos.lng);
    setLocating(false);
    if (!a) { if (manual) showToast("Adresse introuvable pour cette position", { type: "error" }); return; }
    setP((x) => (!manual && (x.adresse || x.commune)
      ? x // l'utilisateur a déjà saisi/choisi une adresse entre-temps
      : { ...x, adresse: a.adresse, code_postal: a.code_postal, commune: a.commune, lat: pos.lat, lng: pos.lng, _coordsFromSuggestion: true }));
    if (manual) showToast("Adresse remplie selon votre position");
  }, [showToast]);
  useEffect(() => {
    if (prospectId !== "new") return;
    const pre = newPrefill || {};
    if (pre.adresse || pre.commune || pre.lat != null) return; // création depuis la carte / OSM : l'adresse vient déjà de là
    locate(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prospectId]);
  // Création depuis la carte : l'adresse / le nom du lieu arrivent après l'ouverture de la fiche (géocodage inverse).
  useEffect(() => {
    if (prospectId !== "new" || !newPrefill) return;
    setP((x) => {
      const next = { ...x };
      let changed = false;
      for (const [k, v] of Object.entries(newPrefill)) {
        if (v === undefined || v === "" || v === null) continue;
        if (k === "lat" || k === "lng" || k === "_coordsFromSuggestion") continue;
        if (!x[k]) { next[k] = v; changed = true; }
      }
      return changed ? next : x;
    });
  }, [prospectId, newPrefill]);

  if (!prospect) return null; // supprimé par quelqu'un d'autre pendant que le popup était ouvert

  const inputCls = `w-full rounded-lg border px-3 py-2 text-sm outline-none transition-shadow focus:ring-2 ${dark ? "bg-zinc-950 border-zinc-800 text-zinc-200 focus:ring-blue-700/30" : "bg-white border-stone-200 text-stone-700 focus:ring-blue-700/20"}`;
  const labelCls = `flex flex-col gap-1 text-[11px] font-semibold uppercase tracking-widest ${dark ? "text-zinc-500" : "text-stone-400"}`;
  const chipCls = (on) => `pl-interactive rounded-full border px-2.5 py-1 text-xs font-semibold normal-case tracking-normal transition-colors ${on ? "border-blue-700 bg-blue-700 text-white" : dark ? "border-zinc-700 text-zinc-300 hover:bg-zinc-800" : "border-stone-300 text-stone-600 hover:bg-stone-100"}`;
  const renewal = prospectionRenewalPlan(p);
  const fmtLong = (iso) => new Date(iso + "T00:00").toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });

  // Prospect : la date de relance vient de la périodicité de renouvellement si elle est renseignée (sinon, à définir).
  // Se recalcule quand la périodicité ou le dernier renouvellement change ; reste modifiable à la main ensuite.
  const withRenewalRelance = (x) => {
    const plan = x.statut === "Prospect" ? prospectionRenewalPlan(x) : null;
    return plan ? { ...x, relance: plan.rappel } : x;
  };
  const onStatutChange = (e) => {
    const s = e.target.value;
    setP((x) => {
      const y = { ...x, statut: s };
      if (s === "Prospect") {
        const z = withRenewalRelance(y);
        if (z !== y) return z;
        if (!y.relance || y.relance <= prospectionTodayISO()) y.relance = prospectionAddDaysISO(PROSPECTION_RELANCE_DEFAUT_JOURS);
      } else if (s === "Proposition envoyée") {
        // Proposition envoyée : on relance sous 72 h, et on date l'envoi.
        y.relance = prospectionAddDaysISO(PROSPECTION_PROPOSITION_RELANCE_JOURS);
        if (x.statut !== "Proposition envoyée") y.derniere_proposition = prospectionTodayISO();
      }
      return y;
    });
  };

  const save = async () => {
    if (!p.societe?.trim()) { showToast("Indiquez le nom de la société", { type: "error" }); return; }
    if (prospectionNeedsRelance(p.statut) && !p.relance) { showToast("Définissez une date de relance (ou renseignez la périodicité de renouvellement)", { type: "error" }); return; }
    if (p.statut === "Perdu" && !p.motif_perte) { showToast("Indiquez pourquoi ce prospect est perdu", { type: "error" }); return; }
    setSaving(true);
    try {
      const toSave = { ...p, ...(p.statut !== "Perdu" ? { motif_perte: null } : { relance: null }), ...(p.statut === "Proposition envoyée" && !p.derniere_proposition ? { derniere_proposition: prospectionTodayISO() } : {}) };
      const saved = await onSave(toSave, isNew ? null : prospect);
      if (saved?._criteresIgnores) showToast("Fiche enregistrée, mais les critères du parc ne le sont pas encore : le script SQL « prospection-criteres.sql » doit être exécuté", { type: "error" });
      else showToast(isNew ? "Prospect ajouté" : "Prospect enregistré");
      onClose();
    } catch (e) {
      showToast(`Enregistrement impossible — ${e.message}`, { type: "error" });
    } finally {
      setSaving(false);
    }
  };

  const addLog = async () => {
    if (isNew) { showToast("Enregistrez d'abord le prospect", { type: "error" }); return; }
    if (!logTxt.trim() && logType === "Autre") return;
    await onAddAction(prospect.id, logType, logTxt.trim(), me);
    setLogTxt("");
  };

  const doDelete = async () => {
    await onDelete(prospect.id);
    showToast("Prospect supprimé");
    onClose();
  };

  const toggleClientExistant = async () => {
    const next = !p.client_existant;
    try {
      await onSave({ ...p, client_existant: next }, prospect);
      setP((x) => ({ ...x, client_existant: next }));
      showToast(next ? "Marqué comme client existant" : "Remis en prospect");
    } catch (e) {
      showToast(`Impossible de changer le statut — ${e.message}`, { type: "error" });
    }
  };

  const hist = actions.filter((a) => a.prospect_id === prospect.id);

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" className={`pl-fade-in h-full w-full max-w-xl overflow-y-auto p-5 shadow-xl ${dark ? "bg-zinc-950" : "bg-stone-50"}`}>
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className={`text-xl font-bold ${dark ? "text-zinc-50" : "text-stone-900"}`}>{isNew ? "Nouveau prospect" : prospect.societe}</h2>
            {!isNew && p.client_existant && (
              <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${dark ? "bg-zinc-800 text-zinc-300" : "bg-stone-200 text-stone-600"}`}>
                Client existant
              </span>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {!isNew && (p.adresse || p.commune) && (
              <a
                href={prospectionMapsDirectionsUrl(p)}
                target="_blank"
                rel="noreferrer"
                className={`pl-interactive rounded-lg border px-3 py-1.5 text-sm font-semibold transition-colors ${dark ? "border-zinc-700 text-zinc-200 hover:bg-zinc-800" : "border-stone-300 text-stone-700 hover:bg-stone-100"}`}
              >
                Itinéraire
              </a>
            )}
            <button onClick={onClose} className={`rounded-lg p-1.5 transition-colors ${dark ? "text-zinc-400 hover:bg-zinc-800" : "text-stone-500 hover:bg-stone-100"}`}>
              <X size={16} />
            </button>
          </div>
        </div>

        <fieldset disabled={!!readOnly} className="m-0 min-w-0 border-0 p-0"><div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className={`${labelCls} sm:col-span-2`}>Société *<input className={inputCls} value={p.societe || ""} onChange={set("societe")} autoFocus={isNew} /></label>
          <label className={`${labelCls} sm:col-span-2`}>
            <span className="flex items-center justify-between">
              Adresse
              <button
                type="button"
                onClick={() => locate(true)}
                disabled={locating}
                className={`pl-interactive flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold normal-case tracking-normal transition-colors disabled:opacity-60 ${dark ? "border-zinc-700 text-zinc-300 hover:bg-zinc-800" : "border-stone-300 text-stone-600 hover:bg-stone-100"}`}
              >
                <MapPin size={12} /> {locating ? "Localisation…" : "Ma position"}
              </button>
            </span>
            <ProspectionAdresseInput
              dark={dark}
              value={p.adresse}
              onChange={(v) => setP((x) => ({ ...x, adresse: v, _coordsFromSuggestion: false }))}
              onPick={(s) => setP((x) => ({ ...x, adresse: s.adresse, code_postal: s.code_postal, commune: s.commune, lat: s.lat, lng: s.lng, _coordsFromSuggestion: true }))}
            />
          </label>
          <label className={labelCls}>Code postal<input className={inputCls} value={p.code_postal || ""} onChange={set("code_postal")} /></label>
          <label className={labelCls}>Commune<input className={inputCls} value={p.commune || ""} onChange={set("commune")} /></label>
          <label className={labelCls}>
            Secteur
            <input className={inputCls} list="prospection-secteurs" value={p.secteur || ""} onChange={set("secteur")} />
            <datalist id="prospection-secteurs">{PROSPECTION_SECTEURS.map((s) => <option key={s} value={s} />)}</datalist>
          </label>
          <label className={labelCls}>Contact<input className={inputCls} value={p.contact || ""} onChange={set("contact")} /></label>
          <label className={labelCls}>Fonction<input className={inputCls} value={p.fonction || ""} onChange={set("fonction")} /></label>
          <label className={labelCls}>Téléphone<input type="tel" className={inputCls} value={p.tel || ""} onChange={set("tel")} /></label>
          <label className={labelCls}>Email<input type="email" className={inputCls} value={p.email || ""} onChange={set("email")} /></label>
          <label className={labelCls}>
            Modèle visé
            <input className={inputCls} list="prospection-modeles" value={p.modele || ""} onChange={set("modele")} />
            <datalist id="prospection-modeles">{PROSPECTION_MODELES.map((s) => <option key={s} value={s} />)}</datalist>
          </label>
          <section data-testid="prospect-criteres" className={`rounded-xl border p-3.5 sm:col-span-2 ${dark ? "border-zinc-800 bg-zinc-900/60" : "border-stone-200 bg-white"}`}>
            <h3 className={`mb-3 text-[11px] font-bold uppercase tracking-widest ${dark ? "text-zinc-400" : "text-stone-500"}`}>Qualification du parc (5 critères)</h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className={labelCls}>1 · Taille du parc (véhicules)<input type="number" min="0" className={inputCls} value={p.flotte ?? ""} onChange={set("flotte")} /></label>
              <label className={labelCls}>
                4 · Décideur
                <div className="flex gap-1.5">
                  <input className={inputCls} value={p.decideur || ""} onChange={set("decideur")} placeholder="Nom et fonction du décideur" />
                  {p.contact && !p.decideur && (
                    <button type="button" onClick={() => setP((x) => ({ ...x, decideur: [x.contact, x.fonction].filter(Boolean).join(", ") }))} className={`pl-interactive shrink-0 rounded-lg border px-2 text-[11px] font-semibold normal-case tracking-normal ${dark ? "border-zinc-700 text-zinc-300 hover:bg-zinc-800" : "border-stone-300 text-stone-600 hover:bg-stone-100"}`}>
                      = Contact
                    </button>
                  )}
                </div>
              </label>
              <div className={`${labelCls} sm:col-span-2`}>
                2 · Marques du parc
                <div className="flex flex-wrap gap-1.5">
                  {[...PROSPECTION_MARQUES, ...prospectionListOf(p.marques).filter((m) => !PROSPECTION_MARQUES.some((x) => prospectionNorm(x) === prospectionNorm(m)))].map((m) => (
                    <button key={m} type="button" aria-pressed={prospectionListOf(p.marques).some((x) => prospectionNorm(x) === prospectionNorm(m))} onClick={() => setP((x) => ({ ...x, marques: prospectionToggleInList(x.marques, m) }))} className={chipCls(prospectionListOf(p.marques).some((x) => prospectionNorm(x) === prospectionNorm(m)))}>{m}</button>
                  ))}
                  <input
                    placeholder="+ Autre marque"
                    className={`w-32 rounded-full border px-2.5 py-1 text-xs font-normal normal-case tracking-normal outline-none ${dark ? "border-zinc-700 bg-zinc-950 text-zinc-200" : "border-stone-300 bg-white text-stone-700"}`}
                    onKeyDown={(e) => {
                      if (e.key !== "Enter") return;
                      e.preventDefault();
                      const v = e.currentTarget.value.trim();
                      if (v) { setP((x) => (prospectionListOf(x.marques).some((y) => prospectionNorm(y) === prospectionNorm(v)) ? x : { ...x, marques: prospectionToggleInList(x.marques, v) })); e.currentTarget.value = ""; }
                    }}
                  />
                </div>
              </div>
              <div className={`${labelCls} sm:col-span-2`}>
                3 · Énergie du parc
                <div className="flex flex-wrap gap-1.5">
                  {PROSPECTION_ENERGIES.map((en) => {
                    const on = prospectionListOf(p.energies).some((x) => prospectionNorm(x) === prospectionNorm(en));
                    return <button key={en} type="button" aria-pressed={on} onClick={() => setP((x) => ({ ...x, energies: prospectionToggleInList(x.energies, en) }))} className={chipCls(on)}>{en}</button>;
                  })}
                </div>
              </div>
              <label className={labelCls}>
                5 · Périodicité de renouvellement
                <select className={inputCls} value={p.renouvellement_mois ?? ""} onChange={(e) => setP((x) => withRenewalRelance({ ...x, renouvellement_mois: e.target.value ? parseInt(e.target.value, 10) : "" }))}>
                  <option value="">Non renseignée</option>
                  {PROSPECTION_PERIODICITES.map(([m, l]) => <option key={m} value={m}>{l}</option>)}
                  {p.renouvellement_mois && !PROSPECTION_PERIODICITES.some(([m]) => m === Number(p.renouvellement_mois)) && <option value={p.renouvellement_mois}>Tous les {p.renouvellement_mois} mois</option>}
                </select>
              </label>
              <label className={labelCls}>
                Dernier renouvellement (si connu)
                <input type="date" className={inputCls} value={p.dernier_renouvellement || ""} onChange={(e) => setP((x) => withRenewalRelance({ ...x, dernier_renouvellement: e.target.value }))} />
              </label>
              <p data-testid="relance-info" className={`text-xs sm:col-span-2 ${dark ? "text-zinc-400" : "text-stone-500"}`}>
                {renewal
                  ? <>Date de relance calculée d'après la périodicité : <strong>{fmtLong(renewal.rappel)}</strong>{renewal.known ? ` (renouvellement estimé en ${new Date(renewal.next + "T00:00").toLocaleDateString("fr-FR", { month: "long", year: "numeric" })}, rappel ${PROSPECTION_RAPPEL_AVANCE_MOIS} mois avant)` : ` (dans ${renewal.months} mois)`}.</>
                  : "Sans périodicité de renouvellement, définissez vous-même la date de relance ci-dessous."}
              </p>
            </div>
          </section>
          <label className={labelCls}>
            Statut
            <select className={inputCls} value={p.statut} onChange={onStatutChange}>{PROSPECTION_STATUTS.map((s) => <option key={s}>{s}</option>)}</select>
          </label>
          <label className={labelCls}>
            Commercial
            <select className={inputCls} value={p.commercial || ""} onChange={set("commercial")}>
              <option value="">Non attribué</option>
              {commerciaux.map((n) => <option key={n}>{n}</option>)}
            </select>
          </label>
          {p.statut === "Perdu" ? (
            <label className={`${labelCls} sm:col-span-2`}>
              Motif de la perte *
              <select data-testid="motif-perte" className={inputCls} value={p.motif_perte || ""} onChange={set("motif_perte")}>
                <option value="">Choisir un motif…</option>
                {PROSPECTION_MOTIFS_PERTE.map((m) => <option key={m}>{m}</option>)}
              </select>
            </label>
          ) : prospectionNeedsRelance(p.statut) ? (
            <label className={labelCls}>
              Date de relance *
              <input type="date" data-testid="relance" className={inputCls} value={p.relance || ""} min={isNew ? prospectionTodayISO() : undefined} onChange={set("relance")} />
            </label>
          ) : null}
          {p.statut === "Proposition envoyée" && (
            <label className={labelCls}>
              Dernière proposition envoyée le
              <input type="date" data-testid="derniere-proposition" className={inputCls} value={p.derniere_proposition || ""} onChange={set("derniere_proposition")} />
            </label>
          )}
          <label className={`${labelCls} sm:col-span-2`}>Notes<textarea rows={3} className={inputCls} value={p.notes || ""} onChange={set("notes")} /></label>
        </div></fieldset>

        {!isNew && (
          <section className={`mt-5 rounded-xl border p-4 ${dark ? "bg-zinc-900/60 border-zinc-800" : "bg-white border-stone-200"}`}>
            <h3 className={`mb-3 text-[11px] font-bold uppercase tracking-widest ${dark ? "text-zinc-400" : "text-stone-500"}`}>Historique des actions</h3>
            {!readOnly && <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-[120px_1fr_auto]">
              <select className={inputCls} value={logType} onChange={(e) => setLogType(e.target.value)}>{PROSPECTION_TYPES_ACTION.map((t) => <option key={t}>{t}</option>)}</select>
              <input
                className={inputCls}
                value={logTxt}
                onChange={(e) => setLogTxt(e.target.value)}
                placeholder="Ex. messagerie, rappeler jeudi…"
                onKeyDown={(e) => e.key === "Enter" && addLog()}
              />
              <button onClick={addLog} className={`pl-interactive rounded-lg border px-3 py-2 text-sm font-semibold transition-colors ${dark ? "border-zinc-700 text-zinc-200 hover:bg-zinc-800" : "border-stone-300 text-stone-700 hover:bg-stone-100"}`}>
                Ajouter
              </button>
            </div>}
            {hist.length === 0 ? (
              <p className={`text-sm ${dark ? "text-zinc-500" : "text-stone-400"}`}>Aucune action enregistrée.</p>
            ) : (
              <ul className={`divide-y ${dark ? "divide-zinc-800" : "divide-stone-100"}`}>
                {hist.map((a) => (
                  <li key={a.id} className="py-2 text-sm">
                    <span className={`font-semibold ${dark ? "text-zinc-100" : "text-stone-800"}`}>{a.type}</span> <span className={dark ? "text-zinc-300" : "text-stone-700"}>{a.texte}</span>
                    <div className={`text-xs ${dark ? "text-zinc-600" : "text-stone-400"}`}>{new Date(a.created_at).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })} · {a.par}</div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        <div className="mt-5 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            {!isNew && !readOnly && (
              <button
                onClick={() => (deleteConfirm ? doDelete() : setDeleteConfirm(true))}
                onBlur={() => setDeleteConfirm(false)}
                className={`rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${deleteConfirm ? "text-rose-500" : dark ? "text-rose-400 hover:bg-rose-500/10" : "text-rose-600 hover:bg-rose-50"}`}
              >
                {deleteConfirm ? "Confirmer la suppression" : "Supprimer"}
              </button>
            )}
            {!isNew && !readOnly && (
              <button
                onClick={toggleClientExistant}
                className={`rounded-lg border px-3 py-2 text-sm font-semibold transition-colors ${dark ? "border-zinc-700 text-zinc-300 hover:bg-zinc-800" : "border-stone-300 text-stone-600 hover:bg-stone-100"}`}
              >
                {p.client_existant ? "Remettre en prospect" : "Marquer comme client existant"}
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button onClick={onClose} className={`rounded-lg border px-4 py-2 text-sm font-semibold transition-colors ${dark ? "border-zinc-700 text-zinc-200 hover:bg-zinc-800" : "border-stone-300 text-stone-700 hover:bg-stone-100"}`}>
              {readOnly ? "Fermer" : "Annuler"}
            </button>
            {!readOnly && (
              <button onClick={save} disabled={saving} className="pl-interactive rounded-lg bg-blue-700 px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-blue-500 disabled:opacity-60">
                {saving ? "Enregistrement…" : "Enregistrer"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function prospectionMarkerIcon(color, { late, selected } = {}) {
  const size = selected ? 34 : late ? 30 : 26;
  const border = late ? "#B91C1C" : "#ffffff";
  const html = `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${color};border:3px solid ${border};box-shadow:0 1px 4px rgba(0,0,0,0.45);"></div>`;
  return L.divIcon({ html, className: "", iconSize: [size, size], iconAnchor: [size / 2, size / 2], popupAnchor: [0, -size / 2 - 2] });
}

function prospectionClientIcon({ selected } = {}) {
  const size = selected ? 15 : 11;
  const html = `<div style="width:${size}px;height:${size}px;background:${PROSPECTION_CLIENT_COLOR};border:1.5px solid #ffffff;box-shadow:0 1px 2px rgba(0,0,0,0.3);transform:rotate(45deg);"></div>`;
  return L.divIcon({ html, className: "", iconSize: [size, size], iconAnchor: [size / 2, size / 2], popupAnchor: [0, -size / 2 - 4] });
}

function prospectionOsmIcon({ selected } = {}) {
  const size = selected ? 16 : 12;
  const html = `<div style="width:${size}px;height:${size}px;border-radius:50%;background:#ffffff;border:2px solid #94a3b8;box-shadow:0 1px 3px rgba(0,0,0,0.35);"></div>`;
  return L.divIcon({ html, className: "", iconSize: [size, size], iconAnchor: [size / 2, size / 2], popupAnchor: [0, -size / 2 - 2] });
}

const PROSPECTION_ZONE_COLOR = "#78350F";
function prospectionZoneIcon() {
  const html = `<div style="width:16px;height:16px;background:${PROSPECTION_ZONE_COLOR};border:2px solid #ffffff;box-shadow:0 1px 3px rgba(0,0,0,0.4);"></div>`;
  return L.divIcon({ html, className: "", iconSize: [16, 16], iconAnchor: [8, 8], popupAnchor: [0, -10] });
}

function prospectionZonePopupHtml(z) {
  return [
    `<div style="min-width:170px;font-size:13px;line-height:1.45;color:#292524;">`,
    `<span style="display:inline-block;margin-bottom:2px;border-radius:9999px;background:#fde68a;color:#78350f;font-size:10px;font-weight:700;padding:1px 6px;">${prospectionEscapeHtml(z.type.toUpperCase())}</span><br/>`,
    `<b>${prospectionEscapeHtml(z.nom)}</b>`,
    `</div>`,
  ].join("");
}

function prospectionOsmPopupHtml(place) {
  return [
    `<div style="min-width:190px;font-size:13px;line-height:1.45;color:#292524;">`,
    `<span style="display:inline-block;margin-bottom:2px;border-radius:9999px;background:#e2e8f0;color:#475569;font-size:10px;font-weight:700;padding:1px 6px;">OPENSTREETMAP</span><br/>`,
    `<b>${prospectionEscapeHtml(place.societe)}</b>`,
    place.secteur ? `<div style="color:#78716c;">${prospectionEscapeHtml(place.secteur)}</div>` : "",
    `<div style="color:#78716c;">${prospectionEscapeHtml([place.adresse, place.commune].filter(Boolean).join(", "))}</div>`,
    `<div style="margin-top:8px;">`,
    `<button data-action="add" style="background:#1d4ed8;color:#fff;border:none;border-radius:4px;padding:4px 8px;font:inherit;cursor:pointer;">Ajouter comme prospect</button>`,
    `</div></div>`,
  ].join("");
}

function prospectionEscapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function prospectionPopupHtml(p) {
  const late = prospectionRelanceState(p) === "late";
  const lines = [
    `<div style="min-width:200px;font-size:13px;line-height:1.45;color:#292524;">`,
    p.client_existant ? `<span style="display:inline-block;margin-bottom:2px;border-radius:9999px;background:#e2e8f0;color:#334155;font-size:10px;font-weight:700;padding:1px 6px;">CLIENT EXISTANT</span><br/>` : "",
    `<b>${prospectionEscapeHtml(p.societe)}</b>`,
    `<div>${prospectionEscapeHtml([p.contact, p.tel].filter(Boolean).join(" · "))}</div>`,
    `<div style="color:#78716c;">${prospectionEscapeHtml([p.adresse, p.commune].filter(Boolean).join(", "))}</div>`,
    p.client_existant ? "" : `<div style="margin-top:4px;">${prospectionEscapeHtml(p.statut)}${p.commercial ? " · " + prospectionEscapeHtml(p.commercial) : ""}</div>`,
    !p.client_existant && p.relance ? `<div style="${late ? "color:#be123c;" : ""}">Relance : ${prospectionEscapeHtml(prospectionFrDate(p.relance))}</div>` : "",
    `<div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap;">`,
    `<button data-action="open" style="background:#1d4ed8;color:#fff;border:none;border-radius:4px;padding:4px 8px;font:inherit;cursor:pointer;">Ouvrir la fiche</button>`,
    p.client_existant ? "" : `<button data-action="visit" style="background:#059669;color:#fff;border:none;border-radius:4px;padding:4px 8px;font:inherit;cursor:pointer;">J'ai visité</button>`,
    `<a href="${prospectionMapsDirectionsUrl(p)}" target="_blank" rel="noreferrer" style="border:1px solid #d6d3d1;border-radius:4px;padding:4px 8px;color:#292524;text-decoration:none;">Itinéraire</a>`,
    `</div></div>`,
  ];
  return lines.join("");
}

function prospectionClusterPoints(map, points, cellPx) {
  const cells = new Map();
  points.forEach((p) => {
    const pt = map.latLngToContainerPoint([p.lat, p.lng]);
    const key = `${Math.round(pt.x / cellPx)}:${Math.round(pt.y / cellPx)}`;
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(p);
  });
  return [...cells.values()].map((items) => ({
    lat: items.reduce((s, p) => s + p.lat, 0) / items.length,
    lng: items.reduce((s, p) => s + p.lng, 0) / items.length,
    items,
    // La clé encode la composition du groupe : elle change automatiquement dès qu'un point rejoint
    // ou quitte un groupe (zoom, filtre…), ce qui force la recréation propre du marqueur concerné.
    key: items.length === 1 ? items[0].id : `cluster:${items.map((p) => p.id).sort().join(",")}`,
  }));
}

function prospectionClusterIcon(count, { color, diamond } = {}) {
  // Les regroupements "clients existants" (diamond) restent volontairement plus petits et
  // plus discrets que ceux des prospects, pour ne jamais dominer visuellement la carte.
  const size = diamond
    ? Math.round(Math.min(20 + Math.sqrt(count) * 4, 38))
    : Math.round(Math.min(30 + Math.sqrt(count) * 6, 56));
  const shapeStyle = diamond ? "transform:rotate(45deg);" : "border-radius:50%;";
  const textStyle = diamond ? "transform:rotate(-45deg);" : "";
  const border = diamond ? "1.5px solid #ffffff" : "3px solid #ffffff";
  const fontSize = diamond ? 10 : 12;
  return L.divIcon({
    html: `<div style="width:${size}px;height:${size}px;background:${color};border:${border};box-shadow:0 1px 3px rgba(0,0,0,0.3);${shapeStyle}display:flex;align-items:center;justify-content:center;"><span style="${textStyle}color:#fff;font-weight:700;font-size:${fontSize}px;">${count}</span></div>`,
    className: "",
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

// Popup d'un regroupement : liste chaque fiche avec le même contenu/boutons que son popup individuel
// (buildPopup), pour rester utilisable même quand le zoom ne peut plus séparer visuellement les points
// (adresses identiques ou géocodées au même centre de commune — le zoom seul ne les sépare jamais).
function prospectionClusterPopupHtml(items, buildPopup) {
  const parts = items.map(
    (item, i) =>
      `<div data-item-idx="${i}" style="${i > 0 ? "margin-top:8px;padding-top:8px;border-top:1px solid #e7e5e4;" : ""}">${buildPopup(item)}</div>`
  );
  return `<div style="max-height:280px;overflow-y:auto;">${parts.join("")}</div>`;
}

// Câble les boutons d'action d'un popup une seule fois, par délégation sur son conteneur (qui reste
// le même nœud DOM tant que le popup est ouvert). Contrairement à un branchement bouton par bouton,
// ça survit à un rafraîchissement du contenu du popup (setPopupContent) pendant qu'il est ouvert —
// par ex. quand le polling temps réel resynchronise la carte pendant que l'utilisateur regarde une
// fiche : sans ça, les boutons redeviennent silencieusement inertes après le premier rafraîchissement.
function prospectionWirePopupActions(marker, onPopupAction) {
  marker.on("popupopen", (e) => {
    const root = e.popup.getElement();
    if (!root || root._prospectionWired) return;
    root._prospectionWired = true;
    root.addEventListener("click", (ev) => {
      const btn = ev.target.closest("[data-action]");
      if (!btn) return;
      const wrap = ev.target.closest("[data-item-idx]");
      const item = wrap ? marker._prospectionItems?.[Number(wrap.getAttribute("data-item-idx"))] : marker._prospectionItem;
      if (item) onPopupAction(item, btn.getAttribute("data-action"));
    });
  });
}

function prospectionSyncClusterLayer(map, markersRef, clusters, { buildIcon, buildPopup, onSingleClick, onPopupAction, buildClusterIcon }) {
  const seen = new Set();
  clusters.forEach((c) => {
    seen.add(c.key);
    const isCluster = c.items.length > 1;
    const icon = isCluster ? buildClusterIcon(c.items.length) : buildIcon(c.items[0]);
    let marker = markersRef.current.get(c.key);
    if (!marker) {
      marker = L.marker([c.lat, c.lng], { icon }).addTo(map);
      marker._prospectionItem = c.items[0];
      marker._prospectionItems = c.items;
      if (isCluster) {
        // Zoomer rapproche les points, mais deux fiches à la même adresse (ou géocodées au centre
        // de la même commune) restent confondues même au zoom maximum : dans ce cas, ou une fois
        // le zoom maximum atteint, on ouvre directement la liste des fiches du groupe.
        marker.on("click", () => {
          const targetZoom = Math.min(map.getZoom() + 2, map.getMaxZoom());
          if (targetZoom <= map.getZoom()) marker.openPopup();
          else map.setView([c.lat, c.lng], targetZoom);
        });
        marker.bindPopup(prospectionClusterPopupHtml(marker._prospectionItems, buildPopup));
        if (onPopupAction) prospectionWirePopupActions(marker, onPopupAction);
      } else {
        marker.on("click", () => onSingleClick(c.items[0]));
        marker.bindPopup(buildPopup(c.items[0]));
        marker.bindTooltip(prospectionEscapeHtml(c.items[0].societe || c.items[0].nom), { permanent: true, direction: "right", offset: [10, 0], className: "prospection-label", opacity: 1 });
        // Les boutons d'action sont reliés une seule fois par délégation (voir prospectionWirePopupActions) :
        // ils lisent toujours l'item courant sur le marqueur, jamais une valeur figée à la création.
        if (onPopupAction) prospectionWirePopupActions(marker, onPopupAction);
      }
      markersRef.current.set(c.key, marker);
    } else {
      marker._prospectionItem = c.items[0];
      marker._prospectionItems = c.items;
      marker.setLatLng([c.lat, c.lng]);
      marker.setIcon(icon);
      if (!isCluster) {
        marker.setPopupContent(buildPopup(c.items[0]));
        if (marker.getTooltip()) marker.setTooltipContent(prospectionEscapeHtml(c.items[0].societe || c.items[0].nom));
        else marker.bindTooltip(prospectionEscapeHtml(c.items[0].societe || c.items[0].nom), { permanent: true, direction: "right", offset: [10, 0], className: "prospection-label", opacity: 1 });
      } else {
        marker.setPopupContent(prospectionClusterPopupHtml(marker._prospectionItems, buildPopup));
        if (marker.getTooltip()) marker.unbindTooltip();
      }
    }
  });
  markersRef.current.forEach((marker, key) => {
    if (!seen.has(key)) { map.removeLayer(marker); markersRef.current.delete(key); }
  });
}

function ProspectMap({ dark, prospects, clients, commerciaux, onOpen, onAddFromOsm, onQuickVisit, onCreateAtLocation, onGeocodeMissing, showToast }) {
  const [colorBy, setColorBy] = useState("statut");
  const [selectedId, setSelectedId] = useState(null);
  const [hideClosed, setHideClosed] = useState(true);
  const [showClients, setShowClients] = useState(true);
  const [mapZoom, setMapZoom] = useState(11);
  const [showOsm, setShowOsm] = useState(true);
  const [showTeamZones, setShowTeamZones] = useState(true);
  const [industrialZones, setIndustrialZones] = useState([]);
  const [zonesLoading, setZonesLoading] = useState(false);
  const [showIndustrialZones, setShowIndustrialZones] = useState(true);
  const [busy, setBusy] = useState("");
  const [mapFiltersOpen, setMapFiltersOpen] = useState(false);
  const [zoomTick, setZoomTick] = useState(0);
  const [osmPlaces, setOsmPlaces] = useState([]);
  const [osmLoading, setOsmLoading] = useState(false);
  const [zoomTooFar, setZoomTooFar] = useState(true);
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef(new Map());
  const clientMarkersRef = useRef(new Map());
  const osmMarkersRef = useRef(new Map());
  const zoneMarkersRef = useRef(new Map());
  const osmFetchTimer = useRef(null);
  const osmAbortRef = useRef(null);
  const myLocationMarkerRef = useRef(null);
  const onCreateAtLocationRef = useRef(onCreateAtLocation);
  onCreateAtLocationRef.current = onCreateAtLocation;

  const colorOfCommercial = useMemo(() => {
    const m = {};
    const usedPerTeam = {};
    commerciaux.forEach((n) => {
      const team = PROSPECTION_TEAMS[n];
      if (team && PROSPECTION_TEAM_COLORS[team]) {
        const already = usedPerTeam[team] || 0;
        m[n] = already === 0 ? PROSPECTION_TEAM_COLORS[team].main : PROSPECTION_TEAM_COLORS[team].light;
        usedPerTeam[team] = already + 1;
      }
    });
    let i = 0;
    commerciaux.forEach((n) => {
      if (!m[n]) m[n] = PROSPECTION_COMMERCIAL_COLORS[i++ % PROSPECTION_COMMERCIAL_COLORS.length];
    });
    return m;
  }, [commerciaux]);

  const visible = prospects.filter((p) => !hideClosed || (p.statut !== "Gagné" && p.statut !== "Perdu"));
  const placed = visible.filter((p) => p.lat != null && p.lng != null);
  const missing = prospects.filter((p) => p.lat == null);
  const clientTooFar = mapZoom < PROSPECTION_CLIENT_MIN_ZOOM;
  const clientsPlaced = showClients && !clientTooFar ? clients.filter((p) => p.lat != null && p.lng != null) : [];

  const colorFor = (p) => (colorBy === "statut" ? PROSPECTION_STATUT_COLORS[p.statut] : colorOfCommercial[p.commercial] || "#6B7280");
  const legend = colorBy === "statut" ? PROSPECTION_STATUTS.map((s) => [s, PROSPECTION_STATUT_COLORS[s]]) : commerciaux.map((n) => [n, colorOfCommercial[n]]);

  // Crée la carte Leaflet une seule fois (pas de wrapper React — évite tout risque de double instance de React).
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, { scrollWheelZoom: true }).setView([PROSPECTION_CAEN_CENTER.lat, PROSPECTION_CAEN_CENTER.lng], 11);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,
    }).addTo(map);
    map.on("click", () => setSelectedId(null));
    map.on("contextmenu", (e) => {
      L.DomEvent.preventDefault(e.originalEvent);
      onCreateAtLocationRef.current(e.latlng);
    });
    map.on("zoomend", () => { setZoomTick((t) => t + 1); setMapZoom(map.getZoom()); });
    const fetchNearby = () => {
      const zoom = map.getZoom();
      if (zoom < PROSPECTION_OSM_MIN_ZOOM) {
        setZoomTooFar(true);
        setOsmPlaces([]);
        return;
      }
      setZoomTooFar(false);
      clearTimeout(osmFetchTimer.current);
      osmFetchTimer.current = setTimeout(async () => {
        osmAbortRef.current?.abort();
        const controller = new AbortController();
        osmAbortRef.current = controller;
        setOsmLoading(true);
        const places = await prospectionSearchNearbyBusinesses(map.getBounds(), controller.signal);
        if (controller.signal.aborted) return; // une recherche plus récente a déjà pris le relais
        setOsmPlaces(places);
        setOsmLoading(false);
      }, 400);
    };
    map.on("moveend", fetchNearby);
    mapRef.current = map;
    // Le conteneur peut ne pas encore avoir sa taille finale au tout premier rendu (Tailwind CDN
    // applique ses classes juste après) : on force un recalcul juste après.
    setTimeout(() => map.invalidateSize(), 100);
    setTimeout(() => map.invalidateSize(), 400);
    return () => { map.remove(); mapRef.current = null; markersRef.current.clear(); clientMarkersRef.current.clear(); osmMarkersRef.current.clear(); clearTimeout(osmFetchTimer.current); osmAbortRef.current?.abort(); };
  }, []);

  // Synchronise les marqueurs des prospects visibles (regroupés visuellement quand ils sont proches).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const clusters = prospectionClusterPoints(map, placed, 52);
    prospectionSyncClusterLayer(map, markersRef, clusters, {
      buildIcon: (p) => prospectionMarkerIcon(colorFor(p), { late: prospectionRelanceState(p) === "late", selected: p.id === selectedId }),
      buildPopup: prospectionPopupHtml,
      onSingleClick: (p) => setSelectedId(p.id),
      onPopupAction: (p, action) => (action === "visit" ? onQuickVisit(p) : onOpen(p.id)),
      buildClusterIcon: (n) => prospectionClusterIcon(n, { color: "#1D4ED8" }),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placed, colorBy, selectedId, colorOfCommercial, zoomTick]);

  // Synchronise les marqueurs des clients existants (calque séparé, jamais lié aux statuts du pipeline).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    // Regroupement un peu plus large que celui des prospects (52px) : les clients existants restent
    // une couche secondaire. Le vrai garde-fou contre la saturation est le masquage sous le zoom
    // minimal (PROSPECTION_CLIENT_MIN_ZOOM) ; ce clustering ne sert qu'aux secteurs très denses.
    const clusters = prospectionClusterPoints(map, clientsPlaced, 60);
    prospectionSyncClusterLayer(map, clientMarkersRef, clusters, {
      buildIcon: (p) => prospectionClientIcon({ selected: p.id === selectedId }),
      buildPopup: prospectionPopupHtml,
      onSingleClick: (p) => setSelectedId(p.id),
      onPopupAction: (p) => onOpen(p.id),
      buildClusterIcon: (n) => prospectionClusterIcon(n, { color: PROSPECTION_CLIENT_COLOR, diamond: true }),
    });
  }, [clientsPlaced, selectedId, zoomTick]);

  // Trace la ligne de partage nord/sud entre les deux binômes, avec une zone teintée de chaque côté.
  const teamZoneLayerRef = useRef(null);
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (teamZoneLayerRef.current) { map.removeLayer(teamZoneLayerRef.current); teamZoneLayerRef.current = null; }
    if (!showTeamZones) return;
    const lat = PROSPECTION_TEAM_ZONE_LAT;
    const span = 0.35;
    const west = PROSPECTION_CAEN_CENTER.lng - span;
    const east = PROSPECTION_CAEN_CENTER.lng + span;
    const group = L.layerGroup();
    L.rectangle([[lat, west], [lat + span, east]], { color: "transparent", fillColor: PROSPECTION_TEAM_COLORS.B.main, fillOpacity: 0.05, interactive: false }).addTo(group);
    L.rectangle([[lat - span, west], [lat, east]], { color: "transparent", fillColor: PROSPECTION_TEAM_COLORS.A.main, fillOpacity: 0.05, interactive: false }).addTo(group);
    L.polyline([[lat, west], [lat, east]], { color: dark ? "#71717a" : "#a8a29e", weight: 2, dashArray: "6 6", interactive: false }).addTo(group);
    const labelIcon = (text, color) =>
      L.divIcon({ html: `<div style="background:${color};color:#fff;border-radius:6px;padding:2px 8px;font-size:11px;font-weight:700;white-space:nowrap;box-shadow:0 1px 3px rgba(0,0,0,0.3);">${text}</div>`, className: "", iconSize: [0, 0] });
    L.marker([lat + span * 0.5, PROSPECTION_CAEN_CENTER.lng], { icon: labelIcon("Équipe B — Tom & Julia", PROSPECTION_TEAM_COLORS.B.main), interactive: false }).addTo(group);
    L.marker([lat - span * 0.5, PROSPECTION_CAEN_CENTER.lng], { icon: labelIcon("Équipe A — Anthony & Thao", PROSPECTION_TEAM_COLORS.A.main), interactive: false }).addTo(group);
    group.addTo(map);
    teamZoneLayerRef.current = group;
  }, [showTeamZones, dark]);

  // Synchronise le calque de découverte OpenStreetMap (entreprises pas encore dans Prospection).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!showOsm) {
      osmMarkersRef.current.forEach((marker) => map.removeLayer(marker));
      osmMarkersRef.current.clear();
      return;
    }
    const clusters = prospectionClusterPoints(map, osmPlaces.map((p) => ({ ...p, id: p.osmId })), 36);
    prospectionSyncClusterLayer(map, osmMarkersRef, clusters, {
      buildIcon: (p) => prospectionOsmIcon({ selected: false }),
      buildPopup: prospectionOsmPopupHtml,
      onSingleClick: () => {},
      onPopupAction: (p) => onAddFromOsm(p),
      buildClusterIcon: (n) => prospectionClusterIcon(n, { color: "#94a3b8" }),
    });
  }, [osmPlaces, showOsm]);

  // Synchronise le calque des zones d'activité (ZA/ZI), alimenté par une recherche ponctuelle
  // sur un large rayon (bouton dédié), pas par le déplacement de la carte.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!showIndustrialZones) {
      zoneMarkersRef.current.forEach((marker) => map.removeLayer(marker));
      zoneMarkersRef.current.clear();
      return;
    }
    const clusters = prospectionClusterPoints(map, industrialZones.map((z) => ({ ...z, id: z.zoneId })), 40);
    prospectionSyncClusterLayer(map, zoneMarkersRef, clusters, {
      buildIcon: () => prospectionZoneIcon(),
      buildPopup: prospectionZonePopupHtml,
      onSingleClick: () => {},
      buildClusterIcon: (n) => prospectionClusterIcon(n, { color: PROSPECTION_ZONE_COLOR }),
    });
  }, [industrialZones, showIndustrialZones, zoomTick]);

  const locateMe = () => {
    if (!navigator.geolocation) { showToast("Localisation non disponible sur cet appareil", { type: "error" }); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        mapRef.current?.setView([latitude, longitude], 16);
        if (myLocationMarkerRef.current) mapRef.current.removeLayer(myLocationMarkerRef.current);
        myLocationMarkerRef.current = L.circleMarker([latitude, longitude], { radius: 8, color: "#fff", weight: 3, fillColor: "#2563eb", fillOpacity: 1 }).addTo(mapRef.current);
      },
      () => showToast("Position indisponible — vérifiez que la localisation est autorisée", { type: "error" }),
      { enableHighAccuracy: true, timeout: 8000 }
    );
  };

  const searchIndustrialZones = async () => {
    setZonesLoading(true);
    const zones = await prospectionSearchIndustrialZones(PROSPECTION_CAEN_CENTER, 50);
    setIndustrialZones(zones);
    setShowIndustrialZones(true);
    setZonesLoading(false);
    if (zones.length > 0 && mapRef.current) {
      mapRef.current.fitBounds(zones.map((z) => [z.lat, z.lng]), { padding: [30, 30], maxZoom: 12 });
    }
    showToast(`${zones.length} zone(s) d'activité identifiée(s) dans un rayon de 50 km`);
  };

  const runGeocode = async () => {
    setBusy("0");
    const res = await onGeocodeMissing((i, n) => setBusy(`${i}/${n}`));
    setBusy("");
    showToast(`${res.ok} prospect(s) localisé(s) sur ${res.total}`);
  };

  const chipCls = (active) =>
    `px-3 py-1.5 text-sm font-medium ${active ? "bg-blue-700 text-white" : dark ? "bg-zinc-900 text-zinc-300" : "bg-white text-stone-700"}`;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <button
          onClick={locateMe}
          className={`pl-interactive flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-semibold transition-colors ${dark ? "border-zinc-700 text-zinc-200 hover:bg-zinc-800" : "border-stone-300 text-stone-700 hover:bg-stone-100"}`}
        >
          <Target size={14} /> Me localiser
        </button>
        <div className="relative">
          <button
            onClick={() => setMapFiltersOpen((o) => !o)}
            className={`pl-interactive flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-semibold transition-colors ${dark ? "border-zinc-700 text-zinc-200 hover:bg-zinc-800" : "border-stone-300 text-stone-700 hover:bg-stone-100"}`}
          >
            <SlidersHorizontal size={14} /> Filtres
          </button>
          {mapFiltersOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setMapFiltersOpen(false)} />
              <div className={`absolute left-0 z-20 mt-1 w-72 space-y-3 rounded-xl border p-3.5 shadow-lg ${dark ? "bg-zinc-900 border-zinc-800" : "bg-white border-stone-200"}`}>
                <div className={`inline-flex w-full overflow-hidden rounded-lg border ${dark ? "border-zinc-800" : "border-stone-300"}`}>
                  <button onClick={() => setColorBy("statut")} className={`flex-1 ${chipCls(colorBy === "statut")}`}>Par statut</button>
                  <button onClick={() => setColorBy("commercial")} className={`flex-1 ${chipCls(colorBy === "commercial")}`}>Par commercial</button>
                </div>
                <label className={`flex items-center gap-2 ${dark ? "text-zinc-300" : "text-stone-700"}`}>
                  <input type="checkbox" checked={hideClosed} onChange={(e) => setHideClosed(e.target.checked)} className="accent-blue-700" />
                  Masquer gagnés et perdus
                </label>
                {clients.length > 0 && (
                  <label className={`flex items-center gap-2 ${dark ? "text-zinc-300" : "text-stone-700"}`}>
                    <input type="checkbox" checked={showClients} onChange={(e) => setShowClients(e.target.checked)} className="accent-blue-700" />
                    Afficher les clients existants ({clients.length})
                  </label>
                )}
                <label className={`flex items-center gap-2 ${dark ? "text-zinc-300" : "text-stone-700"}`}>
                  <input type="checkbox" checked={showOsm} onChange={(e) => setShowOsm(e.target.checked)} className="accent-blue-700" />
                  Découvrir les entreprises alentour (OSM)
                </label>
                <label className={`flex items-center gap-2 ${dark ? "text-zinc-300" : "text-stone-700"}`}>
                  <input type="checkbox" checked={showTeamZones} onChange={(e) => setShowTeamZones(e.target.checked)} className="accent-blue-700" />
                  Afficher les zones des équipes
                </label>
                <div className={`border-t pt-3 ${dark ? "border-zinc-800" : "border-stone-200"}`}>
                  <button
                    onClick={searchIndustrialZones}
                    disabled={zonesLoading}
                    className={`pl-interactive w-full rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-60 ${dark ? "border-zinc-700 text-zinc-200 hover:bg-zinc-800" : "border-stone-300 text-stone-700 hover:bg-stone-100"}`}
                  >
                    {zonesLoading ? "Recherche en cours…" : "Identifier les zones industrielles (50 km)"}
                  </button>
                  {industrialZones.length > 0 && (
                    <label className={`mt-2 flex items-center gap-2 ${dark ? "text-zinc-300" : "text-stone-700"}`}>
                      <input type="checkbox" checked={showIndustrialZones} onChange={(e) => setShowIndustrialZones(e.target.checked)} className="accent-blue-700" />
                      Afficher les zones trouvées ({industrialZones.length})
                    </label>
                  )}
                </div>
                {missing.length > 0 && (
                  <button
                    onClick={runGeocode}
                    disabled={!!busy}
                    className={`pl-interactive w-full rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-60 ${dark ? "border-zinc-700 text-zinc-200 hover:bg-zinc-800" : "border-stone-300 text-stone-700 hover:bg-stone-100"}`}
                  >
                    {busy ? `Localisation… ${busy}` : `Localiser ${missing.length} prospect(s) sans position`}
                  </button>
                )}
              </div>
            </>
          )}
        </div>
        {showOsm && zoomTooFar && (
          <span className={`rounded-lg px-2.5 py-1 text-xs font-medium ${dark ? "bg-zinc-800 text-zinc-400" : "bg-stone-100 text-stone-500"}`}>
            Zoomez pour voir les entreprises alentour
          </span>
        )}
        {showClients && clientTooFar && clients.length > 0 && (
          <span className={`rounded-lg px-2.5 py-1 text-xs font-medium ${dark ? "bg-zinc-800 text-zinc-400" : "bg-stone-100 text-stone-500"}`}>
            Zoomez sur un secteur pour voir les {clients.length} clients existants
          </span>
        )}
        {showOsm && !zoomTooFar && osmLoading && (
          <span className={`text-xs ${dark ? "text-zinc-500" : "text-stone-400"}`}>Recherche en cours…</span>
        )}
      </div>

      <div ref={containerRef} className={`isolate relative z-0 h-[65vh] min-h-[420px] overflow-hidden rounded-2xl border ${dark ? "border-zinc-800 prospection-map-dark" : "border-stone-200"}`} />

      <div className={`text-xs ${dark ? "text-zinc-500" : "text-stone-400"}`}>
        Astuce : clic droit (ou appui long sur mobile) sur la carte pour ajouter un prospect à cet endroit — l'adresse et le nom se remplissent automatiquement si vous visez un commerce.
      </div>

      <div className={`flex flex-wrap gap-4 text-xs ${dark ? "text-zinc-400" : "text-stone-600"}`}>
        {legend.map(([l, c]) => (
          <span key={l} className="flex items-center gap-1.5"><i className="inline-block h-3 w-3 rounded-full" style={{ background: c }} />{l}</span>
        ))}
        <span className="flex items-center gap-1.5"><i className="inline-block h-3 w-3 rounded-full border-2 border-rose-700" />Relance en retard (contour et point rouges)</span>
        {showClients && clients.length > 0 && (
          <span className="flex items-center gap-1.5">
            <i className="inline-block h-2.5 w-2.5" style={{ background: PROSPECTION_CLIENT_COLOR, transform: "rotate(45deg)" }} />
            Client existant (losange)
          </span>
        )}
        {showOsm && osmPlaces.length > 0 && (
          <span className="flex items-center gap-1.5">
            <i className={`inline-block h-2.5 w-2.5 rounded-full border-2 ${dark ? "border-slate-400" : "border-slate-400"}`} style={{ background: "#fff" }} />
            Entreprise OpenStreetMap ({osmPlaces.length}) — cliquez pour ajouter
          </span>
        )}
        {showIndustrialZones && industrialZones.length > 0 && (
          <span className="flex items-center gap-1.5">
            <i className="inline-block h-2.5 w-2.5" style={{ background: PROSPECTION_ZONE_COLOR }} />
            Zone industrielle / d'activité ({industrialZones.length})
          </span>
        )}
        <span>Un chiffre = plusieurs points proches, cliquez pour zoomer</span>
        <span>Restez appuyé (ou clic droit) sur la carte pour ajouter un prospect à cet endroit</span>
        <span>{placed.length} prospect(s) affiché(s){clientsPlaced.length > 0 ? ` · ${clientsPlaced.length} client(s)` : ""}</span>
      </div>
    </div>
  );
}

function ProspectionRelancePill({ dark, p }) {
  const s = prospectionRelanceState(p);
  if (!s) return null;
  const cls =
    s === "late"
      ? dark ? "bg-rose-500/15 text-rose-300" : "bg-rose-50 text-rose-700"
      : s === "due"
      ? dark ? "bg-sky-500/15 text-sky-300" : "bg-sky-50 text-sky-800"
      : dark ? "bg-zinc-800 text-zinc-400" : "bg-stone-100 text-stone-600";
  const lbl = s === "late" ? `En retard · ${prospectionFrDate(p.relance)}` : s === "due" ? "Aujourd'hui" : prospectionFrDate(p.relance);
  return <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${cls}`}>{lbl}</span>;
}

function ProspectionTab({ dark, currentUserName, readOnly, showToast }) {
  const data = useProspection();
  const { prospects, actions, loading, error } = data;
  // Les clients existants (importés du CRM) ne font jamais partie du pipeline commercial —
  // ils ne comptent dans aucune statistique et ne servent qu'à se repérer sur la carte.
  const funnelProspects = useMemo(() => prospects.filter((p) => !p.client_existant), [prospects]);
  const existingClients = useMemo(() => prospects.filter((p) => p.client_existant), [prospects]);
  const [vue, setVue] = useState(() => loadLocal("dsr:prospection-vue", "jour"));
  useEffect(() => { saveLocal("dsr:prospection-vue", vue); }, [vue]);
  const [scope, setScope] = useState("");
  const [openId, setOpenId] = useState(null);
  const [newPrefill, setNewPrefill] = useState(null);
  const openNewFromOsm = (place) => {
    setNewPrefill({ societe: place.societe, secteur: place.secteur, adresse: place.adresse, code_postal: place.code_postal, commune: place.commune, tel: place.tel, email: place.email, lat: place.lat, lng: place.lng, _coordsFromSuggestion: true });
    setOpenId("new");
  };
  const openNewFromCoords = async (latlng) => {
    setNewPrefill({ lat: latlng.lat, lng: latlng.lng, _coordsFromSuggestion: true });
    setOpenId("new");
    const [addr, place] = await Promise.all([
      prospectionReverseGeocode(latlng.lat, latlng.lng),
      prospectionFindPlaceAt(latlng.lat, latlng.lng),
    ]);
    const cleanPlace = place ? Object.fromEntries(Object.entries(place).filter(([, v]) => v !== undefined && v !== "")) : {};
    const merged = { ...addr, ...cleanPlace }; // le nom/l'adresse du lieu identifié priment sur l'adresse générique
    if (Object.keys(merged).length) setNewPrefill((p) => (p ? { ...p, ...merged } : p));
  };
  const closeFiche = () => { setOpenId(null); setNewPrefill(null); };
  const [filters, setFilters] = useState({ q: "", statut: "", secteur: "", energie: "" });
  const [importing, setImporting] = useState("");
  const [importAsClient, setImportAsClient] = useState(false);
  const [skipDuplicates, setSkipDuplicates] = useState(true);
  const [pendingImport, setPendingImport] = useState(null); // { rows } en attente de confirmation
  const fileRef = useRef(null);

  const commerciaux = PROSPECTION_COMMERCIAUX;
  const team = useMemo(() => {
    const s = new Set(commerciaux);
    funnelProspects.forEach((p) => p.commercial && s.add(p.commercial));
    return [...s];
  }, [commerciaux, funnelProspects]);

  // Filtre « Toute l'équipe » / une équipe (A, B) / un commercial.
  const scopeTeam = scope.startsWith("team:") ? scope.slice(5) : "";
  const inScope = (nom) => !scope || (scopeTeam ? PROSPECTION_TEAMS[nom] === scopeTeam : nom === scope);
  const scoped = scope ? funnelProspects.filter((p) => inScope(p.commercial)) : funnelProspects;
  const teamIds = [...new Set(Object.values(PROSPECTION_TEAMS))].sort();
  const teamLabel = (t) => `Équipe ${t} (${Object.keys(PROSPECTION_TEAMS).filter((n) => PROSPECTION_TEAMS[n] === t).join(", ")})`;

  const autoCommercial = prospectionCommercialFor(currentUserName);
  const lectureSeule = () => showToast("Accès en lecture seule : vous pouvez consulter, pas modifier", { type: "error" });

  const addAction = async (id, type, texte, par) => {
    await data.addAction(id, type, texte, par);
  };

  const snooze = async (p, n) => {
    await data.patch(p.id, { relance: prospectionAddDaysISO(n) });
    await data.addAction(p.id, "Relance", `Reportée de ${n} jours`, currentUserName);
  };

  // Proposition envoyée : statut + date d'envoi + relance à 72 h.
  const propositionEnvoyee = async (p) => {
    const relance = prospectionAddDaysISO(PROSPECTION_PROPOSITION_RELANCE_JOURS);
    const fields = { statut: "Proposition envoyée", relance, derniere_proposition: prospectionTodayISO() };
    try {
      await data.patch(p.id, fields);
    } catch (e) {
      if (!prospectionIsMissingCritereCol(e)) throw e;
      await data.patch(p.id, { statut: fields.statut, relance });
    }
    await data.addAction(p.id, "Autre", "Proposition envoyée", currentUserName);
    showToast(`Proposition envoyée à ${p.societe} — relance le ${prospectionFrDate(relance)}`, { type: "celebrate" });
  };

  const quickVisit = async (p) => {
    await addAction(p.id, "Visite", "Visite sur le terrain", currentUserName);
    showToast(`Visite notée pour ${p.societe}`, { type: "celebrate" });
  };

  const exportCsv = () => {
    const blob = new Blob([prospectsToCsv(filtered)], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `prospects-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const pickCsv = async (file) => {
    const rows = parseProspectsCsv(await file.text());
    if (!rows.length) { showToast('Aucun prospect trouvé dans ce fichier (colonne "societe" attendue)', { type: "error" }); return; }
    const existingNames = new Set(prospects.map((p) => (p.societe || "").trim().toLowerCase()).filter(Boolean));
    const rowsWithFlag = rows.map((r) => ({ ...r, _duplicate: existingNames.has((r.societe || "").trim().toLowerCase()) }));
    const duplicateCount = rowsWithFlag.filter((r) => r._duplicate).length;
    setPendingImport({ rows: rowsWithFlag, duplicateCount });
    setSkipDuplicates(duplicateCount > 0);
  };

  const confirmImport = async () => {
    const rows = (skipDuplicates ? pendingImport.rows.filter((r) => !r._duplicate) : pendingImport.rows).map(({ _duplicate, ...r }) => ({ ...r, commercial: (r.commercial || "").trim() || (importAsClient ? "" : autoCommercial) }));
    setPendingImport(null);
    if (rows.length === 0) { showToast("Rien à importer — toutes les lignes étaient des doublons"); setSkipDuplicates(true); return; }
    try {
      setImporting("0");
      const n = await data.bulkInsert(rows, (i, t) => setImporting(`${i}/${t}`), importAsClient ? { client_existant: true } : undefined);
      showToast(importAsClient ? `${n} client(s) existant(s) importé(s)` : `${n} prospect(s) importé(s)`);
    } catch (e) {
      showToast(`Import interrompu — ${e.message}`, { type: "error" });
    } finally {
      setImporting("");
      setImportAsClient(false);
      setSkipDuplicates(true);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const q = filters.q.toLowerCase();
  const filtered = scoped.filter(
    (p) =>
      (!filters.statut || p.statut === filters.statut) &&
      (!filters.secteur || p.secteur === filters.secteur) &&
      (!filters.energie || prospectionListOf(p.energies).includes(filters.energie)) &&
      (!q || [p.societe, p.contact, p.decideur, p.commune, p.adresse, p.notes, p.tel, p.marques].join(" ").toLowerCase().includes(q))
  );

  const inputCls = `rounded-lg border px-3 py-2 text-sm outline-none transition-shadow focus:ring-2 ${dark ? "bg-zinc-950 border-zinc-800 text-zinc-200 focus:ring-blue-700/30" : "bg-white border-stone-200 text-stone-700 focus:ring-blue-700/20"}`;
  const cardCls = `rounded-2xl border ${dark ? "bg-zinc-900/40 border-zinc-800" : "bg-white border-stone-200"}`;

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <RefreshCw className={`animate-spin ${dark ? "text-zinc-600" : "text-stone-300"}`} size={24} />
      </div>
    );
  }
  if (error) {
    return (
      <div className={`rounded-2xl border p-4 text-sm ${dark ? "border-rose-800 bg-rose-950 text-rose-200" : "border-rose-200 bg-rose-50 text-rose-800"}`}>
        Impossible de charger la prospection — {error}
      </div>
    );
  }

  const dueCount = scoped.filter((p) => ["late", "due"].includes(prospectionRelanceState(p))).length;

  const Row = ({ p }) => (
    <div className={`pl-interactive grid grid-cols-1 items-center gap-2 p-3.5 sm:grid-cols-[1fr_auto] ${cardCls}`}>
      <div className="min-w-0 cursor-pointer" onClick={() => setOpenId(p.id)}>
        <div className={`flex flex-wrap items-center gap-2 font-semibold ${dark ? "text-zinc-100" : "text-stone-900"}`}>
          {p.societe} <ProspectionRelancePill dark={dark} p={p} />
        </div>
        <div className={`text-sm ${dark ? "text-zinc-500" : "text-stone-500"}`}>{[p.contact, p.tel, p.commune, p.statut, (!scope || scopeTeam) && p.commercial].filter(Boolean).join(" · ")}</div>
        {(p.flotte || p.marques || p.energies) && (
          <div className={`text-xs ${dark ? "text-zinc-500" : "text-stone-500"}`}>{[p.flotte && `${p.flotte} véh.`, p.marques, p.energies].filter(Boolean).join(" · ")}</div>
        )}
        {p.statut === "Perdu" && p.motif_perte && <div className={`text-sm ${dark ? "text-zinc-400" : "text-stone-600"}`}>Perdu : {p.motif_perte}</div>}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {p.tel && (
          <a href={`tel:${p.tel.replace(/\s/g, "")}`} className={`rounded-lg border px-2.5 py-1 text-sm ${dark ? "border-zinc-700 text-zinc-300" : "border-stone-300 text-stone-700"}`}>
            Appeler
          </a>
        )}
        {(p.adresse || p.commune) && (
          <a href={prospectionMapsDirectionsUrl(p)} target="_blank" rel="noreferrer" className={`rounded-lg border px-2.5 py-1 text-sm ${dark ? "border-zinc-700 text-zinc-300" : "border-stone-300 text-stone-700"}`}>
            Itinéraire
          </a>
        )}
        {!readOnly && <button onClick={() => quickVisit(p)} className={`rounded-lg border px-2.5 py-1 text-sm ${dark ? "border-emerald-700 text-emerald-400" : "border-emerald-300 text-emerald-700"}`}>Visité</button>}
        {!readOnly && p.statut === "Prospect" && (
          <button onClick={() => propositionEnvoyee(p)} title="Proposition envoyée : relance dans 72 h" className={`rounded-lg border px-2.5 py-1 text-sm ${dark ? "border-violet-700 text-violet-300" : "border-violet-300 text-violet-700"}`}>Proposition envoyée</button>
        )}
        {!readOnly && <button onClick={() => snooze(p, 2)} className={`rounded-lg border px-2.5 py-1 text-sm ${dark ? "border-zinc-700 text-zinc-300" : "border-stone-300 text-stone-700"}`}>+2 j</button>}
        {!readOnly && <button onClick={() => snooze(p, 7)} className={`rounded-lg border px-2.5 py-1 text-sm ${dark ? "border-zinc-700 text-zinc-300" : "border-stone-300 text-stone-700"}`}>+7 j</button>}
        <button onClick={() => setOpenId(p.id)} className="rounded-lg bg-blue-700 px-2.5 py-1 text-sm font-semibold text-white">Ouvrir</button>
      </div>
    </div>
  );

  const Block = ({ title, items }) =>
    items.length ? (
      <section className="mb-5">
        <h3 className={`mb-2 text-xs font-bold uppercase tracking-widest ${dark ? "text-zinc-400" : "text-stone-500"}`}>{title} ({items.length})</h3>
        <div className="flex flex-col gap-2">{items.map((p) => <Row key={p.id} p={p} />)}</div>
      </section>
    ) : null;

  const vueJour = () => {
    const byDate = (a, b) => (a.relance || "").localeCompare(b.relance || "");
    const late = scoped.filter((p) => prospectionRelanceState(p) === "late").sort(byDate);
    const due = scoped.filter((p) => prospectionRelanceState(p) === "due");
    const semaine = scoped.filter((p) => prospectionRelanceState(p) === "future" && p.relance <= prospectionAddDaysISO(7)).sort(byDate);
    if (!scoped.length) return <EmptyState dark={dark} icon={Target} title="Aucun prospect pour l'instant" subtitle="Commencez par en ajouter un." />;
    if (!late.length && !due.length && !semaine.length) return <EmptyState dark={dark} icon={CheckCircle2} title="Rien à relancer cette semaine" />;
    return (
      <>
        <Block title="En retard" items={late} />
        <Block title="À relancer aujourd'hui" items={due} />
        <Block title="Cette semaine" items={semaine} />
      </>
    );
  };

  const vuePipeline = () =>
    scoped.length === 0 ? (
      <EmptyState dark={dark} icon={Target} title="Aucun prospect pour l'instant" subtitle="Commencez par en ajouter un." />
    ) : (
    <div className="grid auto-cols-[minmax(220px,1fr)] grid-flow-col gap-3 overflow-x-auto pb-2">
      {PROSPECTION_STATUTS.map((s) => {
        const items = scoped.filter((p) => p.statut === s);
        return (
          <div key={s} className={`min-h-[140px] rounded-2xl p-2 ${dark ? "bg-zinc-900/60" : "bg-stone-100"}`}>
            <h3 className={`mb-2 flex justify-between px-1 text-xs font-bold uppercase tracking-widest ${dark ? "text-zinc-400" : "text-stone-500"}`}>
              <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-full" style={{ background: PROSPECTION_STATUT_COLORS[s] }} />{s}</span>
              <span>{items.length}</span>
            </h3>
            {items.map((p) => (
              <button key={p.id} onClick={() => setOpenId(p.id)} className={`pl-interactive mb-2 block w-full rounded-xl border p-2.5 text-left ${dark ? "bg-zinc-950 border-zinc-800" : "bg-white border-stone-200"}`}>
                <div className={`font-semibold ${dark ? "text-zinc-100" : "text-stone-900"}`}>{p.societe}</div>
                <div className={`text-xs ${dark ? "text-zinc-500" : "text-stone-400"}`}>{[p.commune, p.flotte && `${p.flotte} véh.`, p.energies, p.modele].filter(Boolean).join(" · ")}</div>
                <div className="mt-1.5 flex items-center justify-between">
                  <span title={p.commercial} className="grid h-6 w-6 place-items-center rounded-full bg-blue-700 text-[10px] font-bold text-white">{prospectionInitials(p.commercial)}</span>
                  <ProspectionRelancePill dark={dark} p={p} />
                </div>
              </button>
            ))}
          </div>
        );
      })}
    </div>
    );

  const vueListe = () => (
    <>
      <div className="mb-3 flex flex-wrap gap-2">
        <input
          type="search"
          placeholder="Rechercher une société, un contact, une commune…"
          value={filters.q}
          onChange={(e) => setFilters({ ...filters, q: e.target.value })}
          className={`min-w-[220px] flex-1 ${inputCls}`}
        />
        <select value={filters.statut} onChange={(e) => setFilters({ ...filters, statut: e.target.value })} className={inputCls}>
          <option value="">Tous les statuts</option>
          {PROSPECTION_STATUTS.map((s) => <option key={s}>{s}</option>)}
        </select>
        <select value={filters.secteur} onChange={(e) => setFilters({ ...filters, secteur: e.target.value })} className={inputCls}>
          <option value="">Tous les secteurs</option>
          {PROSPECTION_SECTEURS.map((s) => <option key={s}>{s}</option>)}
        </select>
        <select value={filters.energie} onChange={(e) => setFilters({ ...filters, energie: e.target.value })} className={inputCls}>
          <option value="">Toutes énergies</option>
          {PROSPECTION_ENERGIES.map((s) => <option key={s}>{s}</option>)}
        </select>
        <button onClick={exportCsv} className={`pl-interactive flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-semibold transition-colors ${dark ? "border-zinc-700 text-zinc-200 hover:bg-zinc-800" : "border-stone-300 text-stone-700 hover:bg-stone-100"}`}>
          <Download size={14} /> Exporter en CSV
        </button>
        {!readOnly && <button
          onClick={() => fileRef.current?.click()}
          disabled={!!importing}
          className={`pl-interactive rounded-lg border px-3 py-2 text-sm font-semibold transition-colors disabled:opacity-60 ${dark ? "border-zinc-700 text-zinc-200 hover:bg-zinc-800" : "border-stone-300 text-stone-700 hover:bg-stone-100"}`}
        >
          {importing ? `Import… ${importing}` : "Importer un CSV"}
        </button>}
        <input ref={fileRef} type="file" accept=".csv,text/csv" hidden onChange={(e) => e.target.files[0] && pickCsv(e.target.files[0])} />
      </div>

      {pendingImport && (
        <div className={`mb-3 flex flex-wrap items-center gap-3 rounded-xl border p-3 text-sm ${dark ? "border-blue-700/40 bg-blue-500/10 text-blue-200" : "border-blue-200 bg-blue-50 text-blue-900"}`}>
          <span>Importer {pendingImport.rows.length} {importAsClient ? "client(s) existant(s)" : "prospect(s)"} ? Les adresses seront localisées automatiquement.</span>
          <label className="flex items-center gap-1.5 text-xs font-medium">
            <input type="checkbox" checked={importAsClient} onChange={(e) => setImportAsClient(e.target.checked)} className="accent-blue-700" />
            Ce sont des clients existants (CRM), pas des prospects
          </label>
          {pendingImport.duplicateCount > 0 && (
            <label className={`flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-semibold ${dark ? "bg-amber-500/15 text-amber-300" : "bg-amber-100 text-amber-800"}`}>
              <input type="checkbox" checked={skipDuplicates} onChange={(e) => setSkipDuplicates(e.target.checked)} className="accent-blue-700" />
              {pendingImport.duplicateCount} doublon(s) détecté(s) (société déjà présente) — les ignorer
            </label>
          )}
          <div className="ml-auto flex gap-2">
            <button
              onClick={() => { setPendingImport(null); setImportAsClient(false); setSkipDuplicates(true); if (fileRef.current) fileRef.current.value = ""; }}
              className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${dark ? "border-zinc-700 text-zinc-200" : "border-stone-300 text-stone-700"}`}
            >
              Annuler
            </button>
            <button onClick={confirmImport} className="rounded-lg bg-blue-700 px-3 py-1.5 text-xs font-bold text-white">Importer</button>
          </div>
        </div>
      )}

      {filtered.length === 0 ? (
        <EmptyState dark={dark} icon={Target} title="Aucun prospect ne correspond à ces filtres" />
      ) : (
        <div className={`overflow-x-auto rounded-2xl border ${dark ? "border-zinc-800" : "border-stone-200"}`}>
          <table className="w-full text-sm">
            <thead>
              <tr className={`border-b text-left text-xs ${dark ? "border-zinc-800 text-zinc-500" : "border-stone-200 text-stone-500"}`}>
                {["Société", "Contact", "Décideur", "Commune", "Secteur", "Flotte", "Marques", "Énergie", "Renouv.", "Statut", "Commercial", "Relance"].map((h) => (
                  <th key={h} className="whitespace-nowrap px-3 py-2 font-semibold">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <tr key={p.id} onClick={() => setOpenId(p.id)} className={`cursor-pointer border-b transition-colors ${dark ? "border-zinc-800 hover:bg-zinc-900/60" : "border-stone-100 hover:bg-stone-50"}`}>
                  <td className={`whitespace-nowrap px-3 py-2 font-semibold ${dark ? "text-zinc-100" : "text-stone-900"}`}>
                    {p.societe}
                    {p.lat == null && <span title="Adresse non localisée" className={dark ? "ml-1 text-zinc-600" : "ml-1 text-stone-400"}>·</span>}
                  </td>
                  <td className={`whitespace-nowrap px-3 py-2 ${dark ? "text-zinc-300" : "text-stone-700"}`}>{p.contact}</td>
                  <td className={`whitespace-nowrap px-3 py-2 ${dark ? "text-zinc-300" : "text-stone-700"}`}>{p.decideur}</td>
                  <td className={`whitespace-nowrap px-3 py-2 ${dark ? "text-zinc-300" : "text-stone-700"}`}>{p.commune}</td>
                  <td className={`whitespace-nowrap px-3 py-2 ${dark ? "text-zinc-300" : "text-stone-700"}`}>{p.secteur}</td>
                  <td className={`whitespace-nowrap px-3 py-2 ${dark ? "text-zinc-300" : "text-stone-700"}`}>{p.flotte}</td>
                  <td className={`max-w-[160px] truncate px-3 py-2 ${dark ? "text-zinc-300" : "text-stone-700"}`} title={p.marques || ""}>{p.marques}</td>
                  <td className={`whitespace-nowrap px-3 py-2 ${dark ? "text-zinc-300" : "text-stone-700"}`}>{p.energies}</td>
                  <td className={`whitespace-nowrap px-3 py-2 ${dark ? "text-zinc-300" : "text-stone-700"}`}>{p.renouvellement_mois ? (p.renouvellement_mois % 12 === 0 ? `${p.renouvellement_mois / 12} an${p.renouvellement_mois > 12 ? "s" : ""}` : `${p.renouvellement_mois} mois`) : ""}</td>
                  <td className={`whitespace-nowrap px-3 py-2 ${dark ? "text-zinc-300" : "text-stone-700"}`}>{p.statut}</td>
                  <td className={`whitespace-nowrap px-3 py-2 ${dark ? "text-zinc-300" : "text-stone-700"}`}>{p.commercial}</td>
                  <td className="whitespace-nowrap px-3 py-2"><ProspectionRelancePill dark={dark} p={p} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );

  const vueEquipe = () => {
    const weekAgo = Date.now() - 7 * 864e5;
    const groups = {};
    team.filter(inScope).forEach((n) => {
      const t = PROSPECTION_TEAMS[n] || "Autres";
      (groups[t] = groups[t] || []).push(n);
    });
    const teamOrder = Object.keys(groups).sort((a, b) => (a === "Autres" ? 1 : b === "Autres" ? -1 : a.localeCompare(b)));

    return (
      <div className="space-y-5">
        {teamOrder.map((t) => (
          <section key={t}>
            {t !== "Autres" && (
              <h3 className={`mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-widest ${dark ? "text-zinc-400" : "text-stone-500"}`}>
                <i className="h-2.5 w-2.5 rounded-full" style={{ background: PROSPECTION_TEAM_COLORS[t]?.main }} />
                Équipe {t}
              </h3>
            )}
            <div className="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-3">
              {groups[t].map((n, i) => {
                const badgeColor = PROSPECTION_TEAM_COLORS[t] ? (i === 0 ? PROSPECTION_TEAM_COLORS[t].main : PROSPECTION_TEAM_COLORS[t].light) : "#1D4ED8";
                const l = prospects.filter((p) => p.commercial === n);
                const nbActions = actions.filter((a) => a.par === n && new Date(a.created_at).getTime() >= weekAgo).length;
                const enCours = l.filter((p) => p.statut === "Prospect").length;
                const propositions = l.filter((p) => p.statut === "Proposition envoyée").length;
                const perdus = l.filter((p) => p.statut === "Perdu").length;
                const gagnes = l.filter((p) => p.statut === "Gagné");
                const vehicules = gagnes.reduce((s, p) => s + (p.flotte || 0), 0);
                const retard = l.filter((p) => prospectionRelanceState(p) === "late").length;
                const pct = Math.min(100, Math.round((nbActions / PROSPECTION_OBJECTIF_SEMAINE) * 100));
                return (
                  <div key={n} className={`p-4 ${cardCls}`}>
                    <h4 className={`mb-3 flex items-center gap-2 font-semibold ${dark ? "text-zinc-100" : "text-stone-900"}`}>
                      <span className="grid h-7 w-7 place-items-center rounded-full text-xs font-bold text-white" style={{ background: badgeColor }}>{prospectionInitials(n)}</span>
                      {n}
                    </h4>
                    <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-sm">
                      <dt className={dark ? "text-zinc-500" : "text-stone-500"}>Prospects en portefeuille</dt>
                      <dd className={`text-right font-semibold ${dark ? "text-zinc-100" : "text-stone-800"}`}>{l.length}</dd>
                      <dt className={dark ? "text-zinc-500" : "text-stone-500"}>Prospects en cours</dt>
                      <dd className={`text-right font-semibold ${dark ? "text-zinc-100" : "text-stone-800"}`}>{enCours}</dd>
                      <dt className={dark ? "text-zinc-500" : "text-stone-500"}>Propositions envoyées</dt>
                      <dd className={`text-right font-semibold ${dark ? "text-zinc-100" : "text-stone-800"}`}>{propositions}</dd>
                      <dt className={dark ? "text-zinc-500" : "text-stone-500"}>Perdus</dt>
                      <dd className={`text-right font-semibold ${dark ? "text-zinc-100" : "text-stone-800"}`}>{perdus}</dd>
                      <dt className={dark ? "text-zinc-500" : "text-stone-500"}>Affaires gagnées</dt>
                      <dd className={`text-right font-semibold ${dark ? "text-zinc-100" : "text-stone-800"}`}>{gagnes.length}{vehicules ? ` (${vehicules} véh.)` : ""}</dd>
                      <dt className={dark ? "text-zinc-500" : "text-stone-500"}>Taux de transformation</dt>
                      <dd className={`text-right font-semibold ${dark ? "text-zinc-100" : "text-stone-800"}`}>{l.length ? Math.round((gagnes.length / l.length) * 100) : 0} %</dd>
                      <dt className={dark ? "text-zinc-500" : "text-stone-500"}>Relances en retard</dt>
                      <dd className={`text-right font-semibold ${retard ? "text-rose-500" : dark ? "text-zinc-100" : "text-stone-800"}`}>{retard}</dd>
                    </dl>
                    <div className={`mt-3 h-2 overflow-hidden rounded-full ${dark ? "bg-zinc-800" : "bg-stone-100"}`}>
                      <div className="h-full rounded-full" style={{ width: `${pct}%`, background: badgeColor }} />
                    </div>
                    <div className={`mt-1 text-xs ${dark ? "text-zinc-500" : "text-stone-400"}`}>{nbActions} actions sur 7 jours, objectif {PROSPECTION_OBJECTIF_SEMAINE}</div>
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    );
  };

  const VUES = [
    ["jour", "Aujourd'hui"],
    ["pipeline", "Pipeline"],
    ["liste", "Prospects"],
    ["carte", "Carte"],
    ["equipe", "Équipe"],
  ];

  return (
    <div className="space-y-4">
      <div>
        <div className={`flex items-center gap-2 text-sm font-bold uppercase tracking-widest ${dark ? "text-zinc-400" : "text-stone-500"}`}>
          <Target size={15} className={dark ? "text-blue-500" : "text-blue-800"} />
          Prospection B2B
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
          <select value={scope} onChange={(e) => setScope(e.target.value)} className={inputCls}>
            <option value="">Toute l'équipe</option>
            <optgroup label="Par équipe">
              {teamIds.map((t) => <option key={t} value={`team:${t}`}>{teamLabel(t)}</option>)}
            </optgroup>
            <optgroup label="Par commercial">
              {team.map((n) => <option key={n}>{n}</option>)}
            </optgroup>
          </select>
          {readOnly ? (
            <span className={`ml-auto rounded-full px-3 py-1 text-xs font-semibold ${dark ? "bg-zinc-800 text-zinc-300" : "bg-stone-100 text-stone-600"}`}>Lecture seule</span>
          ) : (
            <button onClick={() => setOpenId("new")} className="pl-interactive ml-auto rounded-lg bg-blue-700 px-3.5 py-2 text-sm font-bold text-white transition-colors hover:bg-blue-500">
              Nouveau prospect
            </button>
          )}
        </div>
      </div>

      <div className={`inline-flex flex-wrap gap-1 rounded-xl border p-1 ${dark ? "bg-zinc-900/60 border-zinc-800" : "bg-white border-stone-200"}`}>
        {VUES.map(([k, l]) => (
          <button
            key={k}
            onClick={() => setVue(k)}
            className={`pl-interactive flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-sm font-medium ${vue === k ? (dark ? "bg-blue-500/10 text-blue-300" : "bg-blue-50 text-blue-700") : dark ? "text-zinc-400 hover:text-zinc-200" : "text-stone-500 hover:text-stone-800"}`}
          >
            {l}
            {k === "jour" && dueCount > 0 && (
              <span className={`flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 text-[10px] font-bold ${vue === k ? "bg-white/25 text-white" : "bg-rose-500 text-white"}`}>{dueCount}</span>
            )}
          </button>
        ))}
      </div>

      <div key={vue} className="pl-fade-in">
        {vue === "jour" && vueJour()}
        {vue === "pipeline" && vuePipeline()}
        {vue === "liste" && vueListe()}
        {vue === "carte" && <ProspectMap dark={dark} prospects={scoped} clients={existingClients} commerciaux={team} onOpen={setOpenId} onAddFromOsm={readOnly ? lectureSeule : openNewFromOsm} onQuickVisit={readOnly ? lectureSeule : quickVisit} onCreateAtLocation={readOnly ? lectureSeule : openNewFromCoords} onGeocodeMissing={readOnly ? async () => ({ ok: 0, total: 0 }) : data.geocodeMissing} showToast={showToast} />}
        {vue === "equipe" && vueEquipe()}
      </div>

      {openId && (
        <ProspectFiche
          dark={dark}
          prospectId={openId}
          prospects={prospects}
          actions={actions}
          commerciaux={team}
          me={currentUserName}
          readOnly={readOnly}
          newPrefill={newPrefill}
          onClose={closeFiche}
          onSave={data.save}
          onDelete={data.remove}
          onAddAction={addAction}
          showToast={showToast}
        />
      )}
    </div>
  );
}

// ============================================================================
// Marketing (bêta) — logique pure (dates, modèles, récurrence). Testée hors navigateur.
// ============================================================================
const MARKETING_PROJECT_STATUTS = ["À lancer", "En cours", "En pause", "Terminé"];
const MARKETING_TASK_STATUTS = ["À faire", "En cours", "Fait"];
const MARKETING_CATEGORIES = ["Opération commerciale", "Événement", "Digital / réseaux sociaux", "Print / affichage", "Emailing / SMS", "Partenariat / presse", "Interne", "Autre"];
const MARKETING_RECURRENCES = [["", "Aucune"], ["hebdo", "Chaque semaine"], ["mensuel", "Chaque mois"], ["trimestriel", "Chaque trimestre"]];
const MARKETING_RECURRENCE_LABEL = { hebdo: "Hebdo", mensuel: "Mensuel", trimestriel: "Trimestriel" };
const MARKETING_PROJECT_COLORS = { "À lancer": "#6B7280", "En cours": "#2563EB", "En pause": "#D97706", "Terminé": "#16A34A" };

// Modèles de projet : chaque tâche est calée sur la deadline (offset en jours, négatif = avant),
// avec une relance posée N jours avant l'échéance de la tâche.
const MARKETING_TEMPLATES = [
  {
    id: "operation", label: "Opération commerciale", categorie: "Opération commerciale",
    desc: "Offre, visuels, diffusion, briefing équipe, bilan",
    tasks: [
      { titre: "Définir l'offre, la cible et le budget", offset: -30 },
      { titre: "Brief visuels / création", offset: -24 },
      { titre: "Valider les visuels", offset: -17, haute: true },
      { titre: "Préparer la diffusion (site, réseaux, emailing)", offset: -10 },
      { titre: "Briefer l'équipe de vente", offset: -5 },
      { titre: "Lancement / diffusion", offset: 0, haute: true, relance: 3 },
      { titre: "Bilan : leads, RDV, ventes", offset: 14 },
    ],
  },
  {
    id: "evenement", label: "Portes ouvertes / événement", categorie: "Événement",
    desc: "Invitations, logistique, animation, suivi des contacts",
    tasks: [
      { titre: "Fixer le programme et le budget", offset: -45 },
      { titre: "Réserver prestataires et matériel", offset: -35 },
      { titre: "Créer invitation et visuels", offset: -28 },
      { titre: "Envoyer les invitations (clients + prospects)", offset: -21, haute: true },
      { titre: "Relancer les invités (appel / SMS)", offset: -7 },
      { titre: "Briefer l'équipe et préparer le site", offset: -2 },
      { titre: "Jour J", offset: 0, haute: true, relance: 3 },
      { titre: "Relancer les contacts de l'événement", offset: 3 },
      { titre: "Bilan et retombées", offset: 14 },
    ],
  },
  {
    id: "lancement", label: "Lancement d'un modèle", categorie: "Opération commerciale",
    desc: "Teasing, exposition showroom, communication, essais",
    tasks: [
      { titre: "Plan de communication du lancement", offset: -30 },
      { titre: "Recevoir et valider les supports constructeur", offset: -21 },
      { titre: "Teasing réseaux sociaux", offset: -14 },
      { titre: "Mettre en scène le véhicule en showroom", offset: -3 },
      { titre: "Emailing / SMS base clients", offset: -2, haute: true },
      { titre: "Jour de lancement", offset: 0, haute: true, relance: 3 },
      { titre: "Suivi des essais et leads", offset: 10 },
    ],
  },
  {
    id: "emailing", label: "Campagne emailing / SMS", categorie: "Emailing / SMS",
    desc: "Segment, message, envoi, relance des non-ouverts",
    tasks: [
      { titre: "Choisir la cible et extraire la liste", offset: -10 },
      { titre: "Rédiger le message et le visuel", offset: -7 },
      { titre: "Valider (orthographe, offre, mentions légales)", offset: -3, haute: true },
      { titre: "Envoi", offset: 0, haute: true },
      { titre: "Relancer les non-ouverts", offset: 4 },
      { titre: "Bilan : ouvertures, clics, RDV", offset: 10 },
    ],
  },
];

function marketingAddDays(iso, n) {
  const d = new Date(iso + "T12:00:00");
  d.setDate(d.getDate() + n);
  return prospectionTodayISO(d);
}
function marketingAddMonths(iso, n) {
  const [y, m, day] = iso.split("-").map(Number);
  const lastDay = new Date(y, m - 1 + n + 1, 0).getDate();
  return prospectionTodayISO(new Date(y, m - 1 + n, Math.min(day, lastDay), 12));
}
function marketingDaysBetween(a, b) {
  return Math.round((new Date(b + "T12:00:00") - new Date(a + "T12:00:00")) / 86400000);
}
function marketingStepDate(iso, recurrence) {
  if (recurrence === "hebdo") return marketingAddDays(iso, 7);
  if (recurrence === "mensuel") return marketingAddMonths(iso, 1);
  if (recurrence === "trimestriel") return marketingAddMonths(iso, 3);
  return iso;
}
function marketingFrDate(iso, withWeekday) {
  if (!iso) return "";
  return new Date(iso + "T12:00:00").toLocaleDateString("fr-FR", withWeekday ? { weekday: "short", day: "numeric", month: "short" } : { day: "numeric", month: "short" });
}
// Libellé relatif d'une date : "aujourd'hui", "demain", "dans 5 j", "en retard de 3 j".
function marketingRelativeLabel(iso, today) {
  const n = marketingDaysBetween(today, iso);
  if (n === 0) return "aujourd'hui";
  if (n === 1) return "demain";
  if (n === -1) return "hier";
  return n > 0 ? `dans ${n} j` : `en retard de ${-n} j`;
}

// Prochaine occurrence d'une tâche récurrente : première date de la série strictement après aujourd'hui,
// en gardant le même écart entre échéance et relance.
function marketingNextOccurrence(task, today) {
  if (!task.recurrence) return null;
  today = today || prospectionTodayISO();
  let next = task.echeance || today;
  let guard = 0;
  do { next = marketingStepDate(next, task.recurrence); guard++; } while (next <= today && guard < 500);
  const gap = task.relance && task.echeance ? marketingDaysBetween(task.relance, task.echeance) : null;
  return {
    project_id: task.project_id || null,
    titre: task.titre,
    notes: task.notes || null,
    priorite: task.priorite || "Normale",
    assignee: task.assignee || null,
    recurrence: task.recurrence,
    statut: "À faire",
    echeance: next,
    relance: gap != null ? marketingAddDays(next, -gap) : null,
    done_at: null,
  };
}

// Date la plus proche à traiter (échéance ou relance) d'une tâche ouverte.
function marketingUrgencyDate(t) {
  const ds = [t.echeance, t.relance].filter(Boolean).sort();
  return ds[0] || null;
}
function marketingBucket(t, today, weekEnd) {
  if (t.statut === "Fait") return "done";
  const d = marketingUrgencyDate(t);
  if (!d) return "nodate";
  if (d < today) return "late";
  if (d === today) return "today";
  if (d <= weekEnd) return "week";
  return "later";
}
function marketingProjectProgress(project, tasks) {
  const mine = tasks.filter((t) => t.project_id === project.id);
  const done = mine.filter((t) => t.statut === "Fait").length;
  return { total: mine.length, done, open: mine.length - done, pct: mine.length ? Math.round((done / mine.length) * 100) : 0 };
}
function marketingBuildTemplateTasks(tpl, deadline, assignee) {
  if (!tpl || !deadline) return [];
  return tpl.tasks.map((tt) => {
    const echeance = marketingAddDays(deadline, tt.offset);
    return {
      titre: tt.titre,
      echeance,
      relance: marketingAddDays(echeance, -(tt.relance ?? 2)),
      assignee: assignee || null,
      priorite: tt.haute ? "Haute" : "Normale",
    };
  });
}
function marketingMonthGrid(monthISO) {
  const [y, m] = monthISO.split("-").map(Number);
  const startOffset = (new Date(y, m - 1, 1).getDay() + 6) % 7; // lundi = 0
  const daysInMonth = new Date(y, m, 0).getDate();
  const total = Math.ceil((startOffset + daysInMonth) / 7) * 7;
  const cells = [];
  for (let i = 0; i < total; i++) {
    const d = new Date(y, m - 1, 1 - startOffset + i, 12);
    cells.push({ iso: prospectionTodayISO(d), inMonth: d.getMonth() === m - 1, day: d.getDate() });
  }
  return cells;
}


// ───────── v2 : budget, liens, alerte « projet en danger », bilan ─────────
function marketingParseAmount(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = parseFloat(String(v).replace(/[\s\u00a0€]/g, "").replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? n : null;
}
function marketingEuro(n) {
  const v = Number(n) || 0;
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: Number.isInteger(v) ? 0 : 2 }).format(v);
}
// Accepte « drive.google.com/… » (ajoute https://) ; refuse tout schéma autre que http(s).
function marketingNormalizeUrl(raw) {
  let u = String(raw || "").trim();
  if (!u) return null;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(u)) u = "https://" + u;
  if (!/^https?:\/\//i.test(u)) return null;
  try { new URL(u); } catch (e) { return null; }
  return u;
}
function marketingBudgetState(project, expenses) {
  const prevu = project.budget != null ? Number(project.budget) : null;
  const depense = expenses.filter((x) => x.project_id === project.id).reduce((a, x) => a + Number(x.montant || 0), 0);
  return { prevu, depense, reste: prevu != null ? prevu - depense : null, pct: prevu ? Math.min(100, Math.round((depense / prevu) * 100)) : 0, over: prevu != null && depense > prevu };
}
// Un projet est « en danger » si sa deadline approche sans avancement suffisant, si des tâches sont en retard
// ou prévues après la deadline, ou si le budget est dépassé. level : "" | "risk" | "late".
function marketingProjectRisk(project, tasks, today, expenses) {
  const none = { level: "", reasons: [] };
  if (project.statut === "Terminé") return none;
  const mine = tasks.filter((t) => t.project_id === project.id);
  const open = mine.filter((t) => t.statut !== "Fait");
  const done = mine.length - open.length;
  const reasons = [];
  const days = project.deadline ? marketingDaysBetween(today, project.deadline) : null;
  if (days !== null) {
    if (days < 0) reasons.push(`Deadline dépassée de ${-days} j`);
    else if (days <= 14 && mine.length === 0) reasons.push(`J-${days} et aucune tâche planifiée`);
    else if (mine.length > 0) {
      const ratio = done / mine.length;
      if (open.length > 0 && ((days <= 7 && ratio < 0.8) || (days <= 14 && ratio < 0.5))) reasons.push(`J-${days} : seulement ${done}/${mine.length} tâches faites`);
    }
  }
  const late = open.filter((t) => t.echeance && t.echeance < today).length;
  if (late >= 2 || (late === 1 && days !== null && days <= 14)) reasons.push(`${late} tâche${late > 1 ? "s" : ""} en retard`);
  if (project.deadline) {
    const after = open.filter((t) => t.echeance && t.echeance > project.deadline).length;
    if (after > 0) reasons.push(`${after} tâche${after > 1 ? "s" : ""} prévue${after > 1 ? "s" : ""} après la deadline`);
  }
  if (expenses) {
    const b = marketingBudgetState(project, expenses);
    if (b.over) reasons.push(`Budget dépassé de ${marketingEuro(b.depense - b.prevu)}`);
  }
  if (!reasons.length) return none;
  return { level: days !== null && days < 0 ? "late" : "risk", reasons };
}

function marketingBilan({ project, tasks, expenses, links, comments, today }) {
  const mine = tasks.filter((t) => t.project_id === project.id);
  const doneTasks = mine.filter((t) => t.statut === "Fait");
  const openTasks = mine.filter((t) => t.statut !== "Fait");
  const dayOf = (iso) => (iso ? prospectionTodayISO(new Date(iso)) : "");
  const lastDone = doneTasks.map((t) => dayOf(t.done_at)).filter(Boolean).sort().pop() || "";
  const debut = dayOf(project.created_at) || today;
  const fin = project.statut === "Terminé" ? lastDone || today : today;
  const doneLate = doneTasks.filter((t) => t.echeance && t.done_at && dayOf(t.done_at) > t.echeance).length;
  const people = new Map();
  mine.forEach((t) => {
    const k = t.assignee || "Non attribuée";
    const e = people.get(k) || { nom: k, faites: 0, total: 0 };
    e.total++; if (t.statut === "Fait") e.faites++;
    people.set(k, e);
  });
  const myExpenses = expenses.filter((x) => x.project_id === project.id).sort((a, b) => (a.date_depense || "").localeCompare(b.date_depense || ""));
  const taskIds = new Set(mine.map((t) => t.id));
  return {
    titre: project.titre, categorie: project.categorie || "", responsable: project.responsable || "", statut: project.statut,
    deadline: project.deadline || "", debut, fin, dureeJours: Math.max(0, marketingDaysBetween(debut, fin)),
    retardDeadline: project.deadline && fin > project.deadline ? marketingDaysBetween(project.deadline, fin) : 0,
    total: mine.length, done: doneTasks.length, open: openTasks.length, pct: mine.length ? Math.round((doneTasks.length / mine.length) * 100) : 0,
    doneLate, openTitles: openTasks.map((t) => t.titre),
    personnes: [...people.values()].sort((a, b) => b.faites - a.faites),
    budget: marketingBudgetState(project, expenses), depenses: myExpenses,
    nbLiens: links.filter((l) => l.project_id === project.id || taskIds.has(l.task_id)).length,
    nbCommentaires: comments.filter((c) => taskIds.has(c.task_id)).length,
  };
}
function marketingBilanText(b) {
  const fr = (d) => marketingFrDate(d);
  const L = [`Bilan du projet « ${b.titre} » — Ford Caen`];
  if (b.categorie || b.responsable) L.push([b.categorie, b.responsable && `responsable : ${b.responsable}`].filter(Boolean).join(" · "));
  L.push("");
  L.push(`Période : ${fr(b.debut)} → ${fr(b.fin)} (${b.dureeJours} jours)${b.deadline ? ` · deadline ${fr(b.deadline)}${b.retardDeadline > 0 ? `, dépassée de ${b.retardDeadline} j` : ", respectée"}` : ""}`);
  L.push(`Tâches : ${b.done}/${b.total} faites (${b.pct} %)${b.doneLate ? ` · ${b.doneLate} terminée${b.doneLate > 1 ? "s" : ""} en retard` : ""}${b.open ? ` · ${b.open} non terminée${b.open > 1 ? "s" : ""}` : ""}`);
  if (b.open) b.openTitles.forEach((t) => L.push(`  • restant : ${t}`));
  if (b.personnes.length) { L.push(""); L.push("Répartition :"); b.personnes.forEach((p) => L.push(`  • ${p.nom} : ${p.faites}/${p.total} tâches faites`)); }
  L.push("");
  if (b.budget.prevu != null || b.depenses.length) {
    L.push(`Budget : ${b.budget.prevu != null ? `prévu ${marketingEuro(b.budget.prevu)} · ` : ""}dépensé ${marketingEuro(b.budget.depense)}${b.budget.prevu != null ? ` · ${b.budget.over ? "dépassement de " + marketingEuro(-b.budget.reste) : "reste " + marketingEuro(b.budget.reste)}` : ""}`);
    b.depenses.forEach((x) => L.push(`  • ${x.libelle} : ${marketingEuro(x.montant)}`));
  } else L.push("Budget : non renseigné");
  L.push("");
  L.push(`Documents liés : ${b.nbLiens} · Commentaires : ${b.nbCommentaires}`);
  return L.join("\n");
}

const MARKETING_TASK_FIELDS = ["project_id", "titre", "notes", "statut", "priorite", "assignee", "echeance", "relance", "recurrence", "done_at"];
function marketingCleanTask(t) {
  const row = {};
  for (const k of MARKETING_TASK_FIELDS) {
    let v = t[k];
    if (typeof v === "string") v = v.trim();
    if (v === "" || v === undefined) v = null;
    row[k] = v;
  }
  if (!row.statut) row.statut = "À faire";
  if (!row.priorite) row.priorite = "Normale";
  return row;
}
const MARKETING_PROJECT_FIELDS = ["titre", "description", "statut", "deadline", "responsable", "categorie", "budget"];
function marketingCleanProject(p) {
  const row = {};
  for (const k of MARKETING_PROJECT_FIELDS) {
    let v = p[k];
    if (typeof v === "string") v = v.trim();
    if (v === "" || v === undefined) v = null;
    row[k] = v;
  }
  if (!row.statut) row.statut = "En cours";
  row.budget = marketingParseAmount(row.budget);
  return row;
}
// Exécute une requête Supabase ; ne retente que les vraies coupures réseau (pas les refus RLS/contraintes).
async function marketingExec(fn, attempts = 3) {
  for (let i = 0; ; i++) {
    let res;
    try { res = await fn(); } catch (e) { res = { error: e }; }
    if (!res.error) return res.data;
    const retryable = /fetch|network|timeout/i.test(res.error.message || "");
    if (!retryable || i >= attempts - 1) throw res.error;
    await new Promise((r) => setTimeout(r, 700 * (i + 1)));
  }
}

// ───────── Premium : saisie rapide, brouillons de tâches, point hebdo ─────────
let marketingKeySeq = 0;
const marketingKey = () => "k" + ++marketingKeySeq;
// Brouillon de tâche (avant création du projet) : offset/gap gardent le calage sur la deadline.
function marketingDraftFromTemplate(tpl, deadline, assignee) {
  return tpl.tasks.map((tt) => {
    const gap = tt.relance ?? 2;
    const echeance = deadline ? marketingAddDays(deadline, tt.offset) : "";
    return { k: marketingKey(), titre: tt.titre, offset: tt.offset, gap, echeance, relance: echeance ? marketingAddDays(echeance, -gap) : "", assignee: assignee || "", priorite: tt.haute ? "Haute" : "Normale", dateEdited: false };
  });
}
function marketingDraftFromProject(project, tasks) {
  return tasks
    .filter((t) => t.project_id === project.id)
    .sort((a, b) => (a.echeance || "9999").localeCompare(b.echeance || "9999"))
    .map((t) => {
      const offset = project.deadline && t.echeance ? marketingDaysBetween(project.deadline, t.echeance) : null;
      const gap = t.echeance && t.relance ? marketingDaysBetween(t.relance, t.echeance) : null;
      return { k: marketingKey(), titre: t.titre, offset, gap, echeance: offset != null ? "" : t.echeance || "", relance: offset != null ? "" : t.relance || "", assignee: t.assignee || "", priorite: t.priorite || "Normale", dateEdited: false };
    });
}
// Quand la deadline change, les tâches calées dessus (et pas modifiées à la main) suivent.
function marketingRedateDraft(draft, deadline) {
  return draft.map((t) => {
    if (t.offset == null || t.dateEdited) return t;
    const echeance = deadline ? marketingAddDays(deadline, t.offset) : "";
    return { ...t, echeance, relance: echeance && t.gap != null ? marketingAddDays(echeance, -t.gap) : "" };
  });
}

// Texte prêt à coller (mail, WhatsApp, point d'équipe).
function marketingDigest({ tasks, projects, today, scopeLabel, risks }) {
  const todayDay = new Date(today + "T12:00:00").getDay();
  const monday = marketingAddDays(today, -((todayDay + 6) % 7));
  const weekEnd = marketingAddDays(today, 7);
  const open = tasks.filter((t) => t.statut !== "Fait");
  const who = (t) => (t.assignee ? ` (${t.assignee})` : "");
  const line = (t, extra) => `  • ${t.titre}${who(t)}${extra ? " — " + extra : ""}`;
  const doneWeek = tasks.filter((t) => t.statut === "Fait" && t.done_at && prospectionTodayISO(new Date(t.done_at)) >= monday);
  const late = open.filter((t) => t.echeance && t.echeance < today).sort((a, b) => a.echeance.localeCompare(b.echeance));
  const relances = open.filter((t) => t.relance && t.relance <= today);
  const upcoming = open.filter((t) => t.echeance && t.echeance >= today && t.echeance <= weekEnd).sort((a, b) => a.echeance.localeCompare(b.echeance));
  const activeProjects = projects.filter((p) => p.statut !== "Terminé").sort((a, b) => (a.deadline || "9999").localeCompare(b.deadline || "9999"));
  const out = [`Point marketing Ford Caen — ${marketingFrDate(today, true)}${scopeLabel ? " · " + scopeLabel : ""}`, ""];
  const block = (title, items, fmt) => { out.push(`${title} (${items.length})`); if (items.length) items.forEach((t) => out.push(fmt(t))); else out.push("  —"); out.push(""); };
  block("Terminé cette semaine", doneWeek, (t) => line(t));
  block("En retard", late, (t) => line(t, `échéance ${marketingFrDate(t.echeance)}`));
  block("Relances à faire", relances, (t) => line(t, `relance ${marketingFrDate(t.relance)}`));
  block("À venir (7 jours)", upcoming, (t) => line(t, marketingFrDate(t.echeance, true)));
  if (risks && risks.length) {
    out.push(`Projets en danger (${risks.length})`);
    risks.forEach((r) => out.push(`  • ${r.titre} — ${r.reasons.join(" ; ")}`));
    out.push("");
  }
  out.push(`Projets en cours (${activeProjects.length})`);
  activeProjects.forEach((p) => {
    const pr = marketingProjectProgress(p, tasks);
    out.push(`  • ${p.titre} — ${pr.done}/${pr.total} tâches${p.deadline ? ` — deadline ${marketingFrDate(p.deadline)} (${marketingRelativeLabel(p.deadline, today)})` : ""}`);
  });
  if (!activeProjects.length) out.push("  —");
  return out.join("\n");
}


// Retourne le nom du membre (ex. "Ophélie") si le compte connecté est dans marketing_members, sinon "".
// (RLS applique la vraie restriction côté base.)
function useMarketingAccess(userId) {
  const [nom, setNom] = useState("");
  useEffect(() => {
    let alive = true;
    if (!userId) { setNom(""); return; }
    supabase
      .from("marketing_members")
      .select("nom")
      .eq("user_id", userId)
      .maybeSingle()
      .then(({ data }) => { if (alive) setNom(data?.nom || ""); });
    return () => { alive = false; };
  }, [userId]);
  return nom;
}

function useMarketing() {
  const [projects, setProjects] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [members, setMembers] = useState([]);
  const [comments, setComments] = useState([]);
  const [links, setLinks] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [v2, setV2] = useState(true); // false tant que marketing_v2.sql n'est pas appliqué : on masque alors commentaires/liens/budget
  const v2Ref = useRef(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const timer = useRef(null);
  const lastSig = useRef("");

  const load = useCallback(async () => {
    const [p, t, m, c, l, x] = await Promise.all([
      supabase.from("marketing_projects").select("*").order("deadline", { ascending: true, nullsFirst: false }),
      supabase.from("marketing_tasks").select("*").order("echeance", { ascending: true, nullsFirst: false }).limit(5000),
      supabase.from("marketing_members").select("nom").order("nom"),
      supabase.from("marketing_comments").select("*").order("created_at", { ascending: true }).limit(5000),
      supabase.from("marketing_links").select("*").order("created_at", { ascending: true }).limit(5000),
      supabase.from("marketing_expenses").select("*").order("date_depense", { ascending: true }).limit(5000),
    ]);
    const err = p.error || t.error || m.error;
    if (err) { setError(err.message); setLoading(false); return; }
    const hasV2 = !(c.error || l.error || x.error);
    v2Ref.current = hasV2;
    const cRows = hasV2 ? c.data : [], lRows = hasV2 ? l.data : [], xRows = hasV2 ? x.data : [];
    const maxU = (rows) => rows.reduce((a, r) => (r.updated_at > a ? r.updated_at : a), "");
    const maxC = (rows) => rows.reduce((a, r) => (r.created_at > a ? r.created_at : a), "");
    const sumX = xRows.reduce((a, r) => a + Number(r.montant || 0), 0);
    const sig = `${p.data.length}:${maxU(p.data)}:${p.data.map((r) => r.budget ?? "").join(",")}|${t.data.length}:${maxU(t.data)}|${m.data.map((r) => r.nom).join(",")}|${hasV2}:${cRows.length}:${maxC(cRows)}|${lRows.length}:${maxC(lRows)}|${xRows.length}:${sumX}`;
    if (sig !== lastSig.current) {
      lastSig.current = sig;
      setProjects(p.data);
      setTasks(t.data);
      setMembers(m.data.map((r) => r.nom));
      setComments(cRows); setLinks(lRows); setExpenses(xRows); setV2(hasV2);
    }
    setError(null);
    setLoading(false);
  }, []);

  const scheduleLoad = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(load, 300);
  }, [load]);

  useEffect(() => {
    load();
    const ch = supabase
      .channel("marketing-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "marketing_projects" }, scheduleLoad)
      .on("postgres_changes", { event: "*", schema: "public", table: "marketing_tasks" }, scheduleLoad)
      .on("postgres_changes", { event: "*", schema: "public", table: "marketing_comments" }, scheduleLoad)
      .on("postgres_changes", { event: "*", schema: "public", table: "marketing_links" }, scheduleLoad)
      .on("postgres_changes", { event: "*", schema: "public", table: "marketing_expenses" }, scheduleLoad)
      .subscribe();
    return () => { clearTimeout(timer.current); supabase.removeChannel(ch); };
  }, [load, scheduleLoad]);

  const refresh = useCallback(async () => { lastSig.current = ""; await load(); }, [load]);

  // Crée ou met à jour un projet ; tasksToCreate = tâches issues d'un modèle (création uniquement).
  const saveProject = useCallback(async (p, tasksToCreate) => {
    const row = marketingCleanProject(p);
    if (!v2Ref.current) delete row.budget; // colonne absente tant que marketing_v2.sql n'est pas appliqué
    const data = await marketingExec(() =>
      p.id ? supabase.from("marketing_projects").update(row).eq("id", p.id).select().single() : supabase.from("marketing_projects").insert(row).select().single()
    );
    if (!p.id && tasksToCreate?.length) {
      const rows = tasksToCreate.map((t) => marketingCleanTask({ ...t, project_id: data.id }));
      await marketingExec(() => supabase.from("marketing_tasks").insert(rows));
    }
    await refresh();
    return data;
  }, [refresh]);

  const removeProject = useCallback(async (id) => {
    await marketingExec(() => supabase.from("marketing_projects").delete().eq("id", id));
    await refresh();
  }, [refresh]);

  // Crée ou met à jour une tâche (sans recharger). Quand une tâche récurrente passe à "Fait", la prochaine
  // occurrence est créée automatiquement (et la récurrence est portée par la nouvelle tâche, pas par l'ancienne).
  const saveTaskRaw = useCallback(async (t, previous) => {
    const row = marketingCleanTask(t);
    const nowDone = row.statut === "Fait";
    row.done_at = nowDone ? (previous?.statut === "Fait" ? previous.done_at : new Date().toISOString()) : null;
    let next = null;
    if (nowDone && previous && previous.statut !== "Fait" && row.recurrence) {
      next = marketingNextOccurrence(row);
      await marketingExec(() => supabase.from("marketing_tasks").insert(marketingCleanTask(next)));
      row.recurrence = null;
    }
    const data = await marketingExec(() =>
      t.id ? supabase.from("marketing_tasks").update(row).eq("id", t.id).select().single() : supabase.from("marketing_tasks").insert(row).select().single()
    );
    return { data, next };
  }, []);

  const saveTask = useCallback(async (t, previous) => {
    try { return await saveTaskRaw(t, previous); } finally { await refresh(); }
  }, [saveTaskRaw, refresh]);

  const toggleDone = useCallback((task) => saveTask({ ...task, statut: task.statut === "Fait" ? "À faire" : "Fait" }, task), [saveTask]);

  // Action groupée : items = [{ task, fields }] ; un seul rechargement à la fin.
  const bulkUpdate = useCallback(async (items) => {
    let done = 0;
    try {
      for (const { task, fields } of items) {
        if (fields.statut === "Fait" && task.statut !== "Fait") await saveTaskRaw({ ...task, ...fields }, task);
        else await marketingExec(() => supabase.from("marketing_tasks").update(fields).eq("id", task.id));
        done++;
      }
    } finally { await refresh(); }
    return done;
  }, [saveTaskRaw, refresh]);

  // ── v2 : commentaires, liens, dépenses ──
  const addComment = useCallback(async (task_id, texte, auteur) => {
    await marketingExec(() => supabase.from("marketing_comments").insert({ task_id, texte: String(texte).trim(), auteur: auteur || null }));
    await refresh();
  }, [refresh]);
  const removeComment = useCallback(async (id) => {
    await marketingExec(() => supabase.from("marketing_comments").delete().eq("id", id));
    await refresh();
  }, [refresh]);
  const addLink = useCallback(async ({ project_id, task_id, titre, url }) => {
    const clean = marketingNormalizeUrl(url);
    if (!clean) throw new Error("Lien invalide (il doit commencer par http:// ou https://)");
    await marketingExec(() => supabase.from("marketing_links").insert({ project_id: project_id || null, task_id: task_id || null, titre: (titre || "").trim() || null, url: clean }));
    await refresh();
  }, [refresh]);
  const removeLink = useCallback(async (id) => {
    await marketingExec(() => supabase.from("marketing_links").delete().eq("id", id));
    await refresh();
  }, [refresh]);
  const addExpense = useCallback(async (project_id, libelle, montant) => {
    const m = marketingParseAmount(montant);
    if (!(libelle || "").trim() || m === null) throw new Error("Indiquez un libellé et un montant valide");
    await marketingExec(() => supabase.from("marketing_expenses").insert({ project_id, libelle: libelle.trim(), montant: m }));
    await refresh();
  }, [refresh]);
  const removeExpense = useCallback(async (id) => {
    await marketingExec(() => supabase.from("marketing_expenses").delete().eq("id", id));
    await refresh();
  }, [refresh]);

  const patchTask = useCallback(async (id, fields) => {
    await marketingExec(() => supabase.from("marketing_tasks").update(fields).eq("id", id));
    await refresh();
  }, [refresh]);

  const removeTask = useCallback(async (id) => {
    await marketingExec(() => supabase.from("marketing_tasks").delete().eq("id", id));
    await refresh();
  }, [refresh]);

  return { projects, tasks, members, comments, links, expenses, v2, loading, error, addComment, removeComment, addLink, removeLink, addExpense, removeExpense, saveProject, removeProject, saveTask, toggleDone, bulkUpdate, patchTask, removeTask, reload: refresh };
}


function marketingStyles(dark) {
  return {
    input: `w-full rounded-lg border px-3 py-2 text-sm outline-none transition-shadow focus:ring-2 ${dark ? "bg-zinc-950 border-zinc-800 text-zinc-200 focus:ring-blue-700/30 focus:border-blue-700/40" : "bg-white border-stone-200 text-stone-700 focus:ring-blue-700/20 focus:border-blue-500"}`,
    label: `mb-1 text-[11px] font-bold uppercase tracking-widest ${dark ? "text-zinc-500" : "text-stone-400"}`,
    card: dark ? "border-zinc-800 bg-zinc-900/40" : "border-stone-200 bg-white",
    title: dark ? "text-zinc-100" : "text-stone-800",
    sub: dark ? "text-zinc-500" : "text-stone-400",
    muted: dark ? "text-zinc-400" : "text-stone-500",
    ghostBtn: `pl-interactive rounded-lg border px-3 py-1.5 text-sm font-semibold transition-colors ${dark ? "border-zinc-700 text-zinc-200 hover:bg-zinc-800" : "border-stone-300 text-stone-700 hover:bg-stone-100"}`,
    primaryBtn: "pl-interactive rounded-lg bg-blue-700 px-3.5 py-2 text-sm font-bold text-white transition-colors hover:bg-blue-500 disabled:opacity-50",
  };
}

function MarketingDateChip({ dark, kind, iso, today, done }) {
  if (!iso) return null;
  const late = !done && iso < today;
  const isToday = !done && iso === today;
  const base = "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold";
  let tone;
  if (kind === "relance") {
    tone = done ? (dark ? "bg-zinc-800 text-zinc-500" : "bg-stone-100 text-stone-400")
      : late || isToday ? (dark ? "bg-amber-500/20 text-amber-300" : "bg-amber-100 text-amber-800")
      : dark ? "bg-zinc-800 text-zinc-300" : "bg-stone-100 text-stone-600";
  } else {
    tone = done ? (dark ? "bg-zinc-800 text-zinc-500" : "bg-stone-100 text-stone-400")
      : late ? (dark ? "bg-rose-500/20 text-rose-300" : "bg-rose-100 text-rose-700")
      : isToday ? (dark ? "bg-blue-500/20 text-blue-300" : "bg-blue-100 text-blue-800")
      : dark ? "bg-zinc-800 text-zinc-300" : "bg-stone-100 text-stone-600";
  }
  return (
    <span className={`${base} ${tone}`}>
      {kind === "relance" ? <BellRing size={11} /> : <CalendarClock size={11} />}
      {kind === "relance" ? "Relance " : ""}{marketingFrDate(iso)}
    </span>
  );
}

function MarketingTaskRow({ dark, t, project, today, onToggle, onOpen, onRelance, onReschedule, selectable, selected, onSelect, showProject = true, commentCount = 0, linkCount = 0 }) {
  const s = marketingStyles(dark);
  const done = t.statut === "Fait";
  const relanceDue = !done && t.relance && t.relance <= today;
  const late = !done && t.echeance && t.echeance < today;
  const miniBtn = `rounded-md border px-2 py-0.5 font-semibold ${dark ? "border-zinc-700 text-zinc-300 hover:bg-zinc-800" : "border-stone-300 text-stone-600 hover:bg-stone-100"}`;
  return (
    <div
      onClick={() => onOpen(t.id)}
      className={`pl-interactive flex cursor-pointer items-start gap-3 rounded-xl border px-3 py-2.5 ${selected ? (dark ? "border-blue-600 bg-blue-500/10" : "border-blue-500 bg-blue-50") : s.card} ${dark ? "hover:border-zinc-700" : "hover:border-stone-300"}`}
    >
      {selectable && (
        <input
          type="checkbox"
          aria-label="Sélectionner la tâche"
          checked={!!selected}
          onClick={(e) => e.stopPropagation()}
          onChange={() => onSelect(t.id)}
          className="mt-1 h-4 w-4 shrink-0 cursor-pointer accent-blue-700"
        />
      )}
      <button
        type="button"
        aria-label={done ? "Rouvrir la tâche" : "Marquer comme faite"}
        onClick={(e) => { e.stopPropagation(); onToggle(t); }}
        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${done ? "border-emerald-500 bg-emerald-500 text-white" : dark ? "border-zinc-600 hover:border-blue-500" : "border-stone-300 hover:border-blue-600"}`}
      >
        {done && <Check size={12} strokeWidth={3} />}
      </button>
      <div className="min-w-0 flex-1">
        <div className={`flex flex-wrap items-center gap-x-2 text-sm font-medium ${done ? "line-through " + s.sub : s.title}`}>
          <span className="min-w-0 break-words">{t.titre}</span>
          {t.priorite === "Haute" && !done && <Flag size={12} className="shrink-0 text-rose-500" aria-label="Priorité haute" />}
          {t.recurrence && <Repeat size={12} className={`shrink-0 ${s.sub}`} aria-label={MARKETING_RECURRENCE_LABEL[t.recurrence]} />}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          <MarketingDateChip dark={dark} kind="echeance" iso={t.echeance} today={today} done={done} />
          <MarketingDateChip dark={dark} kind="relance" iso={t.relance} today={today} done={done} />
          {showProject && project && (
            <span className={`max-w-[200px] truncate rounded-full px-2 py-0.5 text-[11px] ${dark ? "bg-zinc-800 text-zinc-400" : "bg-stone-100 text-stone-500"}`}>{project.titre}</span>
          )}
          {commentCount > 0 && <span className={`inline-flex items-center gap-0.5 text-[11px] ${s.sub}`} title={`${commentCount} commentaire${commentCount > 1 ? "s" : ""}`}><MessageSquare size={11} />{commentCount}</span>}
          {linkCount > 0 && <span className={`inline-flex items-center gap-0.5 text-[11px] ${s.sub}`} title={`${linkCount} lien${linkCount > 1 ? "s" : ""}`}><Paperclip size={11} />{linkCount}</span>}
        </div>
        {relanceDue && onRelance && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]" onClick={(e) => e.stopPropagation()}>
            <span className={s.sub}>Relancé ?</span>
            {[["Reporter +2 j", 2], ["+1 sem", 7], ["Clore", 0]].map(([l, d]) => (
              <button key={l} type="button" onClick={() => onRelance(t, d)} className={miniBtn}>{l}</button>
            ))}
          </div>
        )}
        {late && onReschedule && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]" onClick={(e) => e.stopPropagation()}>
            <span className={s.sub}>Replanifier :</span>
            {[["Aujourd'hui", 0], ["Demain", 1], ["+1 sem", 7]].map(([l, d]) => (
              <button key={l} type="button" onClick={() => onReschedule(t, d)} className={miniBtn}>{l}</button>
            ))}
          </div>
        )}
      </div>
      {t.assignee ? (
        <span title={t.assignee} className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${dark ? "bg-blue-500/20 text-blue-300" : "bg-blue-100 text-blue-800"}`}>{prospectionInitials(t.assignee)}</span>
      ) : (
        <span title="Non attribuée" className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-dashed text-[10px] ${dark ? "border-zinc-700 text-zinc-600" : "border-stone-300 text-stone-400"}`}>?</span>
      )}
    </div>
  );
}

function MarketingDrawer({ dark, onClose, z = "z-50", children, title, right }) {
  const s = marketingStyles(dark);
  return (
    <div className={`fixed inset-0 ${z} flex justify-end bg-black/40`} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" className={`pl-fade-in h-full w-full max-w-xl overflow-y-auto p-5 shadow-xl ${dark ? "bg-zinc-950" : "bg-stone-50"}`}>
        <div className="mb-4 flex items-start justify-between gap-3">
          <h2 className={`min-w-0 break-words text-xl font-bold ${dark ? "text-zinc-50" : "text-stone-900"}`}>{title}</h2>
          <div className="flex shrink-0 items-center gap-2">
            {right}
            <button onClick={onClose} aria-label="Fermer" className={`rounded-lg p-1.5 transition-colors ${dark ? "text-zinc-400 hover:bg-zinc-800" : "text-stone-500 hover:bg-stone-100"}`}><X size={16} /></button>
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}

async function marketingCopy(txt, showToast, okMsg) {
  try {
    await navigator.clipboard.writeText(txt);
    showToast(okMsg);
    return;
  } catch (e) { /* repli ci-dessous */ }
  try {
    const ta = document.createElement("textarea");
    ta.value = txt; document.body.appendChild(ta); ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    showToast(ok ? okMsg : "Copie impossible", { type: ok ? "success" : "error" });
  } catch (e2) { showToast("Copie impossible", { type: "error" }); }
}

function MarketingLinksSection({ dark, links, onAdd, onRemove, showToast }) {
  const s = marketingStyles(dark);
  const [titre, setTitre] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const add = async () => {
    if (!url.trim()) return;
    if (!marketingNormalizeUrl(url)) { showToast("Lien invalide : il doit commencer par http:// ou https://", { type: "error" }); return; }
    setBusy(true);
    try { await onAdd({ titre, url }); setTitre(""); setUrl(""); }
    catch (e) { showToast(`Ajout impossible : ${e.message || e}`, { type: "error" }); }
    finally { setBusy(false); }
  };
  const remove = async (id) => {
    try { await onRemove(id); } catch (e) { showToast(`Suppression impossible : ${e.message || e}`, { type: "error" }); }
  };
  return (
    <div>
      <div className={`mb-2 text-xs font-bold uppercase tracking-widest ${s.sub}`}>Liens & documents ({links.length})</div>
      {links.length === 0 && <div className={`mb-2 text-sm ${s.sub}`}>Aucun lien. Collez l'adresse d'un Drive, d'un devis, d'un visuel…</div>}
      <ul className="space-y-1.5">
        {links.map((l) => (
          <li key={l.id} className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${s.card}`}>
            <Paperclip size={13} className={`shrink-0 ${s.sub}`} />
            <a href={l.url} target="_blank" rel="noopener noreferrer" className={`min-w-0 flex-1 truncate font-medium underline-offset-2 hover:underline ${dark ? "text-blue-400" : "text-blue-800"}`}>{l.titre || l.url}</a>
            <ExternalLink size={12} className={`shrink-0 ${s.sub}`} />
            <button type="button" aria-label="Retirer le lien" onClick={() => remove(l.id)} className={`shrink-0 rounded p-1 ${dark ? "text-zinc-500 hover:text-rose-400" : "text-stone-400 hover:text-rose-600"}`}><X size={13} /></button>
          </li>
        ))}
      </ul>
      <div className="mt-2 flex flex-wrap gap-2">
        <input className={`${s.input} min-w-[120px] flex-1`} placeholder="Nom (facultatif)" value={titre} onChange={(e) => setTitre(e.target.value)} />
        <input className={`${s.input} min-w-[160px] flex-[2]`} placeholder="https://…" value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
        <button type="button" onClick={add} disabled={busy} className={s.primaryBtn} aria-label="Ajouter le lien"><Plus size={16} /></button>
      </div>
    </div>
  );
}

function MarketingCommentsSection({ dark, comments, me, onAdd, onRemove, showToast }) {
  const s = marketingStyles(dark);
  const [txt, setTxt] = useState("");
  const [busy, setBusy] = useState(false);
  const add = async () => {
    const t = txt.trim();
    if (!t) return;
    setBusy(true);
    try { await onAdd(t); setTxt(""); }
    catch (e) { showToast(`Commentaire non enregistré : ${e.message || e}`, { type: "error" }); }
    finally { setBusy(false); }
  };
  const remove = async (id) => {
    try { await onRemove(id); } catch (e) { showToast(`Suppression impossible : ${e.message || e}`, { type: "error" }); }
  };
  const when = (iso) => new Date(iso).toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  return (
    <div>
      <div className={`mb-2 text-xs font-bold uppercase tracking-widest ${s.sub}`}>Commentaires ({comments.length})</div>
      <ul className="space-y-2">
        {comments.map((c) => (
          <li key={c.id} className={`rounded-xl border px-3 py-2 text-sm ${s.card}`}>
            <div className={`mb-0.5 flex items-center gap-2 text-[11px] ${s.sub}`}>
              <span className="font-semibold">{c.auteur || "—"}</span>
              <span>{when(c.created_at)}</span>
              {c.auteur === me && (
                <button type="button" aria-label="Supprimer le commentaire" onClick={() => remove(c.id)} className={`ml-auto rounded p-0.5 ${dark ? "hover:text-rose-400" : "hover:text-rose-600"}`}><X size={12} /></button>
              )}
            </div>
            <div className={`whitespace-pre-wrap break-words ${s.title}`}>{c.texte}</div>
          </li>
        ))}
        {comments.length === 0 && <li className={`text-sm ${s.sub}`}>Aucun commentaire — notez ici où en est la tâche.</li>}
      </ul>
      <div className="mt-2 flex gap-2">
        <textarea rows={2} className={s.input} placeholder="Ajouter un commentaire…" value={txt} onChange={(e) => setTxt(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) add(); }} />
        <button type="button" onClick={add} disabled={busy || !txt.trim()} className={`${s.primaryBtn} self-start`}>Publier</button>
      </div>
    </div>
  );
}

function MarketingBudgetSection({ dark, project, expenses, onAdd, onRemove, showToast }) {
  const s = marketingStyles(dark);
  const [libelle, setLibelle] = useState("");
  const [montant, setMontant] = useState("");
  const [busy, setBusy] = useState(false);
  const b = marketingBudgetState(project, expenses);
  const mine = expenses.filter((x) => x.project_id === project.id);
  const add = async () => {
    if (!libelle.trim() && !montant.trim()) return;
    setBusy(true);
    try { await onAdd(libelle, montant); setLibelle(""); setMontant(""); }
    catch (e) { showToast(e.message || String(e), { type: "error" }); }
    finally { setBusy(false); }
  };
  const remove = async (id) => {
    try { await onRemove(id); } catch (e) { showToast(`Suppression impossible : ${e.message || e}`, { type: "error" }); }
  };
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <div className={`text-xs font-bold uppercase tracking-widest ${s.sub}`}>Budget</div>
        <div className={`text-sm font-semibold ${b.over ? "text-rose-500" : s.title}`}>
          {marketingEuro(b.depense)}{b.prevu != null ? ` / ${marketingEuro(b.prevu)}` : ""}
        </div>
      </div>
      {b.prevu != null && (
        <>
          <div className={`h-2 overflow-hidden rounded-full ${dark ? "bg-zinc-800" : "bg-stone-100"}`}>
            <div className={`h-full rounded-full ${b.over ? "bg-rose-500" : b.pct >= 85 ? "bg-amber-500" : "bg-emerald-500"}`} style={{ width: `${b.pct}%` }} />
          </div>
          <div className={`mt-1 text-xs ${b.over ? "font-semibold text-rose-500" : s.sub}`}>
            {b.over ? `Dépassement de ${marketingEuro(-b.reste)}` : `Reste ${marketingEuro(b.reste)}`}
          </div>
        </>
      )}
      {b.prevu == null && <div className={`text-xs ${s.sub}`}>Renseignez un « Budget prévu » plus haut pour suivre le reste à dépenser.</div>}
      <ul className="mt-2 space-y-1.5">
        {mine.map((x) => (
          <li key={x.id} className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm ${s.card}`}>
            <span className={`min-w-0 flex-1 truncate ${s.title}`}>{x.libelle}</span>
            <span className={`shrink-0 text-xs ${s.sub}`}>{marketingFrDate(x.date_depense)}</span>
            <span className={`shrink-0 font-semibold ${s.title}`}>{marketingEuro(x.montant)}</span>
            <button type="button" aria-label="Retirer la dépense" onClick={() => remove(x.id)} className={`shrink-0 rounded p-1 ${dark ? "text-zinc-500 hover:text-rose-400" : "text-stone-400 hover:text-rose-600"}`}><X size={13} /></button>
          </li>
        ))}
      </ul>
      <div className="mt-2 flex flex-wrap gap-2">
        <input className={`${s.input} min-w-[140px] flex-[2]`} placeholder="Dépense (ex. Bâches salon)" value={libelle} onChange={(e) => setLibelle(e.target.value)} />
        <input className={`${s.input} !w-28`} inputMode="decimal" placeholder="Montant €" value={montant} onChange={(e) => setMontant(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
        <button type="button" onClick={add} disabled={busy} className={s.primaryBtn} aria-label="Ajouter la dépense"><Plus size={16} /></button>
      </div>
    </div>
  );
}

function MarketingBilanPanel({ dark, bilan, onCopy, onClose }) {
  const s = marketingStyles(dark);
  const stat = (label, value, tone) => (
    <div className={`rounded-xl border px-3 py-2 ${s.card}`}>
      <div className={`text-lg font-bold ${tone || s.title}`}>{value}</div>
      <div className={`text-[11px] ${s.sub}`}>{label}</div>
    </div>
  );
  const b = bilan;
  return (
    <div className={`rounded-2xl border p-4 ${dark ? "border-emerald-500/30 bg-emerald-500/5" : "border-emerald-300 bg-emerald-50/60"}`}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className={`text-sm font-bold ${s.title}`}>Bilan du projet</div>
        <div className="flex gap-2">
          <button type="button" onClick={onCopy} className={s.ghostBtn}>Copier le bilan</button>
          <button type="button" onClick={onClose} aria-label="Masquer le bilan" className={`rounded-lg p-1.5 ${dark ? "text-zinc-400 hover:bg-zinc-800" : "text-stone-500 hover:bg-white"}`}><X size={14} /></button>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {stat("Tâches faites", `${b.done}/${b.total}`, b.pct === 100 ? "text-emerald-600" : "")}
        {stat("Durée", `${b.dureeJours} j`)}
        {stat("Deadline", !b.deadline ? "—" : b.retardDeadline > 0 ? `+${b.retardDeadline} j` : "Respectée", b.retardDeadline > 0 ? "text-rose-500" : b.deadline ? "text-emerald-600" : "")}
        {stat("Budget", b.budget.prevu != null || b.budget.depense ? marketingEuro(b.budget.depense) : "—", b.budget.over ? "text-rose-500" : "")}
      </div>
      <div className={`mt-3 space-y-1 text-sm ${s.muted}`}>
        <div>Période : {marketingFrDate(b.debut)} → {marketingFrDate(b.fin)}{b.deadline ? ` · deadline ${marketingFrDate(b.deadline)}` : ""}</div>
        {b.doneLate > 0 && <div>{b.doneLate} tâche{b.doneLate > 1 ? "s" : ""} terminée{b.doneLate > 1 ? "s" : ""} après son échéance.</div>}
        {b.open > 0 && <div>{b.open} tâche{b.open > 1 ? "s" : ""} non terminée{b.open > 1 ? "s" : ""} : {b.openTitles.join(", ")}.</div>}
        {b.budget.prevu != null && <div>Budget prévu {marketingEuro(b.budget.prevu)} — {b.budget.over ? `dépassement de ${marketingEuro(-b.budget.reste)}` : `reste ${marketingEuro(b.budget.reste)}`}.</div>}
        {b.personnes.length > 0 && <div>{b.personnes.map((p) => `${p.nom} ${p.faites}/${p.total}`).join(" · ")}</div>}
        <div>{b.nbLiens} document{b.nbLiens > 1 ? "s" : ""} lié{b.nbLiens > 1 ? "s" : ""} · {b.nbCommentaires} commentaire{b.nbCommentaires > 1 ? "s" : ""}</div>
      </div>
    </div>
  );
}

function MarketingTaskFiche({ dark, taskId, tasks, projects, members, prefill, me, ext, onClose, onSave, onDelete, showToast }) {
  const s = marketingStyles(dark);
  const isNew = taskId === "new";
  const today = prospectionTodayISO();
  // Relu en direct par identifiant : si l'autre personne supprime la tâche pendant qu'elle est ouverte, on ferme.
  const live = isNew ? null : tasks.find((x) => x.id === taskId);
  const [p, setP] = useState(() => (isNew ? { statut: "À faire", priorite: "Normale", assignee: me || "", ...prefill } : live));
  const [saving, setSaving] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const set = (k) => (e) => setP((x) => ({ ...x, [k]: e.target.value }));

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  useEffect(() => { if (!isNew && !live) onClose(); }, [isNew, live, onClose]);
  if (!p) return null;

  const save = async () => {
    if (!(p.titre || "").trim()) { showToast("Donnez un titre à la tâche", { type: "error" }); return; }
    setSaving(true);
    try {
      const { next } = await onSave(p, isNew ? undefined : live);
      showToast(next ? `Tâche enregistrée · prochaine occurrence le ${marketingFrDate(next.echeance)}` : "Tâche enregistrée");
      onClose();
    } catch (e) {
      showToast(`Échec de l'enregistrement : ${e.message || e}`, { type: "error" });
    } finally { setSaving(false); }
  };
  const del = async () => {
    if (!deleteConfirm) { setDeleteConfirm(true); return; }
    try { await onDelete(p.id); showToast("Tâche supprimée"); onClose(); }
    catch (e) { showToast(`Suppression impossible : ${e.message || e}`, { type: "error" }); }
  };
  const relanceAfter = p.relance && p.echeance && p.relance > p.echeance;

  return (
    <MarketingDrawer dark={dark} onClose={onClose} z="z-[60]" title={isNew ? "Nouvelle tâche" : "Tâche"}>
      <div className="space-y-4">
        <div>
          <div className={s.label}>Titre *</div>
          <input autoFocus={isNew} className={s.input} value={p.titre || ""} onChange={set("titre")} placeholder="Ex. Relancer l'agence pour les visuels" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className={s.label}>Projet</div>
            <select className={s.input} value={p.project_id || ""} onChange={set("project_id")}>
              <option value="">Sans projet</option>
              {projects.map((pr) => <option key={pr.id} value={pr.id}>{pr.titre}</option>)}
            </select>
          </div>
          <div>
            <div className={s.label}>Attribuée à</div>
            <select className={s.input} value={p.assignee || ""} onChange={set("assignee")}>
              <option value="">Non attribuée</option>
              {members.map((m) => <option key={m}>{m}</option>)}
            </select>
          </div>
          <div>
            <div className={s.label}>Statut</div>
            <select className={s.input} value={p.statut} onChange={set("statut")}>
              {MARKETING_TASK_STATUTS.map((x) => <option key={x}>{x}</option>)}
            </select>
          </div>
          <div>
            <div className={s.label}>Priorité</div>
            <select className={s.input} value={p.priorite} onChange={set("priorite")}>
              <option>Normale</option>
              <option>Haute</option>
            </select>
          </div>
          <div>
            <div className={s.label}>Échéance</div>
            <input type="date" className={s.input} value={p.echeance || ""} onChange={set("echeance")} />
          </div>
          <div>
            <div className={s.label}>Relance</div>
            <input type="date" className={s.input} value={p.relance || ""} onChange={set("relance")} />
          </div>
        </div>
        <div className="-mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
          <span className={s.sub}>Relance rapide :</span>
          {[["Demain", 1], ["+3 j", 3], ["+1 sem", 7]].map(([l, d]) => (
            <button key={l} type="button" onClick={() => setP((x) => ({ ...x, relance: marketingAddDays(today, d) }))} className={`rounded-md border px-2 py-0.5 font-semibold ${dark ? "border-zinc-700 text-zinc-300 hover:bg-zinc-800" : "border-stone-300 text-stone-600 hover:bg-stone-100"}`}>{l}</button>
          ))}
          {p.relance && <button type="button" onClick={() => setP((x) => ({ ...x, relance: "" }))} className={`rounded-md px-2 py-0.5 font-semibold ${s.muted} underline`}>Effacer</button>}
        </div>
        {relanceAfter && <div className={`text-xs ${dark ? "text-amber-400" : "text-amber-700"}`}>La relance est après l'échéance : pensez à la rapprocher.</div>}
        <div>
          <div className={s.label}>Répéter</div>
          <select className={s.input} value={p.recurrence || ""} onChange={set("recurrence")}>
            {MARKETING_RECURRENCES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          {p.recurrence && <div className={`mt-1 text-xs ${s.sub}`}>Quand vous la cochez « Fait », la suivante se crée toute seule (même écart pour la relance).</div>}
        </div>
        <div>
          <div className={s.label}>Notes</div>
          <textarea rows={4} className={s.input} value={p.notes || ""} onChange={set("notes")} placeholder="Détails, contacts…" />
        </div>
        {!isNew && ext?.v2 && (
          <>
            <MarketingLinksSection dark={dark} links={ext.links.filter((l) => l.task_id === taskId)} onAdd={(x) => ext.addLink({ ...x, task_id: taskId })} onRemove={ext.removeLink} showToast={showToast} />
            <MarketingCommentsSection dark={dark} comments={ext.comments.filter((c) => c.task_id === taskId)} me={me} onAdd={(t) => ext.addComment(taskId, t, me)} onRemove={ext.removeComment} showToast={showToast} />
          </>
        )}
        <div className="flex items-center gap-2 pt-2">
          <button onClick={save} disabled={saving} className={s.primaryBtn}>{saving ? "Enregistrement…" : "Enregistrer"}</button>
          <button onClick={onClose} className={s.ghostBtn}>Annuler</button>
          {!isNew && (
            <button onClick={del} className={`ml-auto rounded-lg px-3 py-1.5 text-sm font-semibold ${deleteConfirm ? "bg-rose-600 text-white" : dark ? "text-rose-400 hover:bg-zinc-800" : "text-rose-600 hover:bg-rose-50"}`}>
              {deleteConfirm ? "Confirmer la suppression" : "Supprimer"}
            </button>
          )}
        </div>
      </div>
    </MarketingDrawer>
  );
}


function MarketingProjectFiche({ dark, projectId, duplicateOf, premium, projects, tasks, members, me, ext, blocked, onClose, onSave, onDelete, onDuplicate, onOpenTask, onNewTask, onToggleTask, onQuickAddTask, showToast }) {
  const s = marketingStyles(dark);
  const isNew = projectId === "new";
  const today = prospectionTodayISO();
  const live = isNew ? null : projects.find((x) => x.id === projectId);
  const source = isNew && duplicateOf ? projects.find((x) => x.id === duplicateOf) : null;
  const [p, setP] = useState(() => {
    if (!isNew) return live;
    if (source) return { titre: `${source.titre} (copie)`, description: source.description || "", categorie: source.categorie || "", responsable: source.responsable || me || "", statut: "À lancer", deadline: "" };
    return { titre: "", statut: "À lancer", responsable: me || "", deadline: "", categorie: "", description: "" };
  });
  const [draft, setDraft] = useState(() => (source ? marketingDraftFromProject(source, tasks) : []));
  const [tplId, setTplId] = useState("");
  const [draftInput, setDraftInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [quick, setQuick] = useState("");
  const [showBilan, setShowBilan] = useState(false);
  const set = (k) => (e) => setP((x) => ({ ...x, [k]: e.target.value }));

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape" && !blocked) onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, blocked]);
  useEffect(() => { if (!isNew && !live) onClose(); }, [isNew, live, onClose]);
  if (!p) return null;

  const myTasks = isNew ? [] : tasks.filter((t) => t.project_id === projectId);
  const sorted = [...myTasks].sort((a, b) => (a.statut === "Fait") - (b.statut === "Fait") || (a.echeance || "9999").localeCompare(b.echeance || "9999"));
  const prog = isNew ? null : marketingProjectProgress(live, tasks);
  const v2 = !!ext?.v2;
  const risk = isNew ? { level: "", reasons: [] } : marketingProjectRisk(live, tasks, today, v2 ? ext.expenses : undefined);
  const bilan = !isNew && v2 ? marketingBilan({ project: live, tasks, expenses: ext.expenses, links: ext.links, comments: ext.comments, today }) : !isNew ? marketingBilan({ project: live, tasks, expenses: [], links: [], comments: [], today }) : null;
  const allDone = !isNew && prog.total > 0 && prog.open === 0 && live.statut !== "Terminé";

  const changeDeadline = (e) => {
    const deadline = e.target.value;
    setP((x) => ({ ...x, deadline }));
    setDraft((d) => marketingRedateDraft(d, deadline));
  };
  const pickTemplate = (id) => {
    setTplId(id);
    const t = MARKETING_TEMPLATES.find((x) => x.id === id);
    if (!t) { setDraft([]); return; }
    setP((x) => ({ ...x, categorie: x.categorie || t.categorie, titre: x.titre || t.label }));
    setDraft(marketingDraftFromTemplate(t, p.deadline, p.responsable));
  };
  const updateDraft = (k, patch) => setDraft((d) => d.map((t) => (t.k === k ? { ...t, ...patch } : t)));
  const changeDraftDate = (t, echeance) => {
    const gapRelance = t.gap != null && echeance ? marketingAddDays(echeance, -t.gap) : t.relance;
    updateDraft(t.k, { echeance, relance: gapRelance, dateEdited: true });
  };
  const addDraft = () => {
    const raw = draftInput.trim();
    if (!raw) return;
    const item = { titre: raw, echeance: "", relance: "", assignee: p.responsable || "", priorite: "Normale" };
    setDraft((d) => [...d, { k: marketingKey(), offset: null, gap: null, dateEdited: true, ...item }]);
    setDraftInput("");
  };

  const save = async () => {
    if (!(p.titre || "").trim()) { showToast("Donnez un nom au projet", { type: "error" }); return; }
    const rows = draft.filter((t) => (t.titre || "").trim()).map(({ titre, echeance, relance, assignee, priorite }) => ({ titre, echeance, relance, assignee, priorite }));
    setSaving(true);
    try {
      const finishing = !isNew && live.statut !== "Terminé" && p.statut === "Terminé";
      await onSave(p, rows);
      if (finishing) {
        showToast("Projet terminé — le bilan est prêt", { type: "celebrate" });
        setShowBilan(true);
      } else {
        showToast(isNew && rows.length ? `Projet créé avec ${rows.length} tâche${rows.length > 1 ? "s" : ""}` : "Projet enregistré");
        onClose();
      }
    } catch (e) {
      showToast(`Échec de l'enregistrement : ${e.message || e}`, { type: "error" });
    } finally { setSaving(false); }
  };
  const del = async () => {
    if (!deleteConfirm) { setDeleteConfirm(true); return; }
    try { await onDelete(p.id); showToast("Projet supprimé"); onClose(); }
    catch (e) { showToast(`Suppression impossible : ${e.message || e}`, { type: "error" }); }
  };
  const finishProject = async () => {
    setSaving(true);
    try {
      await onSave({ ...p, statut: "Terminé" }, []);
      setP((x) => ({ ...x, statut: "Terminé" }));
      setShowBilan(true);
      showToast("Projet terminé — le bilan est prêt", { type: "celebrate" });
    } catch (e) { showToast(`Action impossible : ${e.message || e}`, { type: "error" }); }
    finally { setSaving(false); }
  };
  const addQuick = async () => {
    const raw = quick.trim();
    if (!raw) return;
    setQuick("");
    const fields = { titre: raw, assignee: p.responsable || me };
    try { await onQuickAddTask(projectId, fields); }
    catch (e) { setQuick(raw); showToast(`Ajout impossible : ${e.message || e}`, { type: "error" }); }
  };

  const lateDraft = draft.filter((t) => t.echeance && t.echeance < today).length;
  const needsDeadline = !p.deadline && draft.some((t) => t.offset != null);
  const miniSel = `${s.input} !w-auto`;

  return (
    <MarketingDrawer
      dark={dark}
      onClose={onClose}
      title={isNew ? (source ? "Dupliquer le projet" : "Nouveau projet") : live.titre}
      right={!isNew && (
        <>
          <button type="button" onClick={() => setShowBilan((v) => !v)} className={s.ghostBtn}>Bilan</button>
          <button type="button" onClick={() => onDuplicate(projectId)} className={s.ghostBtn}>Dupliquer</button>
        </>
      )}
    >
      <div className="space-y-4">
        {!isNew && risk.level && (
          <div role="alert" className={`flex gap-2 rounded-xl border px-3 py-2.5 text-sm ${risk.level === "late" ? (dark ? "border-rose-500/40 bg-rose-500/10 text-rose-200" : "border-rose-300 bg-rose-50 text-rose-800") : (dark ? "border-amber-500/40 bg-amber-500/10 text-amber-200" : "border-amber-300 bg-amber-50 text-amber-900")}`}>
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <div>
              <div className="font-semibold">{risk.level === "late" ? "Projet en retard" : "Projet en danger"}</div>
              <ul className="list-disc pl-4">{risk.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
            </div>
          </div>
        )}
        {allDone && (
          <div className={`flex flex-wrap items-center gap-3 rounded-xl border px-3 py-2.5 text-sm ${dark ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200" : "border-emerald-300 bg-emerald-50 text-emerald-900"}`}>
            <span className="min-w-0 flex-1">Toutes les tâches sont faites : clôturer le projet ?</span>
            <button type="button" onClick={finishProject} disabled={saving} className={s.primaryBtn}>Terminer et voir le bilan</button>
          </div>
        )}
        {!isNew && showBilan && bilan && (
          <MarketingBilanPanel dark={dark} bilan={bilan} onClose={() => setShowBilan(false)} onCopy={() => marketingCopy(marketingBilanText(bilan), showToast, "Bilan copié — prêt à coller")} />
        )}
        {isNew && !source && (
          <div>
            <div className={s.label}>Partir d'un modèle (optionnel)</div>
            <div className="grid gap-2 sm:grid-cols-2">
              {[{ id: "", label: "Projet vide", desc: "Vous ajoutez vos propres tâches" }, ...MARKETING_TEMPLATES].map((t) => (
                <button
                  key={t.id || "vide"}
                  type="button"
                  onClick={() => pickTemplate(t.id)}
                  className={`pl-interactive rounded-xl border p-3 text-left ${tplId === t.id ? "border-blue-600 ring-2 ring-blue-600/20" : dark ? "border-zinc-800 hover:border-zinc-700" : "border-stone-200 hover:border-stone-300"} ${dark ? "bg-zinc-900/40" : "bg-white"}`}
                >
                  <div className={`text-sm font-semibold ${s.title}`}>{t.label}</div>
                  <div className={`mt-0.5 text-xs ${s.sub}`}>{t.desc}</div>
                </button>
              ))}
            </div>
          </div>
        )}

        <div>
          <div className={s.label}>Nom du projet *</div>
          <input autoFocus={isNew} className={s.input} value={p.titre || ""} onChange={set("titre")} placeholder="Ex. Portes ouvertes Transit — novembre" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className={s.label}>Deadline</div>
            <input type="date" className={s.input} value={p.deadline || ""} onChange={changeDeadline} />
          </div>
          <div>
            <div className={s.label}>Statut</div>
            <select className={s.input} value={p.statut} onChange={set("statut")}>
              {MARKETING_PROJECT_STATUTS.map((x) => <option key={x}>{x}</option>)}
            </select>
          </div>
          <div>
            <div className={s.label}>Responsable</div>
            <select className={s.input} value={p.responsable || ""} onChange={set("responsable")}>
              <option value="">—</option>
              {members.map((m) => <option key={m}>{m}</option>)}
            </select>
          </div>
          <div>
            <div className={s.label}>Catégorie (libre)</div>
            <input className={s.input} list="marketing-categories" value={p.categorie || ""} onChange={set("categorie")} placeholder="Choisir ou écrire…" />
            <datalist id="marketing-categories">{MARKETING_CATEGORIES.map((x) => <option key={x} value={x} />)}</datalist>
          </div>
          {v2 && (
            <div>
              <div className={s.label}>Budget prévu (€)</div>
              <input className={s.input} inputMode="decimal" value={p.budget ?? ""} onChange={set("budget")} placeholder="Ex. 2500" />
            </div>
          )}
        </div>
        <div>
          <div className={s.label}>Description</div>
          <textarea rows={3} className={s.input} value={p.description || ""} onChange={set("description")} placeholder="Objectif, cible, budget, liens…" />
        </div>

        {isNew && (
          <div>
            <div className={`mb-2 text-xs font-bold uppercase tracking-widest ${s.sub}`}>Tâches du projet ({draft.length})</div>
            {needsDeadline && <div className={`mb-2 text-xs ${s.muted}`}>Choisissez la deadline : les dates des tâches se calent dessus automatiquement (vous pouvez ensuite les modifier une à une).</div>}
            {draft.length === 0 && <div className={`mb-2 text-sm ${s.sub}`}>Aucune tâche pour l'instant — ajoutez les vôtres ci-dessous ou partez d'un modèle.</div>}
            <div className="space-y-2">
              {draft.map((t) => (
                <div key={t.k} className={`flex flex-wrap items-center gap-2 rounded-xl border p-2 ${s.card}`}>
                  <input aria-label="Titre de la tâche" className={`${s.input} min-w-[170px] flex-1`} value={t.titre} onChange={(e) => updateDraft(t.k, { titre: e.target.value })} />
                  <input aria-label="Échéance" type="date" className={miniSel} value={t.echeance || ""} onChange={(e) => changeDraftDate(t, e.target.value)} />
                  <select aria-label="Attribuée à" className={miniSel} value={t.assignee || ""} onChange={(e) => updateDraft(t.k, { assignee: e.target.value })}>
                    <option value="">—</option>
                    {members.map((m) => <option key={m}>{m}</option>)}
                  </select>
                  <button type="button" aria-label="Retirer la tâche" onClick={() => setDraft((d) => d.filter((x) => x.k !== t.k))} className={`rounded-lg p-1.5 ${dark ? "text-zinc-500 hover:bg-zinc-800 hover:text-rose-400" : "text-stone-400 hover:bg-stone-100 hover:text-rose-600"}`}><X size={14} /></button>
                </div>
              ))}
            </div>
            <div className="mt-2 flex gap-2">
              <input
                className={s.input}
                value={draftInput}
                onChange={(e) => setDraftInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addDraft()}
                placeholder="Ajouter une tâche (Entrée pour valider)"
              />
              <button type="button" onClick={addDraft} className={s.primaryBtn} aria-label="Ajouter la tâche"><Plus size={16} /></button>
            </div>
            {lateDraft > 0 && <div className={`mt-2 text-xs ${dark ? "text-amber-400" : "text-amber-700"}`}>{lateDraft} tâche(s) ont une date déjà passée — ajustez-les ou ajoutez de la marge sur la deadline.</div>}
          </div>
        )}

        {!isNew && (
          <div>
            <div className="mb-2 flex items-center justify-between">
              <div className={`text-xs font-bold uppercase tracking-widest ${s.sub}`}>To-do list · {prog.done}/{prog.total}</div>
              <button type="button" onClick={() => onNewTask(projectId)} className={`text-xs font-semibold underline ${s.muted}`}>Tâche détaillée</button>
            </div>
            {prog.total > 0 && (
              <div className={`mb-3 h-2 overflow-hidden rounded-full ${dark ? "bg-zinc-800" : "bg-stone-100"}`}>
                <div className="h-full rounded-full bg-emerald-500" style={{ width: `${prog.pct}%` }} />
              </div>
            )}
            <div className="space-y-2">
              {sorted.map((t) => (
                <MarketingTaskRow key={t.id} dark={dark} t={t} today={today} showProject={false} onToggle={onToggleTask} onOpen={onOpenTask} />
              ))}
              {sorted.length === 0 && <div className={`text-sm ${s.sub}`}>Aucune tâche pour l'instant.</div>}
            </div>
            <div className="mt-3 flex gap-2">
              <input
                className={s.input}
                value={quick}
                onChange={(e) => setQuick(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addQuick()}
                placeholder="Ajouter une tâche (Entrée pour valider)"
              />
              <button type="button" onClick={addQuick} className={s.primaryBtn} aria-label="Ajouter"><Plus size={16} /></button>
            </div>
          </div>
        )}

        {!isNew && v2 && (
          <>
            <MarketingBudgetSection dark={dark} project={live} expenses={ext.expenses} onAdd={(l, m) => ext.addExpense(projectId, l, m)} onRemove={ext.removeExpense} showToast={showToast} />
            <MarketingLinksSection dark={dark} links={ext.links.filter((l) => l.project_id === projectId)} onAdd={(x) => ext.addLink({ ...x, project_id: projectId })} onRemove={ext.removeLink} showToast={showToast} />
          </>
        )}
        {!isNew && !v2 && <div className={`text-xs ${s.sub}`}>Budget, liens et commentaires seront disponibles une fois la mise à jour de la base appliquée.</div>}

        <div className="flex items-center gap-2 pt-2">
          <button onClick={save} disabled={saving} className={s.primaryBtn}>{saving ? "Enregistrement…" : isNew ? "Créer le projet" : "Enregistrer"}</button>
          <button onClick={onClose} className={s.ghostBtn}>Fermer</button>
          {!isNew && (
            <button onClick={del} className={`ml-auto rounded-lg px-3 py-1.5 text-sm font-semibold ${deleteConfirm ? "bg-rose-600 text-white" : dark ? "text-rose-400 hover:bg-zinc-800" : "text-rose-600 hover:bg-rose-50"}`}>
              {deleteConfirm ? `Supprimer avec ses ${prog.total} tâches ?` : "Supprimer"}
            </button>
          )}
        </div>
      </div>
    </MarketingDrawer>
  );
}


function MarketingTab({ dark, me, showToast }) {
  const s = marketingStyles(dark);
  const data = useMarketing();
  const { projects, tasks, members, loading, error } = data;
  const today = prospectionTodayISO();
  const weekEnd = marketingAddDays(today, 7);

  const premium = true; // mode Premium permanent
  const [vue, setVue] = useState(() => loadLocal("dsr:marketing-vue", "jour"));
  useEffect(() => { saveLocal("dsr:marketing-vue", vue); }, [vue]);
  const vueEff = !premium && vue === "tableau" ? "jour" : vue;
  const [scope, setScope] = useState(() => loadLocal("dsr:marketing-scope", ""));
  useEffect(() => { saveLocal("dsr:marketing-scope", scope); }, [scope]);
  const [openProject, setOpenProject] = useState(null);
  const [dupSource, setDupSource] = useState(null);
  const [openTask, setOpenTask] = useState(null);
  const [taskPrefill, setTaskPrefill] = useState(null);
  const [projFilter, setProjFilter] = useState("actifs");
  const [taskFilter, setTaskFilter] = useState({ statut: "ouvertes", project: "", q: "" });
  const [calMonth, setCalMonth] = useState(() => today.slice(0, 7) + "-01");
  const [calSel, setCalSel] = useState(today);
  const [selected, setSelected] = useState([]);
  const [dragId, setDragId] = useState(null);

  const projectById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);
  const scoped = useMemo(
    () => tasks.filter((t) => !scope || (scope === "__none" ? !t.assignee : t.assignee === scope)),
    [tasks, scope]
  );

  const commentCount = useMemo(() => { const m = new Map(); data.comments.forEach((c) => m.set(c.task_id, (m.get(c.task_id) || 0) + 1)); return m; }, [data.comments]);
  const linkCount = useMemo(() => { const m = new Map(); data.links.forEach((l) => { if (l.task_id) m.set(l.task_id, (m.get(l.task_id) || 0) + 1); }); return m; }, [data.links]);
  const riskByProject = useMemo(() => {
    const m = new Map();
    projects.forEach((p) => m.set(p.id, marketingProjectRisk(p, tasks, today, data.v2 ? data.expenses : undefined)));
    return m;
  }, [projects, tasks, today, data.expenses, data.v2]);
  const atRisk = useMemo(() => projects.filter((p) => riskByProject.get(p.id)?.level), [projects, riskByProject]);
  const ext = { v2: data.v2, comments: data.comments, links: data.links, expenses: data.expenses, addComment: data.addComment, removeComment: data.removeComment, addLink: data.addLink, removeLink: data.removeLink, addExpense: data.addExpense, removeExpense: data.removeExpense };

  const closeTask = useCallback(() => { setOpenTask(null); setTaskPrefill(null); }, []);
  const closeProject = useCallback(() => { setOpenProject(null); setDupSource(null); }, []);
  const newTask = useCallback((prefill) => { setTaskPrefill(prefill || null); setOpenTask("new"); }, []);
  const newProject = useCallback(() => { setDupSource(null); setOpenProject("new"); }, []);
  const duplicateProject = (id) => { setDupSource(id); setOpenProject("new"); };
  const changeVue = (k) => { setVue(k); setSelected([]); };

  const onToggle = async (t) => {
    const wasDone = t.statut === "Fait";
    try {
      const { next } = await data.toggleDone(t);
      if (!wasDone) showToast(next ? `Fait ! Prochaine occurrence le ${marketingFrDate(next.echeance)}` : "Tâche terminée", { type: "celebrate" });
    } catch (e) { showToast(`Action impossible : ${e.message || e}`, { type: "error" }); }
  };
  const onRelance = async (t, days) => {
    try {
      await data.patchTask(t.id, { relance: days > 0 ? marketingAddDays(today, days) : null });
      showToast(days > 0 ? `Relance reportée au ${marketingFrDate(marketingAddDays(today, days))}` : "Relance clôturée");
    } catch (e) { showToast(`Action impossible : ${e.message || e}`, { type: "error" }); }
  };
  const onReschedule = async (t, days) => {
    try {
      await data.patchTask(t.id, { echeance: marketingAddDays(today, days) });
      showToast(`Échéance replanifiée au ${marketingFrDate(marketingAddDays(today, days))}`);
    } catch (e) { showToast(`Action impossible : ${e.message || e}`, { type: "error" }); }
  };
  const quickAddTask = async (project_id, fields) => {
    await data.saveTask({ project_id, statut: "À faire", priorite: "Normale", ...fields });
  };
  const moveTask = async (t, statut) => {
    if (t.statut === statut) return;
    try {
      const { next } = await data.saveTask({ ...t, statut }, t);
      if (next) showToast(`Prochaine occurrence le ${marketingFrDate(next.echeance)}`);
    } catch (e) { showToast(`Action impossible : ${e.message || e}`, { type: "error" }); }
  };

  // ── Premium : point de la semaine ──
  const copyDigest = () => {
    const risks = projects.filter((p) => riskByProject.get(p.id)?.level).map((p) => ({ titre: p.titre, reasons: riskByProject.get(p.id).reasons }));
    const txt = marketingDigest({ tasks: scoped, projects, today, scopeLabel: scope && scope !== "__none" ? scope : "", risks });
    return marketingCopy(txt, showToast, "Point de la semaine copié — prêt à coller");
  };

  // ── Premium : raccourcis clavier ──
  useEffect(() => {
    if (!premium) return;
    const VUE_KEYS = { 1: "jour", 2: "projets", 3: "taches", 4: "tableau", 5: "calendrier" };
    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = document.activeElement;
      const typing = el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
      if (typing || openProject || openTask) return;
      const k = e.key.toLowerCase();
      if (k === "n") { e.preventDefault(); newTask(); }
      else if (k === "p") { e.preventDefault(); newProject(); }
      else if (VUE_KEYS[k]) { e.preventDefault(); setVue(VUE_KEYS[k]); setSelected([]); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [premium, openProject, openTask, newTask, newProject]);

  const toggleSelect = (id) => setSelected((arr) => (arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id]));
  const runBulk = async (label, makeFields) => {
    const items = tasks.filter((t) => selected.includes(t.id)).map((t) => ({ task: t, fields: makeFields(t) }));
    try {
      const n = await data.bulkUpdate(items);
      showToast(`${n} tâche${n > 1 ? "s" : ""} · ${label}`);
      setSelected([]);
    } catch (e) { showToast(`Action groupée interrompue : ${e.message || e}`, { type: "error" }); }
  };

  const row = (t, extra = {}) => (
    <MarketingTaskRow
      key={t.id}
      dark={dark}
      t={t}
      project={projectById.get(t.project_id)}
      today={today}
      onToggle={onToggle}
      onOpen={setOpenTask}
      onRelance={onRelance}
      onReschedule={premium ? onReschedule : undefined}
      commentCount={commentCount.get(t.id) || 0}
      linkCount={linkCount.get(t.id) || 0}
      {...extra}
    />
  );

  // ───────────── Vue "Aujourd'hui" ─────────────
  const buckets = useMemo(() => {
    const b = { late: [], today: [], week: [], later: [], nodate: [], done: [] };
    scoped.forEach((t) => b[marketingBucket(t, today, weekEnd)].push(t));
    const byDate = (x, y) => (marketingUrgencyDate(x) || "").localeCompare(marketingUrgencyDate(y) || "");
    ["late", "today", "week"].forEach((k) => b[k].sort(byDate));
    return b;
  }, [scoped, today, weekEnd]);
  const dueCount = buckets.late.length + buckets.today.length;

  const watchedProjects = useMemo(
    () => projects
      .filter((p) => p.statut !== "Terminé" && p.deadline && p.deadline <= marketingAddDays(today, 21))
      .sort((a, b) => a.deadline.localeCompare(b.deadline)),
    [projects, today]
  );

  const vueJour = () => {
    const section = (title, tone, items) =>
      items.length === 0 ? null : (
        <section key={title}>
          <div className={`mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-widest ${tone}`}>{title}<span className="rounded-full bg-black/10 px-1.5 text-[10px]">{items.length}</span></div>
          <div className="space-y-2">{items.map((t) => row(t))}</div>
        </section>
      );
    const kpi = (label, value, tone) => (
      <div className={`rounded-xl border px-4 py-3 ${s.card}`}>
        <div className={`text-2xl font-bold ${tone || s.title}`}>{value}</div>
        <div className={`text-xs ${s.sub}`}>{label}</div>
      </div>
    );
    const relancesDues = scoped.filter((t) => t.statut !== "Fait" && t.relance && t.relance <= today).length;
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {kpi("En retard", buckets.late.length, buckets.late.length ? "text-rose-500" : "")}
          {kpi("À traiter aujourd'hui", buckets.today.length)}
          {kpi("Relances à faire", relancesDues, relancesDues ? (dark ? "text-amber-300" : "text-amber-700") : "")}
          {kpi("Projets actifs", projects.filter((p) => p.statut !== "Terminé").length)}
        </div>
        {atRisk.length > 0 && (
          <div role="alert" className={`rounded-2xl border p-3 ${dark ? "border-rose-500/40 bg-rose-500/10" : "border-rose-300 bg-rose-50"}`}>
            <div className={`mb-2 flex items-center gap-2 text-sm font-bold ${dark ? "text-rose-200" : "text-rose-800"}`}>
              <AlertTriangle size={16} />{atRisk.length} projet{atRisk.length > 1 ? "s" : ""} en danger
            </div>
            <ul className="space-y-1.5">
              {atRisk.map((p) => (
                <li key={p.id}>
                  <button type="button" onClick={() => setOpenProject(p.id)} className={`w-full rounded-lg px-2 py-1.5 text-left text-sm ${dark ? "text-rose-100 hover:bg-rose-500/10" : "text-rose-900 hover:bg-rose-100"}`}>
                    <span className="font-semibold">{p.titre}</span>
                    <span className="opacity-80"> — {riskByProject.get(p.id).reasons.join(" · ")}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {dueCount + buckets.week.length === 0 && (
          <EmptyState dark={dark} icon={CheckCircle2} title="Rien d'urgent cette semaine" subtitle="Les tâches et relances des 7 prochains jours apparaissent ici." />
        )}
        {section("En retard", dark ? "text-rose-400" : "text-rose-600", buckets.late)}
        {section("Aujourd'hui", dark ? "text-blue-400" : "text-blue-800", buckets.today)}
        {section("Cette semaine", s.sub, buckets.week)}
        {watchedProjects.length > 0 && (
          <section>
            <div className={`mb-2 text-xs font-bold uppercase tracking-widest ${s.sub}`}>Deadlines de projets à 3 semaines</div>
            <div className="grid gap-2 sm:grid-cols-2">{watchedProjects.map((p) => projectCard(p))}</div>
          </section>
        )}
      </div>
    );
  };

  // ───────────── Vue "Projets" ─────────────
  function projectCard(p) {
    const prog = marketingProjectProgress(p, tasks);
    const late = p.statut !== "Terminé" && p.deadline && p.deadline < today;
    const risk = riskByProject.get(p.id) || { level: "", reasons: [] };
    const bud = data.v2 && p.budget != null ? marketingBudgetState(p, data.expenses) : null;
    return (
      <button
        key={p.id}
        type="button"
        onClick={() => setOpenProject(p.id)}
        className={`pl-interactive rounded-2xl border p-4 text-left ${s.card} ${dark ? "hover:border-zinc-700" : "hover:border-stone-300"}`}
      >
        <div className="flex items-start justify-between gap-3">
          <div className={`min-w-0 break-words text-sm font-bold ${s.title}`}>{p.titre}</div>
          <span className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white" style={{ background: MARKETING_PROJECT_COLORS[p.statut] }}>{p.statut}</span>
        </div>
        <div className={`mt-1 flex flex-wrap items-center gap-x-2 text-xs ${s.sub}`}>
          {p.categorie && <span>{p.categorie}</span>}
          {p.responsable && <span>· {p.responsable}</span>}
        </div>
        {risk.level && (
          <div className={`mt-2 flex items-start gap-1.5 rounded-lg px-2 py-1 text-[11px] font-semibold ${risk.level === "late" ? (dark ? "bg-rose-500/15 text-rose-300" : "bg-rose-100 text-rose-700") : (dark ? "bg-amber-500/15 text-amber-300" : "bg-amber-100 text-amber-800")}`}>
            <AlertTriangle size={12} className="mt-0.5 shrink-0" />
            <span>{risk.level === "late" ? "En retard" : "En danger"} · {risk.reasons[0]}{risk.reasons.length > 1 ? ` (+${risk.reasons.length - 1})` : ""}</span>
          </div>
        )}
        <div className="mt-3 flex items-center justify-between text-xs">
          <span className={late ? "font-semibold text-rose-500" : s.muted}>
            {p.deadline ? `Deadline ${marketingFrDate(p.deadline, true)} · ${p.statut === "Terminé" ? "terminé" : marketingRelativeLabel(p.deadline, today)}` : "Sans deadline"}
          </span>
          <span className={s.sub}>{prog.done}/{prog.total} tâches</span>
        </div>
        <div className={`mt-2 h-2 overflow-hidden rounded-full ${dark ? "bg-zinc-800" : "bg-stone-100"}`}>
          <div className="h-full rounded-full bg-emerald-500" style={{ width: `${prog.pct}%` }} />
        </div>
        {bud && (
          <div className={`mt-2 text-[11px] ${bud.over ? "font-semibold text-rose-500" : s.sub}`}>
            Budget {marketingEuro(bud.depense)} / {marketingEuro(bud.prevu)}{bud.over ? " · dépassé" : ""}
          </div>
        )}
      </button>
    );
  }
  const vueProjets = () => {
    const list = projects
      .filter((p) => (projFilter === "actifs" ? p.statut !== "Terminé" : projFilter === "termines" ? p.statut === "Terminé" : true))
      .filter((p) => {
        if (!scope) return true;
        if (scope === "__none") return !p.responsable;
        return p.responsable === scope || tasks.some((t) => t.project_id === p.id && t.assignee === scope);
      })
      .sort((a, b) => (a.deadline || "9999").localeCompare(b.deadline || "9999"));
    return (
      <div className="space-y-4">
        <div className="flex gap-1.5">
          {[["actifs", "En cours"], ["termines", "Terminés"], ["tous", "Tous"]].map(([k, l]) => (
            <button key={k} onClick={() => setProjFilter(k)} className={`pl-interactive rounded-lg px-3 py-1.5 text-sm font-medium ${projFilter === k ? (dark ? "bg-zinc-800 text-zinc-100" : "bg-stone-200 text-stone-900") : s.muted}`}>{l}</button>
          ))}
        </div>
        {list.length === 0 ? (
          <EmptyState dark={dark} icon={Megaphone} title="Aucun projet ici" subtitle="Créez un projet vide ou partez d'un modèle (opération commerciale, portes ouvertes…)." />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{list.map(projectCard)}</div>
        )}
      </div>
    );
  };

  // ───────────── Vue "Tâches" ─────────────
  const bulkBar = (list) => {
    const allIds = list.slice(0, 300).map((t) => t.id);
    const allSelected = allIds.length > 0 && allIds.every((id) => selected.includes(id));
    const btn = `rounded-lg border px-2.5 py-1 text-xs font-semibold ${dark ? "border-zinc-600 text-zinc-100 hover:bg-zinc-800" : "border-blue-300 text-blue-900 hover:bg-white"}`;
    return (
      <div className={`sticky top-2 z-20 flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 shadow-sm ${dark ? "border-blue-700/50 bg-zinc-900" : "border-blue-200 bg-blue-50"}`}>
        <span className={`text-sm font-semibold ${s.title}`}>{selected.length} sélectionnée{selected.length > 1 ? "s" : ""}</span>
        <button type="button" className={btn} onClick={() => setSelected(allSelected ? [] : allIds)}>{allSelected ? "Tout désélectionner" : "Tout sélectionner"}</button>
        <span className="mx-1 hidden h-4 w-px bg-current opacity-20 sm:block" />
        <button type="button" className={btn} onClick={() => runBulk("terminées", () => ({ statut: "Fait" }))}>Terminer</button>
        <button type="button" className={btn} onClick={() => runBulk("replanifiées à demain", () => ({ echeance: marketingAddDays(today, 1) }))}>Demain</button>
        <button type="button" className={btn} onClick={() => runBulk("replanifiées à +1 semaine", () => ({ echeance: marketingAddDays(today, 7) }))}>+1 sem</button>
        <select
          aria-label="Attribuer à"
          className={`${s.input} !h-8 !w-auto !py-0 text-xs`}
          value=""
          onChange={(e) => { const v = e.target.value; if (v) runBulk(v === "__none" ? "attribution retirée" : `attribuées à ${v}`, () => ({ assignee: v === "__none" ? null : v })); }}
        >
          <option value="">Attribuer à…</option>
          {members.map((m) => <option key={m} value={m}>{m}</option>)}
          <option value="__none">Personne</option>
        </select>
        <button type="button" className={`ml-auto text-xs font-semibold underline ${s.muted}`} onClick={() => setSelected([])}>Annuler</button>
      </div>
    );
  };

  const vueTaches = () => {
    const q = taskFilter.q.trim().toLowerCase();
    const list = scoped
      .filter((t) => (taskFilter.statut === "ouvertes" ? t.statut !== "Fait" : taskFilter.statut === "faites" ? t.statut === "Fait" : true))
      .filter((t) => !taskFilter.project || (taskFilter.project === "__none" ? !t.project_id : t.project_id === taskFilter.project))
      .filter((t) => !q || t.titre.toLowerCase().includes(q) || (t.notes || "").toLowerCase().includes(q))
      .sort((a, b) => (marketingUrgencyDate(a) || "9999").localeCompare(marketingUrgencyDate(b) || "9999"));
    return (
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <input className={`${s.input} !w-56`} placeholder="Rechercher une tâche…" value={taskFilter.q} onChange={(e) => setTaskFilter((f) => ({ ...f, q: e.target.value }))} />
          <select className={`${s.input} !w-auto`} value={taskFilter.statut} onChange={(e) => setTaskFilter((f) => ({ ...f, statut: e.target.value }))}>
            <option value="ouvertes">Ouvertes</option>
            <option value="faites">Terminées</option>
            <option value="toutes">Toutes</option>
          </select>
          <select className={`${s.input} !w-auto`} value={taskFilter.project} onChange={(e) => setTaskFilter((f) => ({ ...f, project: e.target.value }))}>
            <option value="">Tous les projets</option>
            <option value="__none">Sans projet</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.titre}</option>)}
          </select>
        </div>
        {premium && selected.length > 0 && bulkBar(list)}
        {list.length === 0 ? (
          <EmptyState dark={dark} icon={List} title="Aucune tâche" subtitle="Ajustez les filtres ou créez une tâche." />
        ) : (
          <div className="space-y-2">{list.slice(0, 300).map((t) => row(t, premium ? { selectable: true, selected: selected.includes(t.id), onSelect: toggleSelect } : {}))}</div>
        )}
        {list.length > 300 && <div className={`text-xs ${s.sub}`}>300 premières tâches affichées — affinez avec les filtres.</div>}
      </div>
    );
  };

  // ───────────── Vue "Calendrier" ─────────────
  const vueCalendrier = () => {
    const cells = marketingMonthGrid(calMonth);
    const events = new Map();
    const push = (iso, ev) => { if (!events.has(iso)) events.set(iso, []); events.get(iso).push(ev); };
    projects.forEach((p) => { if (p.deadline && p.statut !== "Terminé") push(p.deadline, { kind: "deadline", label: p.titre, project: p }); });
    scoped.forEach((t) => {
      const done = t.statut === "Fait";
      if (t.echeance) push(t.echeance, { kind: "echeance", label: t.titre, task: t, done });
      if (t.relance && !done) push(t.relance, { kind: "relance", label: t.titre, task: t });
    });
    const chipTone = (ev) => ev.kind === "deadline" ? (dark ? "bg-violet-500/25 text-violet-200" : "bg-violet-100 text-violet-800")
      : ev.kind === "relance" ? (dark ? "bg-amber-500/25 text-amber-200" : "bg-amber-100 text-amber-800")
      : ev.done ? (dark ? "bg-zinc-800 text-zinc-500 line-through" : "bg-stone-100 text-stone-400 line-through")
      : (dark ? "bg-blue-500/25 text-blue-200" : "bg-blue-100 text-blue-800");
    const prefix = (ev) => (ev.kind === "deadline" ? "⚑ " : ev.kind === "relance" ? "↺ " : "");
    const openEv = (ev) => (ev.project ? setOpenProject(ev.project.id) : setOpenTask(ev.task.id));
    const monthLabel = new Date(calMonth + "T12:00:00").toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
    const shift = (n) => setCalMonth(marketingAddMonths(calMonth, n));
    const selEvents = events.get(calSel) || [];
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <button onClick={() => shift(-1)} aria-label="Mois précédent" className={`rounded-lg border p-1.5 ${dark ? "border-zinc-700 text-zinc-300 hover:bg-zinc-800" : "border-stone-300 text-stone-600 hover:bg-stone-100"}`}><ChevronLeft size={16} /></button>
          <button onClick={() => shift(1)} aria-label="Mois suivant" className={`rounded-lg border p-1.5 ${dark ? "border-zinc-700 text-zinc-300 hover:bg-zinc-800" : "border-stone-300 text-stone-600 hover:bg-stone-100"}`}><ChevronRight size={16} /></button>
          <div className={`text-base font-bold capitalize ${s.title}`}>{monthLabel}</div>
          <button onClick={() => { setCalMonth(today.slice(0, 7) + "-01"); setCalSel(today); }} className={`${s.ghostBtn} ml-auto`}>Aujourd'hui</button>
        </div>
        <div className="flex flex-wrap gap-3 text-[11px]">
          <span className={`rounded-full px-2 py-0.5 ${chipTone({ kind: "deadline" })}`}>⚑ Deadline projet</span>
          <span className={`rounded-full px-2 py-0.5 ${chipTone({ kind: "echeance" })}`}>Échéance tâche</span>
          <span className={`rounded-full px-2 py-0.5 ${chipTone({ kind: "relance" })}`}>↺ Relance</span>
        </div>
        <div className={`overflow-hidden rounded-2xl border ${s.card}`}>
          <div className={`grid grid-cols-7 border-b text-center text-[10px] font-bold uppercase tracking-widest ${dark ? "border-zinc-800 text-zinc-500" : "border-stone-200 text-stone-400"}`}>
            {["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"].map((d) => <div key={d} className="py-2">{d}</div>)}
          </div>
          <div className="grid grid-cols-7">
            {cells.map((c, i) => {
              const evs = events.get(c.iso) || [];
              const isSel = c.iso === calSel;
              return (
                <button
                  key={c.iso}
                  type="button"
                  onClick={() => setCalSel(c.iso)}
                  className={`min-h-[64px] border-b border-r p-1 text-left align-top sm:min-h-[92px] sm:p-1.5 ${i % 7 === 6 ? "border-r-0" : ""} ${dark ? "border-zinc-800" : "border-stone-200"} ${isSel ? (dark ? "bg-blue-500/10" : "bg-blue-50") : ""} ${c.inMonth ? "" : "opacity-40"}`}
                >
                  <div className={`mb-0.5 inline-flex h-5 min-w-[20px] items-center justify-center rounded-full px-1 text-[11px] font-semibold ${c.iso === today ? "bg-blue-700 text-white" : s.muted}`}>{c.day}</div>
                  <div className="space-y-0.5">
                    {evs.slice(0, 3).map((ev, j) => (
                      <div key={j} className={`hidden truncate rounded px-1 text-[10px] leading-4 sm:block ${chipTone(ev)}`}>{prefix(ev)}{ev.label}</div>
                    ))}
                    {evs.length > 0 && (
                      <div className={`text-[10px] font-semibold ${s.sub} sm:hidden`}>{evs.length} ●</div>
                    )}
                    {evs.length > 3 && <div className={`hidden text-[10px] ${s.sub} sm:block`}>+{evs.length - 3}</div>}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
        <div>
          <div className="mb-2 flex items-center justify-between">
            <div className={`text-sm font-bold capitalize ${s.title}`}>{marketingFrDate(calSel, true)}{calSel === today ? " · aujourd'hui" : ""}</div>
            <button onClick={() => newTask({ echeance: calSel })} className={s.ghostBtn}>+ Tâche ce jour</button>
          </div>
          {selEvents.length === 0 ? (
            <div className={`text-sm ${s.sub}`}>Rien de prévu ce jour-là.</div>
          ) : (
            <div className="space-y-2">
              {selEvents.map((ev, i) => (
                <button key={i} type="button" onClick={() => openEv(ev)} className={`pl-interactive flex w-full items-center gap-2 rounded-xl border px-3 py-2 text-left text-sm ${s.card}`}>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${chipTone(ev)}`}>{ev.kind === "deadline" ? "Deadline" : ev.kind === "relance" ? "Relance" : "Échéance"}</span>
                  <span className={`min-w-0 flex-1 truncate ${ev.done ? "line-through " + s.sub : s.title}`}>{ev.label}</span>
                  {ev.task?.assignee && <span className={`shrink-0 text-xs ${s.sub}`}>{ev.task.assignee}</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  };

  // ───────────── Vue "Tableau" (premium) ─────────────
  const vueTableau = () => {
    const cols = [
      ["À faire", dark ? "bg-zinc-900/40" : "bg-stone-100/70"],
      ["En cours", dark ? "bg-blue-500/5" : "bg-blue-50/70"],
      ["Fait", dark ? "bg-emerald-500/5" : "bg-emerald-50/70"],
    ];
    const recentDone = scoped.filter((t) => t.statut === "Fait").sort((a, b) => (b.done_at || "").localeCompare(a.done_at || "")).slice(0, 15);
    const colTasks = (st) =>
      st === "Fait" ? recentDone : scoped.filter((t) => t.statut === st).sort((a, b) => (marketingUrgencyDate(a) || "9999").localeCompare(marketingUrgencyDate(b) || "9999"));
    const nextOf = { "À faire": "En cours", "En cours": "Fait" };
    const prevOf = { "En cours": "À faire", Fait: "En cours" };
    return (
      <div className="grid gap-3 lg:grid-cols-3">
        {cols.map(([st, bg]) => {
          const list = colTasks(st);
          return (
            <div
              key={st}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const id = e.dataTransfer?.getData("text/plain") || dragId;
                const t = tasks.find((x) => x.id === id);
                setDragId(null);
                if (t) moveTask(t, st);
              }}
              className={`min-h-[140px] rounded-2xl border p-2.5 ${bg} ${dark ? "border-zinc-800" : "border-stone-200"}`}
            >
              <div className={`mb-2 flex items-center justify-between px-1 text-xs font-bold uppercase tracking-widest ${s.sub}`}>
                <span>{st}</span><span>{st === "Fait" ? `${list.length} récentes` : list.length}</span>
              </div>
              <div className="space-y-2">
                {list.map((t) => {
                  const pr = projectById.get(t.project_id);
                  return (
                    <div
                      key={t.id}
                      draggable
                      onDragStart={(e) => { setDragId(t.id); e.dataTransfer?.setData("text/plain", t.id); }}
                      onDragEnd={() => setDragId(null)}
                      onClick={() => setOpenTask(t.id)}
                      className={`cursor-grab rounded-xl border p-2.5 text-sm active:cursor-grabbing ${s.card} ${dragId === t.id ? "opacity-50" : ""}`}
                    >
                      <div className={`flex items-start justify-between gap-2 font-medium ${t.statut === "Fait" ? "line-through " + s.sub : s.title}`}>
                        <span className="min-w-0 break-words">{t.titre}</span>
                        {t.priorite === "Haute" && t.statut !== "Fait" && <Flag size={12} className="mt-1 shrink-0 text-rose-500" />}
                      </div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        <MarketingDateChip dark={dark} kind="echeance" iso={t.echeance} today={today} done={t.statut === "Fait"} />
                        <MarketingDateChip dark={dark} kind="relance" iso={t.relance} today={today} done={t.statut === "Fait"} />
                        {pr && <span className={`max-w-[140px] truncate rounded-full px-2 py-0.5 text-[11px] ${dark ? "bg-zinc-800 text-zinc-400" : "bg-stone-100 text-stone-500"}`}>{pr.titre}</span>}
                        {t.assignee && <span className={`ml-auto text-[11px] font-semibold ${s.sub}`}>{t.assignee}</span>}
                      </div>
                      <div className="mt-2 flex gap-1.5 text-[11px]" onClick={(e) => e.stopPropagation()}>
                        {prevOf[t.statut] && <button type="button" onClick={() => moveTask(t, prevOf[t.statut])} className={`rounded-md border px-2 py-0.5 font-semibold ${dark ? "border-zinc-700 text-zinc-300 hover:bg-zinc-800" : "border-stone-300 text-stone-600 hover:bg-stone-100"}`}>← {prevOf[t.statut]}</button>}
                        {nextOf[t.statut] && <button type="button" onClick={() => moveTask(t, nextOf[t.statut])} className={`rounded-md border px-2 py-0.5 font-semibold ${dark ? "border-zinc-700 text-zinc-300 hover:bg-zinc-800" : "border-stone-300 text-stone-600 hover:bg-stone-100"}`}>{nextOf[t.statut]} →</button>}
                      </div>
                    </div>
                  );
                })}
                {list.length === 0 && <div className={`px-1 py-4 text-center text-xs ${s.sub}`}>Glissez une tâche ici</div>}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  const VUES = [["jour", "Aujourd'hui"], ["projets", "Projets"], ["taches", "Tâches"], ...(premium ? [["tableau", "Tableau"]] : []), ["calendrier", "Calendrier"]];

  if (error) {
    return (
      <EmptyState dark={dark} icon={AlertTriangle} title="Impossible de charger le module Marketing" subtitle={`${error} — vérifiez que le script marketing.sql a bien été exécuté dans Supabase.`} />
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className={`text-[26px] font-semibold leading-8 tracking-tight ${dark ? "text-zinc-50" : "text-stone-900"}`}>Marketing</h1>
          <span className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${dark ? "border-amber-400/40 bg-amber-400/10 text-amber-300" : "border-amber-400/60 bg-amber-50 text-amber-800"}`}>
            <Sparkles size={12} />Premium
          </span>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
          <select value={scope} onChange={(e) => setScope(e.target.value)} className={`${s.input} !w-auto`} aria-label="Filtrer par personne">
            <option value="">Toute l'équipe</option>
            {members.map((m) => <option key={m}>{m}</option>)}
            <option value="__none">Non attribuées</option>
          </select>
          <div className="ml-auto flex flex-wrap gap-2">
            {premium && <button onClick={copyDigest} className={s.ghostBtn}>Copier le point de la semaine</button>}
            <button onClick={() => newTask()} className={s.ghostBtn}>Nouvelle tâche</button>
            <button onClick={newProject} className={s.primaryBtn}>Nouveau projet</button>
          </div>
        </div>
      </div>

      <div className={`hidden text-[11px] sm:block ${s.sub}`}>Raccourcis : <b>N</b> nouvelle tâche · <b>P</b> nouveau projet · <b>1–5</b> changer de vue</div>

      <div className={`inline-flex flex-wrap gap-1 rounded-xl border p-1 ${dark ? "bg-zinc-900/60 border-zinc-800" : "bg-white border-stone-200"}`}>
        {VUES.map(([k, l]) => (
          <button
            key={k}
            onClick={() => changeVue(k)}
            className={`pl-interactive flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-sm font-medium ${vueEff === k ? (dark ? "bg-blue-500/10 text-blue-300" : "bg-blue-50 text-blue-700") : dark ? "text-zinc-400 hover:text-zinc-200" : "text-stone-500 hover:text-stone-800"}`}
          >
            {l}
            {k === "jour" && dueCount > 0 && (
              <span className={`flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 text-[10px] font-bold ${vueEff === k ? "bg-white/25 text-white" : "bg-rose-500 text-white"}`}>{dueCount}</span>
            )}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex h-40 items-center justify-center"><RefreshCw className={`animate-spin ${dark ? "text-zinc-600" : "text-stone-300"}`} size={20} /></div>
      ) : (
        <div key={vueEff} className="pl-fade-in">
          {vueEff === "jour" && vueJour()}
          {vueEff === "projets" && vueProjets()}
          {vueEff === "taches" && vueTaches()}
          {vueEff === "tableau" && vueTableau()}
          {vueEff === "calendrier" && vueCalendrier()}
        </div>
      )}

      {openProject && (
        <MarketingProjectFiche
          key={`${openProject}:${dupSource || ""}`}
          dark={dark}
          projectId={openProject}
          duplicateOf={dupSource}
          premium={premium}
          projects={projects}
          tasks={tasks}
          members={members}
          me={me}
          ext={ext}
          blocked={!!openTask}
          onClose={closeProject}
          onSave={data.saveProject}
          onDelete={data.removeProject}
          onDuplicate={duplicateProject}
          onOpenTask={setOpenTask}
          onNewTask={(project_id) => newTask({ project_id })}
          onToggleTask={onToggle}
          onQuickAddTask={quickAddTask}
          showToast={showToast}
        />
      )}
      {openTask && (
        <MarketingTaskFiche
          dark={dark}
          taskId={openTask}
          tasks={tasks}
          projects={projects}
          members={members}
          prefill={taskPrefill}
          me={me}
          ext={ext}
          onClose={closeTask}
          onSave={data.saveTask}
          onDelete={data.removeTask}
          showToast={showToast}
        />
      )}
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// Rapports RDV (bêta) — rendez-vous clients créés par l'administrateur, suivi par les commerciaux.
// Tables Supabase protégées par RLS (voir sql/rdv.sql).
// ═════════════════════════════════════════════════════════════════════════════
// RDV-LOGIC-START
const RDV_STATUTS = ["À venir", "Honoré", "Absent", "Vendu", "Perdu"];
const RDV_TYPES = ["Showroom", "Reprise", "Essai", "Livraison", "Autre"];
const RDV_SOURCES = ["Internet", "Téléphone", "Passage showroom", "Parrainage", "Prospection", "Réseaux sociaux", "Salon / événement", "Autre"];
const RDV_MOTIFS = ["Prix", "Pas de reprise", "Financement refusé", "Délai", "Injoignable", "Autre"];
const RDV_EXCLUDED_ROLES = ["Secrétariat", "Préparateur", "Marketing"];
const RDV_PERIODS = [
  { k: "semaine", label: "Cette semaine" },
  { k: "semaine-1", label: "Semaine dernière" },
  { k: "mois", label: "Ce mois" },
  { k: "mois-1", label: "Mois dernier" },
  { k: "30j", label: "30 jours" },
  { k: "tout", label: "Tout" },
];
const RDV_DAYS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
const RDV_DAYS_SHORT = ["Dim", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam"];
const RDV_WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];
const RDV_NOTE_TYPES = ["Appel", "SMS", "E-mail", "Visite", "Note"];
const RDV_CONTACT_TYPES = ["Appel", "SMS", "E-mail", "Visite"];
const RDV_STAGES = ["Planifié", "À saisir", "En cours", "À relancer", "Vendu", "Perdu"];
const RDV_STAGE_HINT = {
  "Planifié": "Prochain rendez-vous fixé",
  "À saisir": "Rendez-vous passé, résultat à saisir",
  "En cours": "Venu, affaire en réflexion",
  "À relancer": "Absent ou relance à faire",
  "Vendu": "Vente conclue (30 derniers jours)",
  "Perdu": "Affaire perdue (30 derniers jours)",
};
const RDV_FIELD_LABELS = {
  statut: "Statut", commentaire: "Commentaire", relance: "Relance", motif_perte: "Motif de perte", dossier_numero: "Dossier", vente_type: "Type de vente", vente_vehicule: "Véhicule vendu", vente_ref: "Réf. vendue",
  commercial: "Vendeur", date_rdv: "Date", client_nom: "Client", tel: "Téléphone", source: "Source", type_rdv: "Type",
  vehicule_vise: "Véhicule visé", vehicule_ref: "Réf. véhicule", vehicules: "Véhicules visés", consigne: "Consigne", deleted_at: "Corbeille",
};

function rdvDigits(tel) {
  let d = String(tel || "").replace(/\D/g, "");
  if (d.startsWith("0033")) d = "0" + d.slice(4);
  else if (d.startsWith("33") && d.length >= 11) d = "0" + d.slice(2);
  return d;
}
function rdvTelClean(tel) { return String(tel || "").replace(/[^\d+]/g, ""); }
function rdvDay(r) { return prospectionTodayISO(new Date(r.date_rdv)); }
function rdvTime(r) { return new Date(r.date_rdv).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }); }
function rdvFirstName(nom) {
  const parts = String(nom || "").trim().split(/\s+/).filter(Boolean);
  const given = parts.filter((p) => p !== p.toUpperCase());
  return given.length ? given.join(" ") : parts.length > 1 ? parts.slice(1).join(" ") : parts[0] || "";
}
function rdvDuplicates(rows, tel, excludeId) {
  const d = rdvDigits(tel);
  if (d.length < 6) return [];
  return rows.filter((r) => !r.deleted_at && r.id !== excludeId && rdvDigits(r.tel) === d);
}
function rdvIsOverdue(r, now) { return !r.deleted_at && r.statut === "À venir" && new Date(r.date_rdv) < now; }
function rdvOverdueDays(r, today) { return Math.max(0, marketingDaysBetween(rdvDay(r), today)); }
// ── Planning : jours de repos hebdomadaires et absences (congés…) par vendeur ──
function rdvBuildPlan(planningRows, absences) {
  const repos = new Map();
  (planningRows || []).forEach((p) => repos.set(p.commercial, new Set((p.repos || []).map(Number))));
  const abs = new Map();
  (absences || []).forEach((a) => { if (!abs.has(a.commercial)) abs.set(a.commercial, []); abs.get(a.commercial).push(a); });
  return { repos, abs };
}
function rdvDow(iso) { return new Date(iso + "T12:00:00").getDay(); }
// "" si le vendeur travaille ce jour-là, sinon la raison (« Repos (lundi) », « Absent·e du … »).
function rdvOffReason(plan, nom, iso) {
  if (!plan || !nom || !iso) return "";
  const rs = plan.repos.get(nom);
  if (rs && rs.has(rdvDow(iso))) return `Repos (${RDV_DAYS[rdvDow(iso)]})`;
  const a = (plan.abs.get(nom) || []).find((x) => x.du <= iso && iso <= x.au);
  if (a) return a.note ? `Absent·e (${a.note})` : "Absent·e";
  return "";
}
function rdvNextPresent(plan, nom, iso) {
  let d = iso;
  for (let i = 0; i < 60; i++) { if (!rdvOffReason(plan, nom, d)) return d; d = marketingAddDays(d, 1); }
  return iso;
}
function rdvPresentNames(plan, names, iso) { return names.filter((n) => !rdvOffReason(plan, n, iso)); }
// Une relance tombant un jour de repos / d'absence est reportée au premier jour de présence.
function rdvEffectiveRelance(r, plan) { return r.relance ? rdvNextPresent(plan, r.commercial, r.relance) : null; }
function rdvRelanceDue(r, today, plan) {
  if (r.deleted_at || !r.relance || !(r.statut === "Honoré" || r.statut === "Absent")) return false;
  return rdvEffectiveRelance(r, plan) <= today;
}
// Rendez-vous du même vendeur à moins d'une heure (hors lui-même).
function rdvConflicts(rows, commercial, dateISO, excludeId) {
  const t = new Date(dateISO).getTime();
  if (!commercial || Number.isNaN(t)) return [];
  return rows.filter((r) => !r.deleted_at && r.id !== excludeId && r.commercial === commercial && r.statut !== "Perdu" && Math.abs(new Date(r.date_rdv).getTime() - t) < 3600000);
}

// ── Affaires : un client = une chaîne de rendez-vous (RDV n°1, suite n°2, …) ──
function rdvAffaireKey(r) { return r.affaire_id || r.id; }
function rdvAffaires(rows) {
  const m = new Map();
  rows.forEach((r) => { if (r.deleted_at) return; const k = rdvAffaireKey(r); if (!m.has(k)) m.set(k, []); m.get(k).push(r); });
  m.forEach((arr) => arr.sort((a, b) => new Date(a.date_rdv) - new Date(b.date_rdv)));
  return m;
}
function rdvRankMap(rows) {
  const out = new Map();
  rdvAffaires(rows).forEach((arr) => arr.forEach((r, i) => out.set(r.id, { n: i + 1, total: arr.length })));
  return out;
}
function rdvStage(arr, now, today, plan) {
  if (arr.some((r) => r.statut === "Vendu")) return "Vendu";
  const last = arr[arr.length - 1];
  if (last.statut === "Perdu") return "Perdu";
  if (last.statut === "À venir") return new Date(last.date_rdv) < now ? "À saisir" : "Planifié";
  if (last.statut === "Absent") return "À relancer";
  return rdvRelanceDue(last, today, plan) ? "À relancer" : "En cours";
}
function rdvNotesByAffaire(notes) {
  const m = new Map();
  (notes || []).forEach((n) => { const k = n.affaire_id || n.rdv_id; if (!m.has(k)) m.set(k, []); m.get(k).push(n); });
  m.forEach((arr) => arr.sort((a, b) => new Date(b.at) - new Date(a.at)));
  return m;
}
// Dernier signe d'activité sur l'affaire (résultat saisi, note, ou RDV passé), en jour ISO.
function rdvLastTouch(arr, notesArr, now) {
  let t = 0;
  arr.forEach((r) => {
    if (r.suivi_at) t = Math.max(t, new Date(r.suivi_at).getTime());
    if (new Date(r.date_rdv) < now) t = Math.max(t, new Date(r.date_rdv).getTime());
  });
  (notesArr || []).forEach((n) => { t = Math.max(t, new Date(n.at).getTime()); });
  return t ? prospectionTodayISO(new Date(t)) : null;
}
function rdvPipeline(rows, notes, now, today, plan, closedDays = 30) {
  const nb = rdvNotesByAffaire(notes);
  const cols = Object.fromEntries(RDV_STAGES.map((k) => [k, []]));
  rdvAffaires(rows).forEach((arr, id) => {
    const last = arr[arr.length - 1], stage = rdvStage(arr, now, today, plan);
    const touch = rdvLastTouch(arr, nb.get(id), now);
    if ((stage === "Vendu" || stage === "Perdu") && (!touch || marketingDaysBetween(touch, today) > closedDays)) return;
    const next = stage === "Planifié" ? rdvDay(last) : stage === "À relancer" || stage === "En cours" ? rdvEffectiveRelance(last, plan) : null;
    cols[stage].push({
      id, rows: arr, last, first: arr[0], stage, n: arr.length, commercial: last.commercial, client_nom: last.client_nom, tel: last.tel,
      vehicule_vise: [...arr].reverse().find((r) => r.vehicule_vise)?.vehicule_vise || "", touch,
      staleDays: touch ? Math.max(0, marketingDaysBetween(touch, today)) : 0, next, notes: nb.get(id) || [],
    });
  });
  const key = (a) => (a.stage === "Planifié" ? new Date(a.last.date_rdv).getTime() : a.stage === "Vendu" || a.stage === "Perdu" ? -new Date(a.touch || 0).getTime() : -a.staleDays);
  RDV_STAGES.forEach((k) => cols[k].sort((a, b) => key(a) - key(b)));
  return cols;
}
// Contacts effectués (appels, SMS, e-mails, visites) saisis par un vendeur sur une période.
function rdvContactsBy(notes, nom, range) {
  return (notes || []).filter((n) => n.by_nom === nom && n.type !== "Note" && rdvInRange({ date_rdv: n.at }, range)).length;
}

function rdvWeekStart(iso) {
  const d = new Date(iso + "T12:00:00");
  return marketingAddDays(iso, -((d.getDay() + 6) % 7));
}
function rdvPeriodRange(key, today, custom) {
  if (key === "semaine") { const f = rdvWeekStart(today); return { from: f, to: marketingAddDays(f, 6) }; }
  if (key === "semaine-1") { const f = marketingAddDays(rdvWeekStart(today), -7); return { from: f, to: marketingAddDays(f, 6) }; }
  if (key === "mois" || key === "mois-1") {
    const first = today.slice(0, 7) + "-01";
    const f = key === "mois" ? first : marketingAddMonths(first, -1);
    return { from: f, to: marketingAddDays(marketingAddMonths(f, 1), -1) };
  }
  if (key === "30j") return { from: marketingAddDays(today, -29), to: today };
  if (key === "perso") return { from: custom?.from || null, to: custom?.to || null };
  return { from: null, to: null };
}
function rdvInRange(r, range) {
  const day = rdvDay(r);
  return (!range.from || day >= range.from) && (!range.to || day <= range.to);
}

function rdvStats(rows, now, today, plan) {
  const live = rows.filter((r) => !r.deleted_at);
  const s = { pris: live.length, aVenir: 0, sansSuivi: 0, venus: 0, absents: 0, vendus: 0, perdus: 0, relancesDues: 0, relancesRetard: 0, reactSum: 0, reactN: 0, suites: 0, venteStock: 0, venteCommande: 0, affaires: 0, affairesVenues: 0, affairesVendues: 0, motifs: {}, sources: {}, types: {} };
  const bump = (map, key, r) => {
    const o = map[key] || (map[key] = { pris: 0, venus: 0, vendus: 0 });
    o.pris++; if (r.venu) o.venus++; if (r.statut === "Vendu") o.vendus++;
  };
  live.forEach((r) => {
    if (r.statut === "À venir") { if (new Date(r.date_rdv) < now) s.sansSuivi++; else s.aVenir++; }
    if (r.venu) s.venus++;
    else if (r.statut === "Absent" || r.statut === "Perdu") s.absents++;
    if (r.statut === "Vendu") { s.vendus++; if (r.vente_type === "Stock") s.venteStock++; else if (r.vente_type === "Commande") s.venteCommande++; }
    if (r.statut === "Perdu") { s.perdus++; const m = r.motif_perte || "Non précisé"; s.motifs[m] = (s.motifs[m] || 0) + 1; }
    if (r.parent_id) s.suites++;
    if (rdvRelanceDue(r, today, plan)) { s.relancesDues++; if (rdvEffectiveRelance(r, plan) < today) s.relancesRetard++; }
    if (r.suivi_at) { s.reactSum += Math.max(0, (new Date(r.suivi_at) - new Date(r.date_rdv)) / 3600000); s.reactN++; }
    bump(s.sources, r.source || "Non précisée", r);
    bump(s.types, r.type_rdv || "Autre", r);
  });
  rdvAffaires(live).forEach((arr) => {
    s.affaires++;
    if (arr.some((r) => r.venu)) s.affairesVenues++;
    if (arr.some((r) => r.statut === "Vendu")) s.affairesVendues++;
  });
  s.decides = s.venus + s.absents;
  s.tauxHonore = s.decides ? s.venus / s.decides : null;
  // Taux de transformation par affaire : un client revenu 3 fois = 1 affaire.
  s.tauxVente = s.affairesVenues ? s.affairesVendues / s.affairesVenues : null;
  s.reactH = s.reactN ? s.reactSum / s.reactN : null;
  return s;
}
function rdvPct(x) { return x == null ? "—" : Math.round(x * 100) + " %"; }
function rdvReact(h) {
  if (h == null) return "—";
  if (h < 1) return "< 1 h";
  if (h < 48) return Math.round(h) + " h";
  return (h / 24).toFixed(1).replace(".", ",") + " j";
}
function rdvGroupBy(rows, keyFn) {
  const m = new Map();
  rows.forEach((r) => { const k = keyFn(r); if (!m.has(k)) m.set(k, []); m.get(k).push(r); });
  return m;
}
// Série mensuelle (rendez-vous réels + statistiques archivées des mois > 24).
function rdvMonthly(rows, archive, months, today, commercial) {
  const first = today.slice(0, 7) + "-01";
  const keys = [];
  for (let i = months - 1; i >= 0; i--) keys.push(marketingAddMonths(first, -i).slice(0, 7));
  const out = new Map(keys.map((k) => [k, { mois: k, pris: 0, venus: 0, vendus: 0 }]));
  rows.forEach((r) => {
    if (r.deleted_at || (commercial && r.commercial !== commercial)) return;
    const o = out.get(rdvDay(r).slice(0, 7));
    if (o) { o.pris++; if (r.venu) o.venus++; if (r.statut === "Vendu") o.vendus++; }
  });
  (archive || []).forEach((a) => {
    if (commercial && a.commercial !== commercial) return;
    const o = out.get(String(a.mois).slice(0, 7));
    if (o) { o.pris += a.nb_rdv; o.venus += a.nb_venu; o.vendus += a.nb_vendu; }
  });
  return [...out.values()];
}
function rdvMonthLabel(k) {
  return new Date(k + "-01T12:00:00").toLocaleDateString("fr-FR", { month: "short", year: "2-digit" });
}
// Libellé de la vente : « Stock · Puma Titanium » / « Commande · Kuga… ».
function rdvVenteLabel(r) {
  if (r.statut !== "Vendu") return "";
  const t = r.vente_type || "";
  const v = r.vente_vehicule || "";
  if (!t && !v) return r.dossier_numero ? `Dossier ${r.dossier_numero}` : "";
  return [t, v].filter(Boolean).join(" · ");
}
// Alerte sur le véhicule choisi pour une vente.
function rdvSaleWarning(ref, commercial, vehicleByOrder) {
  if (!ref) return "";
  const v = vehicleByOrder.get(normalizeOrderNum(ref));
  if (!v) return "";
  if (v.baseStatus === "vendu") return "Ce véhicule est déjà marqué vendu";
  if (v.baseStatus === "livre_client") return "Ce véhicule est déjà livré";
  if (v.baseStatus === "hs") return "Ce véhicule est HS";
  if (v.baseStatus === "reserve") { const who = activeReservationVendeur(v); return who && who !== commercial ? `Ce véhicule est réservé par ${who}` : ""; }
  return "";
}
// Véhicules visés par un rendez-vous : liste [{type: "Stock"|"Commande", label, ref}] (anciens rendez-vous : un seul véhicule déduit des champs historiques).
function rdvVehiclesOf(r) {
  if (Array.isArray(r.vehicules) && r.vehicules.length) return r.vehicules;
  if (r.vehicule_vise || r.vehicule_ref) return [{ type: r.vehicule_ref ? "Stock" : "Commande", label: r.vehicule_vise || r.vehicule_ref, ref: r.vehicule_ref || null }];
  return [];
}
function rdvVehicleWarning(r, vehicleByOrder) {
  if (!(r.statut === "À venir" || r.statut === "Honoré" || r.statut === "Absent")) return "";
  const list = rdvVehiclesOf(r).filter((x) => x.ref);
  for (const item of list) {
    const v = vehicleByOrder.get(normalizeOrderNum(item.ref));
    if (!v) continue;
    let w = "";
    if (v.baseStatus === "vendu") w = "Véhicule déjà vendu";
    else if (v.baseStatus === "livre_client") w = "Véhicule livré";
    else if (v.baseStatus === "hs") w = "Véhicule HS";
    else if (v.baseStatus === "reserve") {
      const who = activeReservationVendeur(v);
      if (!(who && who === r.commercial)) w = `Véhicule réservé${who ? " (" + who + ")" : ""}`;
    }
    if (w) return list.length > 1 ? `${w} : ${item.label}` : w;
  }
  return "";
}
function rdvSmsBody(r, today) {
  const day = rdvDay(r);
  const label = day === today ? "aujourd'hui" : day === marketingAddDays(today, 1) ? "demain" : new Date(r.date_rdv).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
  const hm = rdvTime(r).replace(":", "h");
  return `Bonjour, c'est ${rdvFirstName(r.commercial)} de Ford Caen. Je vous confirme votre rendez-vous ${label} à ${hm}. À très vite !`;
}
function rdvSmsHref(r, today) { return `sms:${rdvTelClean(r.tel)}?&body=${encodeURIComponent(rdvSmsBody(r, today))}`; }
function rdvIcsEscape(s) { return String(s || "").replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n"); }
function rdvIcs(r) {
  const fmt = (d) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const start = new Date(r.date_rdv);
  const end = new Date(start.getTime() + 3600000);
  const desc = [r.tel && `Tél : ${r.tel}`, r.vehicule_vise && `Véhicule : ${r.vehicule_vise}`, r.type_rdv && `Type : ${r.type_rdv}`, r.consigne].filter(Boolean).join("\n");
  return [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//ParcLive//RDV//FR", "CALSCALE:GREGORIAN", "BEGIN:VEVENT",
    `UID:${r.id}@parclive`, `DTSTAMP:${fmt(new Date())}`, `DTSTART:${fmt(start)}`, `DTEND:${fmt(end)}`,
    `SUMMARY:${rdvIcsEscape(`RDV ${r.client_nom} — Ford Caen`)}`, `DESCRIPTION:${rdvIcsEscape(desc)}`, "LOCATION:Ford Caen",
    "BEGIN:VALARM", "TRIGGER:-PT30M", "ACTION:DISPLAY", "DESCRIPTION:Rendez-vous client", "END:VALARM",
    "END:VEVENT", "END:VCALENDAR",
  ].join("\r\n");
}
function rdvCleanRow(f) {
  const vs = (Array.isArray(f.vehicules) ? f.vehicules : []).map((v) => ({ type: v.type === "Stock" ? "Stock" : "Commande", label: String(v.label || "").trim(), ref: v.ref ? String(v.ref) : null })).filter((v) => v.label);
  const t = (v) => { const s = typeof v === "string" ? v.trim() : v; return s === "" || s === undefined ? null : s; };
  return {
    client_nom: String(f.client_nom || "").trim(),
    tel: t(f.tel), commercial: String(f.commercial || "").trim(),
    date_rdv: f.date_rdv, type_rdv: f.type_rdv || "Showroom", source: t(f.source),
    vehicules: vs, vehicule_vise: vs.length ? vs.map((v) => v.label).join(" + ") : null, vehicule_ref: vs.find((v) => v.ref)?.ref || null, consigne: t(f.consigne),
  };
}
// Points de la semaine (récap) : synthèse équipe + vendeurs + points d'attention.
function rdvWeekRecap(rows, names, objectifs, weekStart, now, today, plan) {
  const from = weekStart, to = marketingAddDays(weekStart, 6);
  const inWeek = rows.filter((r) => !r.deleted_at && rdvInRange(r, { from, to }));
  const objBy = new Map((objectifs || []).map((o) => [o.commercial, o]));
  const per = names.map((nom) => {
    const mine = inWeek.filter((r) => r.commercial === nom);
    const st = rdvStats(mine, now, today, plan);
    const sansSuiviAll = rows.filter((r) => r.commercial === nom && rdvIsOverdue(r, now));
    const oldest = sansSuiviAll.reduce((m, r) => Math.max(m, rdvOverdueDays(r, today)), 0);
    return { nom, st, obj: objBy.get(nom) || null, sansSuiviAll: sansSuiviAll.length, oldest };
  }).filter((p) => p.st.pris > 0 || p.sansSuiviAll > 0 || p.obj);
  const team = rdvStats(inWeek, now, today, plan);
  const nextFrom = marketingAddDays(from, 7), nextTo = marketingAddDays(from, 13);
  const next = rows.filter((r) => !r.deleted_at && rdvInRange(r, { from: nextFrom, to: nextTo }));
  const nextBy = {};
  next.forEach((r) => { nextBy[r.commercial] = (nextBy[r.commercial] || 0) + 1; });
  const attention = [];
  per.forEach((p) => {
    if (p.sansSuiviAll) attention.push(`${p.nom} : ${p.sansSuiviAll} rendez-vous sans résultat saisi${p.oldest ? ` (le plus ancien : ${p.oldest} j)` : ""}`);
    if (p.st.relancesRetard) attention.push(`${p.nom} : ${p.st.relancesRetard} relance${p.st.relancesRetard > 1 ? "s" : ""} en retard`);
    if (p.obj?.rdv_semaine != null && to < today && p.st.pris < p.obj.rdv_semaine) attention.push(`${p.nom} : ${p.st.pris} rendez-vous pour un objectif de ${p.obj.rdv_semaine}`);
    if (p.obj?.honore_pct != null && p.st.tauxHonore != null && p.st.tauxHonore * 100 < p.obj.honore_pct) attention.push(`${p.nom} : taux d'honorés ${rdvPct(p.st.tauxHonore)} (objectif ${p.obj.honore_pct} %)`);
  });
  return { from, to, team, per, next: { from: nextFrom, to: nextTo, total: next.length, by: nextBy }, attention };
}
function rdvFrRange(from, to) {
  const f = (iso) => new Date(iso + "T12:00:00").toLocaleDateString("fr-FR", { day: "numeric", month: "long" });
  return `${f(from)} au ${f(to)}`;
}
function rdvRecapText(rc) {
  const out = [`Rapport RDV — semaine du ${rdvFrRange(rc.from, rc.to)}`, ""];
  out.push(`Équipe : ${rc.team.pris} rendez-vous, ${rc.team.venus} honorés (${rdvPct(rc.team.tauxHonore)}), ${rc.team.vendus} vendus (${rdvPct(rc.team.tauxVente)} des affaires venues).`, "");
  rc.per.forEach((p) => out.push(`• ${p.nom} : ${p.st.pris} RDV · ${p.st.venus} honorés · ${p.st.vendus} vendus${p.obj?.rdv_semaine != null ? ` · objectif ${p.obj.rdv_semaine}` : ""}`));
  out.push("", "Points d'attention :");
  if (rc.attention.length) rc.attention.forEach((a) => out.push(`  – ${a}`)); else out.push("  – aucun");
  out.push("", `Semaine suivante : ${rc.next.total} rendez-vous planifiés.`);
  return out.join("\n");
}
function rdvExportRows(rows, allRows) {
  const dt = (iso) => (iso ? new Date(iso).toLocaleString("fr-FR") : "");
  const rank = rdvRankMap(allRows || rows);
  return rows.filter((r) => !r.deleted_at).map((r) => ({
    "Date": dt(r.date_rdv), "RDV n°": rank.get(r.id)?.n || 1, "Client": r.client_nom, "Téléphone": r.tel || "", "Vendeur": r.commercial, "Type": r.type_rdv, "Source": r.source || "",
    "Véhicule visé": r.vehicule_vise || "", "Statut": r.statut, "Honoré": r.venu ? "Oui" : "Non", "Motif de perte": r.motif_perte || "",
    "Type de vente": r.statut === "Vendu" ? r.vente_type || "" : "", "Véhicule vendu": r.statut === "Vendu" ? r.vente_vehicule || "" : "", "Relance": r.relance || "", "Commentaire": r.commentaire || "", "Résultat saisi le": dt(r.suivi_at),
  }));
}
async function exportRdvToExcel(rows, label, allRows) {
  const XLSX = await loadXLSX();
  const data = rdvExportRows(rows, allRows);
  const ws = XLSX.utils.json_to_sheet(data.length ? data : [{ "Aucun rendez-vous": "" }]);
  ws["!cols"] = Object.keys(data[0] || { x: 1 }).map((k) => ({ wch: Math.max(k.length + 2, 16) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Rendez-vous");
  XLSX.writeFile(wb, `parclive-rdv-${label || "export"}-${new Date().toISOString().slice(0, 10)}.xlsx`);
}
// RDV-LOGIC-END

// Renvoie { nom, role } si le compte connecté figure dans rdv_members (RLS applique la vraie restriction côté base).
function useRdvAccess(userId) {
  const [me, setMe] = useState(undefined); // undefined = en cours de vérification, null = pas d'accès
  useEffect(() => {
    let alive = true;
    if (!userId) return undefined; // session pas encore connue : on reste en « vérification »
    supabase
      .from("rdv_members")
      .select("nom, role")
      .eq("user_id", userId)
      .maybeSingle()
      .then(({ data }) => { if (alive) setMe(data ? { nom: data.nom, role: data.role } : null); });
    return () => { alive = false; };
  }, [userId]);
  return me;
}

async function rdvFetchAll(build) {
  const out = [];
  for (let from = 0; from < 30000; from += 1000) {
    const { data, error } = await build().range(from, from + 999);
    if (error) return { data: null, error };
    out.push(...data);
    if (data.length < 1000) break;
  }
  return { data: out, error: null };
}

function useRdv(me) {
  const role = me?.role || "";
  const [state, setState] = useState({ rows: [], objectifs: [], archive: [], members: [], notes: [], planning: [], absences: [], loading: true, error: null });
  const sigRef = useRef("");
  const timer = useRef(null);
  const purged = useRef(false);

  const load = useCallback(async () => {
    if (!role) return;
    const admin = role === "admin";
    const [r, o, a, m, n, pl, ab] = await Promise.all([
      rdvFetchAll(() => supabase.from("rdv").select("*").order("date_rdv", { ascending: false }).order("id")),
      supabase.from("rdv_objectifs").select("*"),
      admin ? supabase.from("rdv_archive_mensuel").select("*") : Promise.resolve({ data: [] }),
      admin ? supabase.from("rdv_members").select("*").order("nom") : Promise.resolve({ data: [] }),
      rdvFetchAll(() => supabase.from("rdv_notes").select("*").order("at", { ascending: false }).order("id")),
      supabase.from("rdv_planning").select("*"),
      supabase.from("rdv_absences").select("*").order("du"),
    ]);
    const err = r.error || o.error || a.error || m.error || n.error || pl.error || ab.error;
    if (err) { setState((s) => ({ ...s, loading: false, error: err.message })); return; }
    const maxU = (rows) => rows.reduce((x, y) => ((y.updated_at || "") > x ? y.updated_at : x), "");
    const sig = `${r.data.length}:${maxU(r.data)}|${o.data.length}:${maxU(o.data)}|${m.data.map((x) => x.user_id).join(",")}|${a.data.length}|${n.data.length}:${n.data[0]?.id || ""}|${pl.data.map((x) => x.commercial + (x.repos || []).join("")).join(",")}|${ab.data.map((x) => x.id).join(",")}`;
    if (sig !== sigRef.current) {
      sigRef.current = sig;
      setState({ rows: r.data, objectifs: o.data || [], archive: a.data || [], members: m.data || [], notes: n.data || [], planning: pl.data || [], absences: ab.data || [], loading: false, error: null });
    } else setState((s) => (s.loading || s.error ? { ...s, loading: false, error: null } : s));
  }, [role]);

  const scheduleLoad = useCallback(() => { clearTimeout(timer.current); timer.current = setTimeout(load, 300); }, [load]);

  useEffect(() => {
    if (!role) return undefined;
    load().then(() => {
      if (role === "admin" && !purged.current) { purged.current = true; supabase.rpc("rdv_purge").then(() => {}, () => {}); }
    });
    const ch = supabase
      .channel("rdv-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "rdv" }, scheduleLoad)
      .on("postgres_changes", { event: "*", schema: "public", table: "rdv_notes" }, scheduleLoad)
      .on("postgres_changes", { event: "*", schema: "public", table: "rdv_planning" }, scheduleLoad)
      .on("postgres_changes", { event: "*", schema: "public", table: "rdv_absences" }, scheduleLoad)
      .subscribe();
    const onVis = () => { if (document.visibilityState === "visible") load(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { clearTimeout(timer.current); supabase.removeChannel(ch); document.removeEventListener("visibilitychange", onVis); };
  }, [role, load, scheduleLoad]);

  const refresh = useCallback(async () => { sigRef.current = ""; await load(); }, [load]);
  const patchLocal = useCallback((row) => setState((s) => ({ ...s, rows: s.rows.some((x) => x.id === row.id) ? s.rows.map((x) => (x.id === row.id ? row : x)) : [row, ...s.rows] })), []);

  // fields.parent_id : création de la suite d'un rendez-vous (même affaire). Le relance du rendez-vous précédent est alors soldée.
  const create = useCallback(async (fields) => {
    const payload = rdvCleanRow(fields);
    if (fields.parent_id) payload.parent_id = fields.parent_id;
    const row = await marketingExec(() => supabase.from("rdv").insert(payload).select().single());
    patchLocal(row);
    if (fields.parent_id) {
      try { const parent = await marketingExec(() => supabase.from("rdv").update({ relance: null }).eq("id", fields.parent_id).select().single()); patchLocal(parent); } catch { /* best effort */ }
    }
    return row;
  }, [patchLocal]);
  const update = useCallback(async (id, patch) => {
    const row = await marketingExec(() => supabase.from("rdv").update(patch).eq("id", id).select().single());
    patchLocal(row);
    return row;
  }, [patchLocal]);
  const reassign = useCallback(async (ids, nom) => {
    if (!ids.length) return;
    await marketingExec(() => supabase.from("rdv").update({ commercial: nom }).in("id", ids));
    await refresh();
  }, [refresh]);
  const saveObjectif = useCallback(async (commercial, vals) => {
    await marketingExec(() => supabase.from("rdv_objectifs").upsert({ commercial, ...vals }, { onConflict: "commercial" }));
    await refresh();
  }, [refresh]);
  const addMember = useCallback(async (email, nom) => {
    const data = await marketingExec(() => supabase.rpc("rdv_add_member", { p_email: email, p_nom: nom }));
    await refresh();
    return !!data;
  }, [refresh]);
  const removeMember = useCallback(async (userId) => {
    await marketingExec(() => supabase.rpc("rdv_remove_member", { p_user: userId }));
    await refresh();
  }, [refresh]);
  const addNote = useCallback(async (rdvId, type, texte) => {
    const row = await marketingExec(() => supabase.from("rdv_notes").insert({ rdv_id: rdvId, type, texte: (texte || "").trim() || null }).select().single());
    setState((st) => ({ ...st, notes: [row, ...st.notes] }));
    return row;
  }, []);
  const savePlanning = useCallback(async (commercial, repos) => {
    await marketingExec(() => supabase.from("rdv_planning").upsert({ commercial, repos, updated_at: new Date().toISOString() }, { onConflict: "commercial" }));
    await refresh();
  }, [refresh]);
  const addAbsence = useCallback(async (a) => {
    await marketingExec(() => supabase.from("rdv_absences").insert({ commercial: a.commercial, du: a.du, au: a.au, note: (a.note || "").trim() || null }));
    await refresh();
  }, [refresh]);
  const removeAbsence = useCallback(async (id) => {
    await marketingExec(() => supabase.from("rdv_absences").delete().eq("id", id));
    await refresh();
  }, [refresh]);
  const loadHistory = useCallback(async (id) => {
    return marketingExec(() => supabase.from("rdv_history").select("*").eq("rdv_id", id).order("at", { ascending: false }).limit(100));
  }, []);

  const plan = useMemo(() => rdvBuildPlan(state.planning, state.absences), [state.planning, state.absences]);
  return { ...state, plan, refresh, create, update, reassign, saveObjectif, addMember, removeMember, addNote, savePlanning, addAbsence, removeAbsence, loadHistory };
}

// ───────── Petits composants ─────────
const RDV_STATUT_STYLE = {
  "À venir": { light: "bg-blue-50 text-blue-700", dark: "bg-blue-500/15 text-blue-300", dot: "bg-blue-500" },
  "Honoré": { light: "bg-emerald-50 text-emerald-700", dark: "bg-emerald-500/15 text-emerald-300", dot: "bg-emerald-500" },
  "Absent": { light: "bg-orange-50 text-orange-700", dark: "bg-orange-500/15 text-orange-300", dot: "bg-orange-500" },
  "Vendu": { light: "bg-violet-50 text-violet-700", dark: "bg-violet-500/15 text-violet-300", dot: "bg-violet-600" },
  "Perdu": { light: "bg-stone-100 text-stone-600", dark: "bg-zinc-800 text-zinc-400", dot: "bg-stone-400" },
};
const RDV_ACTION_STYLE = {
  "Honoré": { light: "bg-emerald-600 text-white hover:bg-emerald-500", dark: "bg-emerald-600 text-white hover:bg-emerald-500" },
  "Absent": { light: "bg-orange-50 text-orange-700 hover:bg-orange-100", dark: "bg-orange-500/15 text-orange-300 hover:bg-orange-500/25" },
  "Vendu": { light: "bg-violet-600 text-white hover:bg-violet-500", dark: "bg-violet-600 text-white hover:bg-violet-500" },
  "Perdu": { light: "bg-stone-100 text-stone-600 hover:bg-stone-200", dark: "bg-zinc-800 text-zinc-300 hover:bg-zinc-700" },
};
const RDV_PILL_TONES = {
  rose: { light: "bg-rose-50 text-rose-700", dark: "bg-rose-500/15 text-rose-300" },
  amber: { light: "bg-amber-50 text-amber-800", dark: "bg-amber-500/15 text-amber-300" },
  gray: { light: "bg-stone-100 text-stone-600", dark: "bg-zinc-800 text-zinc-400" },
  blue: { light: "bg-blue-50 text-blue-700", dark: "bg-blue-500/15 text-blue-300" },
};
function RdvStatutChip({ dark, statut }) {
  const st = RDV_STATUT_STYLE[statut] || RDV_STATUT_STYLE["À venir"];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold ${dark ? st.dark : st.light}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${st.dot}`} />{statut}
    </span>
  );
}
function RdvPill({ dark, tone, children, title }) {
  const t = RDV_PILL_TONES[tone] || RDV_PILL_TONES.gray;
  return <span title={title} className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${dark ? t.dark : t.light}`}>{children}</span>;
}
function RdvBar({ dark, value, max, tone }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  const fill = tone === "good" ? "bg-emerald-500" : tone === "warn" ? "bg-amber-500" : tone === "bad" ? "bg-rose-500" : "bg-blue-600";
  return (
    <div className={`h-1.5 w-full overflow-hidden rounded-full ${dark ? "bg-zinc-800" : "bg-stone-100"}`}>
      <div className={`h-full rounded-full ${fill}`} style={{ width: `${pct}%` }} />
    </div>
  );
}
function RdvKpi({ dark, label, value, sub, tone, onClick }) {
  const s = marketingStyles(dark);
  const valueTone = tone === "bad" ? (dark ? "text-rose-300" : "text-rose-600") : tone === "warn" ? (dark ? "text-amber-300" : "text-amber-700") : tone === "good" ? (dark ? "text-emerald-300" : "text-emerald-600") : s.title;
  const Cmp = onClick ? "button" : "div";
  return (
    <Cmp onClick={onClick} className={`rounded-xl border px-4 py-3 text-left ${s.card} ${onClick ? "pl-interactive" : ""}`}>
      <div className={`text-xs ${s.sub}`}>{label}</div>
      <div className={`mt-0.5 text-2xl font-semibold tabular-nums ${valueTone}`}>{value}</div>
      {sub != null && <div className={`mt-0.5 text-xs ${s.muted}`}>{sub}</div>}
    </Cmp>
  );
}
function RdvSection({ dark, title, count, tone, children, right }) {
  const s = marketingStyles(dark);
  const toneCls = tone === "rose" ? (dark ? "text-rose-300" : "text-rose-600") : tone === "amber" ? (dark ? "text-amber-300" : "text-amber-700") : s.title;
  return (
    <section>
      <div className="mb-2 flex items-center gap-2">
        <h3 className={`text-sm font-semibold ${toneCls}`}>{title}</h3>
        {count != null && <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${dark ? "bg-zinc-800 text-zinc-300" : "bg-stone-100 text-stone-600"}`}>{count}</span>}
        {right && <div className="ml-auto">{right}</div>}
      </div>
      {children}
    </section>
  );
}
function rdvDownloadIcs(r) {
  const blob = new Blob([rdvIcs(r)], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `rdv-${stripAccents(r.client_nom).replace(/\W+/g, "-").toLowerCase()}.ics`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
function rdvFrDay(r) {
  return new Date(r.date_rdv).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" });
}

function RdvRow({ dark, r, now, today, isAdmin, vehicleByOrder, onOpen, onAction, onSuite, rank, plan, selected, onSelect, showDate, busy }) {
  const s = marketingStyles(dark);
  const overdue = rdvIsOverdue(r, now);
  const dayIso = rdvDay(r);
  const done = r.statut === "Vendu" || r.statut === "Perdu";
  const warn = rdvVehicleWarning(r, vehicleByOrder);
  const relanceDue = rdvRelanceDue(r, today, plan);
  const effRelance = rdvEffectiveRelance(r, plan);
  const shifted = !!r.relance && effRelance !== r.relance;
  const offDay = r.statut === "À venir" && !overdue ? rdvOffReason(plan, r.commercial, dayIso) : "";
  const canSuite = !!onSuite && (r.statut === "Honoré" || r.statut === "Absent") && (!rank || rank.n === rank.total);
  let acts = [];
  if (r.statut === "À venir" && dayIso <= today) acts = ["Honoré", "Absent"];
  else if (r.statut === "Honoré") acts = ["Vendu", "Perdu"];
  else if (r.statut === "Absent") acts = ["Honoré", "Perdu"];
  const stop = (e) => e.stopPropagation();
  const iconBtn = `flex h-8 w-8 items-center justify-center rounded-lg transition-colors ${dark ? "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100" : "text-stone-500 hover:bg-stone-100 hover:text-stone-900"}`;
  const border = overdue ? (dark ? "border-rose-500/30 bg-rose-500/5" : "border-rose-200 bg-rose-50/40") : s.card;
  return (
    <div
      onClick={() => onOpen(r.id)}
      className={`flex cursor-pointer flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border px-4 py-3 transition-colors ${border} ${dark ? "hover:border-zinc-700" : "hover:border-blue-300"} ${busy ? "opacity-60" : ""}`}
    >
      {onSelect && (
        <input type="checkbox" checked={!!selected} onClick={stop} onChange={() => onSelect(r.id)} className="h-4 w-4 shrink-0 accent-blue-600" aria-label="Sélectionner" />
      )}
      <div className="w-[68px] shrink-0">
        {showDate && <div className={`text-[11px] font-medium capitalize ${s.sub}`}>{rdvFrDay(r)}</div>}
        <div className={`text-base font-semibold tabular-nums ${s.title}`}>{rdvTime(r)}</div>
      </div>
      <div className="min-w-0 flex-1 basis-56">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className={`truncate font-semibold ${s.title}`}>{r.client_nom}</span>
          <RdvStatutChip dark={dark} statut={r.statut} />
          {rank && rank.total > 1 && <RdvPill dark={dark} tone="blue" title={`Rendez-vous ${rank.n} sur ${rank.total} pour cette affaire`}>RDV n°{rank.n}</RdvPill>}
          {overdue && <RdvPill dark={dark} tone="rose">{rdvOverdueDays(r, today) > 0 ? `Sans suivi · ${rdvOverdueDays(r, today)} j` : "Résultat à saisir"}</RdvPill>}
          {relanceDue && <RdvPill dark={dark} tone="amber" title={shifted ? `Prévue le ${marketingFrDate(r.relance)} (jour d'absence) : reportée` : undefined}><Bell size={11} /> Relance {marketingRelativeLabel(effRelance, today)}</RdvPill>}
          {!relanceDue && r.relance && (r.statut === "Honoré" || r.statut === "Absent") && <RdvPill dark={dark} tone="gray" title={shifted ? `Prévue le ${marketingFrDate(r.relance)} (jour d'absence) : reportée` : undefined}>Relance {marketingFrDate(effRelance)}</RdvPill>}
          {offDay && <RdvPill dark={dark} tone="amber" title="Le vendeur n'est pas présent ce jour-là"><AlertTriangle size={11} /> {offDay}</RdvPill>}
          {warn && <RdvPill dark={dark} tone="amber"><AlertTriangle size={11} /> {warn}</RdvPill>}
        </div>
        <div className={`mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs ${s.muted}`}>
          {isAdmin && <span className={`font-medium ${dark ? "text-zinc-300" : "text-stone-700"}`}>{r.commercial}</span>}
          {isAdmin && <span>·</span>}
          <span>{r.type_rdv}</span>
          {r.source && <span>· {r.source}</span>}
          {r.vehicule_vise && <span className="truncate">· {r.vehicule_vise}</span>}
        </div>
        {r.statut === "Vendu" && rdvVenteLabel(r) && <div className={`mt-0.5 truncate text-xs font-medium ${dark ? "text-violet-300" : "text-violet-700"}`}>Vendu : {rdvVenteLabel(r)}</div>}
        {r.commentaire && <div className={`mt-1 truncate text-xs italic ${s.sub}`}>« {r.commentaire} »</div>}
      </div>
      <div className="flex shrink-0 items-center gap-1.5" onClick={stop}>
        {acts.map((a) => (
          <button key={a} disabled={busy} onClick={() => onAction(r, a)} className={`pl-interactive rounded-lg px-3 py-1.5 text-[13px] font-semibold transition-colors disabled:opacity-50 ${dark ? RDV_ACTION_STYLE[a].dark : RDV_ACTION_STYLE[a].light}`}>{a}</button>
        ))}
        {canSuite && <button disabled={busy} onClick={() => onSuite(r)} className={`pl-interactive flex items-center gap-1 rounded-lg px-3 py-1.5 text-[13px] font-semibold transition-colors ${dark ? "bg-blue-500/15 text-blue-300 hover:bg-blue-500/25" : "bg-blue-50 text-blue-700 hover:bg-blue-100"}`} title="Planifier un nouveau rendez-vous pour ce client"><CalendarPlus size={14} /> Suite</button>}
        {r.tel && <a href={`tel:${rdvTelClean(r.tel)}`} title={`Appeler ${r.tel}`} className={iconBtn}><Phone size={16} /></a>}
        {r.tel && !done && <a href={rdvSmsHref(r, today)} title="SMS de rappel prérempli" className={iconBtn}><MessageSquare size={16} /></a>}
        {!done && <button onClick={() => rdvDownloadIcs(r)} title="Ajouter à l'agenda du téléphone" className={iconBtn}><CalendarPlus size={16} /></button>}
      </div>
    </div>
  );
}

function rdvLocalInput(iso) {
  const d = iso ? new Date(iso) : new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
function rdvVehicleLabel(v) {
  return `${[v.model, v.trim, v.color].filter(Boolean).join(" ")} · ${v.orderNumber}`;
}
function rdvFormatChange(key, pair) {
  const [o, n] = pair;
  if (key === "deleted_at") return n ? "Mis à la corbeille" : "Restauré depuis la corbeille";
  const fmt = (v) => {
    if (v == null || v === "") return "—";
    if (key === "date_rdv") return new Date(v).toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
    if (key === "relance") return marketingFrDate(v);
    if (key === "vehicules") return Array.isArray(v) && v.length ? v.map((x) => x.label).join(" + ") : "—";
    const t = String(v);
    return t.length > 60 ? t.slice(0, 57) + "…" : t;
  };
  return `${RDV_FIELD_LABELS[key] || key} : ${fmt(o)} → ${fmt(n)}`;
}

// Sélecteur de vendeur à la frappe : « le », « ant »… trouvent LEROY Anthony (début du nom ou du prénom).
function rdvMatchVendeur(names, q) {
  const n = stripAccents(q).toLowerCase().trim();
  if (!n) return names;
  const starts = [], inside = [];
  names.forEach((nom) => {
    const hay = stripAccents(nom).toLowerCase();
    if (hay.split(/[\s'-]+/).some((w) => w.startsWith(n)) || hay.startsWith(n)) starts.push(nom);
    else if (hay.includes(n)) inside.push(nom);
  });
  return [...starts, ...inside];
}
function RdvVendeurPicker({ dark, value, onChange, names, plan, date, allLabel, placeholder, className, autoFocus, disabled }) {
  const s = marketingStyles(dark);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const list = useMemo(() => rdvMatchVendeur(names, q).slice(0, 8), [names, q]);
  const showAll = !!allLabel && !q.trim();
  const items = showAll ? ["", ...list] : list;
  const choose = (nom) => { onChange(nom); setQ(""); setOpen(false); };
  const onKey = (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setHi((h) => Math.min(items.length - 1, h + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHi((h) => Math.max(0, h - 1)); }
    else if (e.key === "Enter" || (e.key === "Tab" && q.trim() && items.length)) { if (open && items.length) { if (e.key === "Enter") e.preventDefault(); choose(items[Math.min(hi, items.length - 1)]); } }
    else if (e.key === "Escape") { setOpen(false); setQ(""); }
  };
  const display = open ? q : value || "";
  return (
    <div className={`relative ${className || ""}`}>
      <Search size={14} className={`pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 ${s.sub}`} />
      <input
        className={`${s.input} !pl-9 ${value && !open ? "font-medium" : ""}`}
        value={display}
        disabled={disabled}
        autoFocus={autoFocus}
        placeholder={value ? value : allLabel || placeholder || "Chercher un vendeur…"}
        onFocus={() => { setOpen(true); setHi(0); }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={(e) => { setQ(e.target.value); setOpen(true); setHi(0); }}
        onKeyDown={onKey}
        role="combobox"
        aria-expanded={open}
        aria-label="Vendeur"
      />
      {value && !disabled && (
        <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => choose("")} className={`absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 ${dark ? "text-zinc-500 hover:bg-zinc-800" : "text-stone-400 hover:bg-stone-100"}`} aria-label="Effacer le vendeur"><X size={13} /></button>
      )}
      {open && (
        <ul className={`absolute left-0 right-0 z-20 mt-1 max-h-64 min-w-[220px] overflow-auto rounded-lg border p-1 shadow-lg ${dark ? "border-zinc-800 bg-zinc-900" : "border-stone-200 bg-white"}`}>
          {items.length === 0 && <li className={`px-2.5 py-2 text-sm ${s.sub}`}>Aucun vendeur ne commence par « {q.trim()} »</li>}
          {items.map((nom, i) => {
            const off = nom && plan && date ? rdvOffReason(plan, nom, date) : "";
            return (
              <li key={nom || "__all"}>
                <button type="button" onMouseDown={(e) => e.preventDefault()} onMouseEnter={() => setHi(i)} onClick={() => choose(nom)}
                  className={`flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm ${i === hi ? (dark ? "bg-zinc-800" : "bg-stone-100") : ""} ${s.title}`}>
                  <span className="min-w-0 flex-1 truncate">{nom || allLabel}</span>
                  {off && <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${dark ? "bg-amber-500/15 text-amber-300" : "bg-amber-50 text-amber-800"}`}>{off}</span>}
                  {nom && nom === value && <Check size={13} className="shrink-0 text-emerald-500" />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function RdvVehiclePicker({ dark, label, refNum, vehicles, onChange, filter, placeholder }) {
  const s = marketingStyles(dark);
  const [open, setOpen] = useState(false);
  const q = stripAccents(label || "").toLowerCase().trim();
  const sugg = useMemo(() => {
    if (refNum || q.length < 2) return [];
    const parts = q.split(/\s+/);
    return vehicles
      .filter((v) => (filter ? filter(v) : v.baseStatus !== "livre_client" && v.baseStatus !== "vendu"))
      .filter((v) => { const hay = stripAccents([v.model, v.trim, v.color, v.orderNumber, v.vin].join(" ")).toLowerCase(); return parts.every((p) => hay.includes(p)); })
      .slice(0, 6);
  }, [vehicles, q, refNum, filter]);
  return (
    <div className="relative">
      <input
        className={s.input}
        value={label || ""}
        placeholder={placeholder || "Modèle, finition, n° de commande… (stock ou texte libre)"}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={(e) => onChange({ label: e.target.value, ref: "" })}
      />
      {refNum && (
        <div className={`mt-1 flex items-center gap-1.5 text-xs ${s.muted}`}>
          <Check size={12} className="text-emerald-500" /> Lié au stock (commande {refNum})
          <button type="button" onClick={() => onChange({ label: "", ref: "" })} className="ml-1 underline">retirer</button>
        </div>
      )}
      {open && sugg.length > 0 && (
        <ul className={`absolute left-0 right-0 z-10 mt-1 max-h-60 overflow-auto rounded-lg border p-1 shadow-lg ${dark ? "border-zinc-800 bg-zinc-900" : "border-stone-200 bg-white"}`}>
          {sugg.map((v) => (
            <li key={v.orderNumber}>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => { onChange({ label: rdvVehicleLabel(v), ref: v.orderNumber }); setOpen(false); }}
                className={`flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm ${dark ? "hover:bg-zinc-800" : "hover:bg-stone-100"}`}>
                <span className={`min-w-0 flex-1 truncate ${s.title}`}>{rdvVehicleLabel(v)}</span>
                <span className={`shrink-0 text-xs ${s.sub}`}>{STATUS_META[v.baseStatus]?.label}{v.joursStock != null ? ` · ${v.joursStock} j` : ""}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Véhicules visés : plusieurs possibles, chacun pris dans le stock ou en commande (liée à une commande listée, ou décrite librement).
function RdvVehiclesField({ dark, value, onChange, vehicles }) {
  const s = marketingStyles(dark);
  const [type, setType] = useState("Stock");
  const [draft, setDraft] = useState("");
  const add = (v) => {
    const label = String(v.label || "").trim();
    if (!label) return;
    if (v.ref && value.some((x) => x.ref === v.ref)) { setDraft(""); return; }
    onChange([...value, { type: v.type, label, ref: v.ref || null }]);
    setDraft("");
  };
  const stockFilter = (v) => v.baseStatus !== "livre_client" && v.baseStatus !== "vendu" && v.baseStatus !== "commande";
  const orderFilter = (v) => v.baseStatus === "commande";
  const typeBtn = (k, lbl) => (
    <button key={k} type="button" onClick={() => { setType(k); setDraft(""); }} className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${type === k ? (dark ? "bg-blue-500/20 text-blue-200 ring-1 ring-blue-500/50" : "bg-blue-600 text-white") : dark ? "bg-zinc-800 text-zinc-400 hover:bg-zinc-700" : "bg-stone-100 text-stone-600 hover:bg-stone-200"}`}>{lbl}</button>
  );
  return (
    <div className="space-y-2">
      {value.length > 0 && (
        <ul className="space-y-1.5">
          {value.map((v, i) => (
            <li key={`${v.ref || v.label}-${i}`} className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-sm ${dark ? "border-zinc-800 bg-zinc-950" : "border-stone-200 bg-white"}`}>
              <RdvPill dark={dark} tone={v.type === "Stock" ? "blue" : "amber"}>{v.type === "Stock" ? "Stock" : "Commande"}</RdvPill>
              <span className={`min-w-0 flex-1 truncate ${s.title}`}>{v.label}</span>
              <button type="button" onClick={() => onChange(value.filter((_, j) => j !== i))} className={`rounded p-1 ${dark ? "text-zinc-500 hover:bg-zinc-800" : "text-stone-400 hover:bg-stone-100"}`} aria-label={`Retirer ${v.label}`}><X size={14} /></button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className={`text-xs ${s.sub}`}>{value.length ? "Ajouter un autre :" : "Ajouter :"}</span>
        {typeBtn("Stock", "Véhicule du stock")}
        {typeBtn("Commande", "Commande")}
      </div>
      <div onKeyDown={(e) => { if (e.key === "Enter" && type === "Commande" && draft.trim()) { e.preventDefault(); add({ type, label: draft, ref: "" }); } }} className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <RdvVehiclePicker key={type} dark={dark} label={draft} refNum="" vehicles={vehicles} filter={type === "Stock" ? stockFilter : orderFilter}
            placeholder={type === "Stock" ? "Chercher dans le stock : modèle, finition, n° de commande…" : "Commande : modèle, finition, couleur… (ou véhicule commandé listé)"}
            onChange={({ label, ref }) => { if (ref) add({ type, label, ref }); else setDraft(label); }} />
        </div>
        {type === "Commande" && <button type="button" onClick={() => add({ type, label: draft, ref: "" })} disabled={!draft.trim()} className={s.ghostBtn}>Ajouter</button>}
      </div>
      <div className={`text-xs ${s.sub}`}>{type === "Stock" ? "Cliquez sur un véhicule de la liste pour l'ajouter." : "Choisissez une commande listée, ou décrivez-la puis « Ajouter » (Entrée)."}</div>
    </div>
  );
}

function RdvField({ dark, label, children, hint }) {
  const s = marketingStyles(dark);
  return (
    <label className="block">
      <div className={s.label}>{label}</div>
      {children}
      {hint && <div className={`mt-1 text-xs ${s.sub}`}>{hint}</div>}
    </label>
  );
}

// Création / modification d'un rendez-vous (administrateur).
function RdvFormModal({ dark, initial, suiteOf, isAdmin, today, plan, vendeurNames, vehicles, rows, onSave, onClose }) {
  const s = marketingStyles(dark);
  const editing = !!initial?.id;
  const suite = !!suiteOf && !editing;
  const lockIdentity = suite && !isAdmin; // un vendeur ne peut pas changer le client ni le vendeur de la suite
  const defaultStart = () => {
    const base = suite ? suiteOf.relance || marketingAddDays(today, 3) : marketingAddDays(today, 1);
    const day = suite ? rdvNextPresent(plan, suiteOf.commercial, base < today ? today : base) : base;
    return new Date(`${day}T10:00:00`).toISOString();
  };
  const [f, setF] = useState(() => ({
    client_nom: initial?.client_nom || suiteOf?.client_nom || "", tel: initial?.tel || suiteOf?.tel || "", commercial: initial?.commercial || suiteOf?.commercial || "",
    date: rdvLocalInput(initial?.date_rdv || defaultStart()), type_rdv: initial?.type_rdv || "Showroom", source: initial?.source || suiteOf?.source || "",
    vehicules: rdvVehiclesOf(initial || suiteOf || {}), consigne: initial?.consigne || "",
  }));
  const [another, setAnother] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const dups = useMemo(() => (suite ? [] : rdvDuplicates(rows, f.tel, initial?.id)), [rows, f.tel, initial?.id, suite]);
  const dateOk = f.date && !isNaN(new Date(f.date));
  const dayIso = dateOk ? prospectionTodayISO(new Date(f.date)) : "";
  const timePart = f.date ? f.date.slice(11, 16) : "10:00";
  const offReason = f.commercial && dayIso ? rdvOffReason(plan, f.commercial, dayIso) : "";
  const nextDay = offReason ? rdvNextPresent(plan, f.commercial, dayIso) : "";
  const available = offReason && isAdmin ? rdvPresentNames(plan, vendeurNames.filter((n) => n !== f.commercial), dayIso) : [];
  const clashes = useMemo(() => (dateOk && f.commercial ? rdvConflicts(rows, f.commercial, new Date(f.date).toISOString(), initial?.id) : []), [rows, f.commercial, f.date, dateOk, initial?.id]);
  const valid = f.client_nom.trim() && f.commercial && dateOk;
  const submit = async () => {
    if (!valid || saving) return;
    setSaving(true); setErr("");
    try {
      await onSave({ ...f, date_rdv: new Date(f.date).toISOString(), parent_id: suite ? suiteOf.id : undefined }, another);
      if (another && !editing && !suite) setF((x) => ({ ...x, client_nom: "", tel: "", vehicules: [], consigne: "" }));
    } catch (e) { setErr(e.message || String(e)); }
    setSaving(false);
  };
  return (
    <Modal dark={dark} title={editing ? "Modifier le rendez-vous" : suite ? "Planifier la suite" : "Nouveau rendez-vous"} onClose={onClose}>
      <div className="space-y-3">
        {suite && (
          <div className={`rounded-lg px-3 py-2 text-xs ${dark ? "bg-blue-500/10 text-blue-200" : "bg-blue-50 text-blue-800"}`}>
            Nouveau rendez-vous pour <span className="font-semibold">{suiteOf.client_nom}</span>, rattaché au rendez-vous du {new Date(suiteOf.date_rdv).toLocaleDateString("fr-FR", { day: "numeric", month: "long" })} : l'affaire garde tout son parcours.
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <RdvField dark={dark} label="Client *"><input className={s.input} value={f.client_nom} onChange={set("client_nom")} placeholder="Nom du client" autoFocus={!suite} disabled={lockIdentity} /></RdvField>
          <RdvField dark={dark} label="Téléphone"><input className={s.input} value={f.tel} onChange={set("tel")} inputMode="tel" placeholder="06 12 34 56 78" disabled={lockIdentity} /></RdvField>
        </div>
        {dups.length > 0 && (
          <div className={`rounded-lg border px-3 py-2 text-xs ${dark ? "border-amber-500/30 bg-amber-500/10 text-amber-200" : "border-amber-200 bg-amber-50 text-amber-900"}`}>
            <div className="mb-1 flex items-center gap-1.5 font-semibold"><AlertTriangle size={13} /> Ce numéro existe déjà</div>
            {dups.slice(0, 3).map((d) => (
              <div key={d.id}>{d.client_nom} · {new Date(d.date_rdv).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })} · {d.commercial} · {d.statut}</div>
            ))}
            {dups.length > 3 && <div>… et {dups.length - 3} autre{dups.length - 3 > 1 ? "s" : ""}</div>}
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <RdvField dark={dark} label="Vendeur *" hint={lockIdentity ? undefined : "Tapez les premières lettres du nom ou du prénom"}>
            <RdvVendeurPicker dark={dark} value={f.commercial} names={vendeurNames} plan={plan} date={dayIso} disabled={lockIdentity} onChange={(nom) => setF((x) => ({ ...x, commercial: nom }))} autoFocus={!suite && !!f.client_nom && !f.commercial} />
          </RdvField>
          <RdvField dark={dark} label="Date et heure *"><input type="datetime-local" className={s.input} value={f.date} onChange={set("date")} /></RdvField>
          <RdvField dark={dark} label="Type">
            <select className={s.input} value={f.type_rdv} onChange={set("type_rdv")}>{RDV_TYPES.map((t) => <option key={t}>{t}</option>)}</select>
          </RdvField>
          <RdvField dark={dark} label="Source">
            <input className={s.input} list="rdv-sources" value={f.source} onChange={set("source")} placeholder="Internet, téléphone…" />
            <datalist id="rdv-sources">{RDV_SOURCES.map((x) => <option key={x} value={x} />)}</datalist>
          </RdvField>
        </div>
        {offReason && (
          <div className={`rounded-lg border px-3 py-2 text-xs ${dark ? "border-amber-500/30 bg-amber-500/10 text-amber-200" : "border-amber-200 bg-amber-50 text-amber-900"}`}>
            <div className="flex items-center gap-1.5 font-semibold"><AlertTriangle size={13} /> {f.commercial} n'est pas là ce jour-là · {offReason}</div>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <button type="button" onClick={() => setF((x) => ({ ...x, date: `${nextDay}T${timePart}` }))} className={`rounded-md px-2 py-1 font-semibold ${dark ? "bg-amber-500/20 hover:bg-amber-500/30" : "bg-amber-100 hover:bg-amber-200"}`}>
                Décaler au {new Date(nextDay + "T12:00:00").toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })}
              </button>
              {available.length > 0 && <span className="opacity-80">ou confier à :</span>}
              {available.slice(0, 6).map((n) => (
                <button key={n} type="button" onClick={() => setF((x) => ({ ...x, commercial: n }))} className={`rounded-md px-2 py-1 font-semibold ${dark ? "bg-zinc-800 text-zinc-100 hover:bg-zinc-700" : "bg-white text-stone-800 hover:bg-stone-100"}`}>{n}</button>
              ))}
            </div>
          </div>
        )}
        {clashes.length > 0 && (
          <div className={`rounded-lg border px-3 py-2 text-xs ${dark ? "border-amber-500/30 bg-amber-500/10 text-amber-200" : "border-amber-200 bg-amber-50 text-amber-900"}`}>
            <div className="flex items-center gap-1.5 font-semibold"><AlertTriangle size={13} /> {f.commercial} a déjà un rendez-vous à ce moment</div>
            {clashes.slice(0, 3).map((c) => <div key={c.id}>{rdvTime(c)} · {c.client_nom} · {c.type_rdv}</div>)}
          </div>
        )}
        <div>
          <div className={s.label}>Véhicules visés</div>
          <RdvVehiclesField dark={dark} value={f.vehicules} vehicles={vehicles} onChange={(list) => setF((x) => ({ ...x, vehicules: list }))} />
        </div>
        <RdvField dark={dark} label={suite && !isAdmin ? "Note pour ce rendez-vous" : "Consigne pour le vendeur"} hint="Contexte utile : reprise, financement, attentes du client…">
          <textarea className={s.input} rows={2} value={f.consigne} onChange={set("consigne")} />
        </RdvField>
        {err && <div className={`rounded-lg px-3 py-2 text-sm ${dark ? "bg-rose-500/10 text-rose-300" : "bg-rose-50 text-rose-700"}`}>{err}</div>}
        <div className="flex flex-wrap items-center gap-3 pt-1">
          {!editing && !suite && (
            <label className={`flex items-center gap-2 text-sm ${s.muted}`}>
              <input type="checkbox" checked={another} onChange={(e) => setAnother(e.target.checked)} className="h-4 w-4 accent-blue-600" /> En créer un autre ensuite
            </label>
          )}
          <div className="ml-auto flex gap-2">
            <button onClick={onClose} className={s.ghostBtn}>Annuler</button>
            <button onClick={submit} disabled={!valid || saving} className={s.primaryBtn}>{saving ? "Enregistrement…" : editing ? "Enregistrer" : suite ? "Planifier la suite" : "Créer le rendez-vous"}</button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

// Fiche d'un rendez-vous : informations, saisie du suivi, historique.
function RdvModal({ dark, rdv, preset, isAdmin, vehicles, vehicleByOrder, today, plan, chain, notes, onClose, onSaveSuivi, onEdit, onDelete, onSuite, onOpenOther, onAddNote, loadHistory }) {
  const s = marketingStyles(dark);
  const tomorrow = marketingAddDays(today, 1);
  const [statut, setStatutRaw] = useState(preset || rdv.statut);
  const [commentaire, setCommentaire] = useState(rdv.commentaire || "");
  const [relance, setRelance] = useState(rdv.relance || (preset === "Absent" ? rdvNextPresent(plan, rdv.commercial, tomorrow) : ""));
  const [motif, setMotif] = useState(rdv.motif_perte || "");
  const visesList = rdvVehiclesOf(rdv);
  const firstVise = visesList.find((v) => v.ref) || visesList[0] || null;
  const typeOfVise = (v) => (v.ref && vehicleByOrder.get(normalizeOrderNum(v.ref))?.baseStatus === "commande" ? "Commande" : v.type === "Stock" ? "Stock" : "Commande");
  const [venteType, setVenteType] = useState(rdv.vente_type || (firstVise ? typeOfVise(firstVise) : ""));
  const [venteLabel, setVenteLabel] = useState(rdv.vente_vehicule || firstVise?.label || "");
  const [venteRef, setVenteRef] = useState(rdv.vente_ref || firstVise?.ref || "");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [history, setHistory] = useState(null);
  const [showHistory, setShowHistory] = useState(false);
  const warn = rdvVehicleWarning(rdv, vehicleByOrder);
  const [noteText, setNoteText] = useState("");
  const [noteBusy, setNoteBusy] = useState(false);
  const nextDay = (d) => rdvNextPresent(plan, rdv.commercial, d);
  const setStatut = (st) => { setStatutRaw(st); if (st === "Absent" && !relance) setRelance(nextDay(tomorrow)); };
  const relanceOff = relance ? rdvOffReason(plan, rdv.commercial, relance) : "";
  const isLast = !chain || chain[chain.length - 1].id === rdv.id;
  const canSuite = !!onSuite && isLast && (rdv.statut === "Honoré" || rdv.statut === "Absent") && !rdv.deleted_at;
  const sendNote = async (type, texte) => {
    if (noteBusy) return;
    if (type === "Note" && !texte.trim()) return;
    setNoteBusy(true);
    try { await onAddNote(rdv.id, type, texte); setNoteText(""); } catch (e) { setErr(e.message || String(e)); }
    setNoteBusy(false);
  };
  const needsRelance = statut === "Honoré" || statut === "Absent";
  const patch = {
    statut,
    commentaire: commentaire.trim() || null,
    relance: needsRelance ? relance || null : null,
    motif_perte: statut === "Perdu" ? motif || null : null,
    vente_type: statut === "Vendu" ? venteType || null : null,
    vente_vehicule: statut === "Vendu" ? venteLabel.trim() || null : null,
    vente_ref: statut === "Vendu" && venteRef ? venteRef : null,
  };
  const saleWarn = statut === "Vendu" && venteType === "Stock" ? rdvSaleWarning(venteRef, rdv.commercial, vehicleByOrder) : "";
  const changed = patch.statut !== rdv.statut || patch.commentaire !== (rdv.commentaire || null) || patch.relance !== (rdv.relance || null) || patch.motif_perte !== (rdv.motif_perte || null)
    || patch.vente_type !== (rdv.vente_type || null) || patch.vente_vehicule !== (rdv.vente_vehicule || null) || patch.vente_ref !== (rdv.vente_ref || null);
  const save = async () => {
    if (statut === "Perdu" && !motif) { setErr("Indiquez le motif de la perte."); return; }
    if (statut === "Vendu") {
      if (!venteType) { setErr("Indiquez s'il s'agit d'un véhicule du stock ou d'une commande."); return; }
      if (venteType === "Stock" && !venteRef) { setErr("Choisissez le véhicule vendu dans le stock."); return; }
      if (venteType === "Commande" && !venteLabel.trim()) { setErr("Décrivez le véhicule commandé (modèle, finition…)."); return; }
    }
    setSaving(true); setErr("");
    try { await onSaveSuivi(rdv.id, patch); onClose(); } catch (e) { setErr(e.message || String(e)); setSaving(false); }
  };
  const toggleHistory = () => {
    const next = !showHistory;
    setShowHistory(next);
    if (next && history == null) loadHistory(rdv.id).then(({ data }) => setHistory(data || []), () => setHistory([]));
  };
  const iconBtn = `inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors ${dark ? "border-zinc-700 text-zinc-200 hover:bg-zinc-800" : "border-stone-300 text-stone-700 hover:bg-stone-100"}`;
  const info = (label, value) => value ? (
    <div className="min-w-0">
      <div className={`text-[11px] ${s.sub}`}>{label}</div>
      <div className={`truncate text-sm ${s.title}`}>{value}</div>
    </div>
  ) : null;
  return (
    <Modal dark={dark} title={rdv.client_nom} onClose={onClose}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          {info("Date", new Date(rdv.date_rdv).toLocaleString("fr-FR", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }))}
          {info("Vendeur", rdv.commercial)}
          {info("Type", rdv.type_rdv)}
          {info("Source", rdv.source)}
          {info("Téléphone", rdv.tel)}
        </div>
        {visesList.length > 0 && (
          <div>
            <div className={`text-[11px] ${s.sub}`}>{visesList.length > 1 ? "Véhicules visés" : "Véhicule visé"}</div>
            <ul className="mt-1 space-y-1">
              {visesList.map((v, i) => (
                <li key={i} className="flex items-center gap-2 text-sm">
                  <RdvPill dark={dark} tone={v.type === "Stock" ? "blue" : "amber"}>{v.type === "Stock" ? "Stock" : "Commande"}</RdvPill>
                  <span className={`min-w-0 flex-1 truncate ${s.title}`}>{v.label}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {warn && <div className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium ${dark ? "bg-amber-500/10 text-amber-300" : "bg-amber-50 text-amber-800"}`}><AlertTriangle size={13} /> {warn}</div>}
        {rdv.consigne && (
          <div className={`rounded-lg px-3 py-2 text-sm ${dark ? "bg-zinc-800/60 text-zinc-300" : "bg-stone-100 text-stone-700"}`}>
            <div className={`mb-0.5 text-[11px] ${s.sub}`}>Consigne</div>{rdv.consigne}
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          {rdv.tel && <a href={`tel:${rdvTelClean(rdv.tel)}`} className={iconBtn}><Phone size={13} /> Appeler</a>}
          {rdv.tel && <a href={rdvSmsHref(rdv, today)} className={iconBtn}><MessageSquare size={13} /> SMS de rappel</a>}
          <button onClick={() => rdvDownloadIcs(rdv)} className={iconBtn}><CalendarPlus size={13} /> Agenda</button>
          {canSuite && <button onClick={() => onSuite(rdv)} className={`${iconBtn} ${dark ? "!border-blue-500/40 !text-blue-300" : "!border-blue-300 !text-blue-700"}`}><CalendarPlus size={13} /> Planifier la suite</button>}
          {isAdmin && <button onClick={() => onEdit(rdv)} className={iconBtn}><Pencil size={13} /> Modifier</button>}
          {isAdmin && <button onClick={() => onDelete(rdv)} className={`${iconBtn} ${dark ? "!text-rose-300" : "!text-rose-600"}`}><Trash2 size={13} /> Corbeille</button>}
        </div>

        {chain && chain.length > 1 && (
          <div className={`rounded-xl border p-3.5 ${s.card}`}>
            <div className={`mb-2 text-sm font-semibold ${s.title}`}>Parcours de l'affaire · {chain.length} rendez-vous</div>
            <ol className={`space-y-1.5 border-l pl-3 ${dark ? "border-zinc-700" : "border-stone-200"}`}>
              {chain.map((c, i) => (
                <li key={c.id}>
                  <button onClick={() => c.id !== rdv.id && onOpenOther(c.id)} className={`flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-sm ${c.id === rdv.id ? (dark ? "bg-blue-500/10" : "bg-blue-50") : dark ? "hover:bg-zinc-800" : "hover:bg-stone-100"}`}>
                    <span className={`w-14 shrink-0 text-xs font-semibold ${s.sub}`}>RDV n°{i + 1}</span>
                    <span className={`min-w-0 flex-1 truncate ${s.title}`}>{new Date(c.date_rdv).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" })} · {rdvTime(c)} · {c.type_rdv}</span>
                    <RdvStatutChip dark={dark} statut={c.statut} />
                  </button>
                </li>
              ))}
            </ol>
          </div>
        )}

        <div className={`space-y-3 rounded-xl border p-3.5 ${s.card}`}>
          <div className={`text-sm font-semibold ${s.title}`}>Suivi</div>
          <div className="flex flex-wrap gap-1.5">
            {RDV_STATUTS.map((st) => (
              <button key={st} onClick={() => setStatut(st)} className={`rounded-full px-3 py-1 text-[13px] font-semibold transition-colors ${statut === st ? (dark ? "bg-blue-500/20 text-blue-200 ring-1 ring-blue-500/50" : "bg-blue-600 text-white") : dark ? "bg-zinc-800 text-zinc-400 hover:bg-zinc-700" : "bg-stone-100 text-stone-600 hover:bg-stone-200"}`}>{st}</button>
            ))}
          </div>
          {statut === "Perdu" && (
            <RdvField dark={dark} label="Motif de la perte *">
              <div className="flex flex-wrap gap-1.5">
                {RDV_MOTIFS.map((m) => (
                  <button key={m} onClick={() => setMotif(m)} className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${motif === m ? (dark ? "bg-rose-500/20 text-rose-200 ring-1 ring-rose-500/50" : "bg-rose-600 text-white") : dark ? "bg-zinc-800 text-zinc-400 hover:bg-zinc-700" : "bg-stone-100 text-stone-600 hover:bg-stone-200"}`}>{m}</button>
                ))}
              </div>
            </RdvField>
          )}
          {statut === "Vendu" && (
            <RdvField dark={dark} label="Véhicule vendu *">
              <div className="space-y-2">
                {visesList.length > 1 && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className={`text-xs ${s.sub}`}>Parmi les véhicules visés :</span>
                    {visesList.map((v, i) => (
                      <button key={i} type="button" onClick={() => { setVenteType(typeOfVise(v)); setVenteLabel(v.label); setVenteRef(v.ref || ""); }} className={`max-w-full truncate rounded-full px-2.5 py-1 text-xs font-semibold ${venteLabel === v.label ? (dark ? "bg-violet-500/25 text-violet-200 ring-1 ring-violet-500/50" : "bg-violet-100 text-violet-800 ring-1 ring-violet-300") : dark ? "bg-zinc-800 text-zinc-300 hover:bg-zinc-700" : "bg-stone-100 text-stone-700 hover:bg-stone-200"}`}>{v.label}</button>
                    ))}
                  </div>
                )}
                <div className="flex flex-wrap gap-1.5">
                  {[["Stock", "Véhicule du stock"], ["Commande", "Commande client"]].map(([k, lbl]) => (
                    <button key={k} type="button" onClick={() => { if (venteType !== k) { setVenteType(k); setVenteRef(""); if (k === "Stock") setVenteLabel(""); } }} className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${venteType === k ? (dark ? "bg-violet-500/25 text-violet-200 ring-1 ring-violet-500/50" : "bg-violet-600 text-white") : dark ? "bg-zinc-800 text-zinc-400 hover:bg-zinc-700" : "bg-stone-100 text-stone-600 hover:bg-stone-200"}`}>{lbl}</button>
                  ))}
                </div>
                {venteType === "Stock" && (
                  <RdvVehiclePicker dark={dark} label={venteLabel} refNum={venteRef} vehicles={vehicles} placeholder="Chercher dans le stock : modèle, finition, n° de commande…"
                    filter={(v) => v.baseStatus !== "livre_client" && v.baseStatus !== "vendu" && v.baseStatus !== "commande"}
                    onChange={({ label, ref }) => { setVenteLabel(label); setVenteRef(ref); }} />
                )}
                {venteType === "Commande" && (
                  <>
                    <RdvVehiclePicker dark={dark} label={venteLabel} refNum={venteRef} vehicles={vehicles} placeholder="Modèle, finition, couleur de la commande… (ou véhicule commandé listé)"
                      filter={(v) => v.baseStatus === "commande"}
                      onChange={({ label, ref }) => { setVenteLabel(label); setVenteRef(ref); }} />
                    <div className={`text-xs ${s.sub}`}>Si la commande n'est pas encore dans ParcLive, décrivez simplement le véhicule.</div>
                  </>
                )}
                {saleWarn && <div className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium ${dark ? "bg-amber-500/10 text-amber-300" : "bg-amber-50 text-amber-800"}`}><AlertTriangle size={13} /> {saleWarn}</div>}
              </div>
            </RdvField>
          )}
          {needsRelance && (
            <RdvField dark={dark} label="Relance">
              <div className="flex flex-wrap items-center gap-2">
                <input type="date" className={`${s.input} !w-auto`} value={relance} onChange={(e) => setRelance(e.target.value)} />
                {[["Demain", 1], ["+ 3 jours", 3], ["+ 7 jours", 7]].map(([lbl, n]) => (
                  <button key={lbl} onClick={() => setRelance(nextDay(marketingAddDays(today, n)))} className={s.ghostBtn}>{lbl}</button>
                ))}
                {relance && <button onClick={() => setRelance("")} className={`text-xs underline ${s.muted}`}>aucune</button>}
              </div>
              {relanceOff && (
                <div className={`mt-1.5 flex flex-wrap items-center gap-2 text-xs ${dark ? "text-amber-300" : "text-amber-800"}`}>
                  <AlertTriangle size={12} /> {rdv.commercial} n'est pas là ce jour-là ({relanceOff}) — la relance sera reportée au {marketingFrDate(nextDay(relance))}.
                  <button type="button" onClick={() => setRelance(nextDay(relance))} className="font-semibold underline">Fixer au {marketingFrDate(nextDay(relance))}</button>
                </div>
              )}
              {!relance && (statut === "Honoré" || statut === "Absent") && <div className={`mt-1.5 text-xs ${s.sub}`}>Sans relance ni suite planifiée, l'affaire reste « en cours » sans prochaine étape.</div>}
            </RdvField>
          )}
          <RdvField dark={dark} label="Commentaire">
            <textarea className={s.input} rows={2} value={commentaire} onChange={(e) => setCommentaire(e.target.value)} placeholder="Ce qui s'est dit, prochaine étape…" />
          </RdvField>
          {err && <div className={`rounded-lg px-3 py-2 text-sm ${dark ? "bg-rose-500/10 text-rose-300" : "bg-rose-50 text-rose-700"}`}>{err}</div>}
          <div className="flex justify-end gap-2">
            <button onClick={onClose} className={s.ghostBtn}>Fermer</button>
            <button onClick={save} disabled={!changed || saving} className={s.primaryBtn}>{saving ? "Enregistrement…" : "Enregistrer le suivi"}</button>
          </div>
        </div>

        <div className={`space-y-2.5 rounded-xl border p-3.5 ${s.card}`}>
          <div className={`text-sm font-semibold ${s.title}`}>Journal de contact</div>
          <div className="flex flex-wrap gap-1.5">
            {RDV_CONTACT_TYPES.map((t) => (
              <button key={t} disabled={noteBusy} onClick={() => sendNote(t, "")} className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors disabled:opacity-50 ${dark ? "bg-zinc-800 text-zinc-200 hover:bg-zinc-700" : "bg-stone-100 text-stone-700 hover:bg-stone-200"}`}>+ {t === "Appel" ? "Appel passé" : t === "SMS" ? "SMS envoyé" : t === "E-mail" ? "E-mail envoyé" : "Visite"}</button>
            ))}
          </div>
          <div className="flex gap-2">
            <input className={s.input} value={noteText} onChange={(e) => setNoteText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") sendNote("Note", noteText); }} placeholder="Ajouter une note (appel sans réponse, client hésite…)" />
            <button disabled={!noteText.trim() || noteBusy} onClick={() => sendNote("Note", noteText)} className={s.primaryBtn}>Ajouter</button>
          </div>
          {notes && notes.length > 0 ? (
            <ul className={`space-y-1.5 border-l pl-3 text-xs ${dark ? "border-zinc-800" : "border-stone-200"}`}>
              {notes.slice(0, 20).map((n) => (
                <li key={n.id}>
                  <span className={`font-semibold ${s.title}`}>{n.type}</span>{n.texte && <span className={s.muted}> — {n.texte}</span>}
                  <div className={s.sub}>{n.by_nom || "—"} · {new Date(n.at).toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</div>
                </li>
              ))}
            </ul>
          ) : <div className={`text-xs ${s.sub}`}>Aucun contact noté pour l'instant. Un clic suffit pour garder la trace d'un appel ou d'un SMS.</div>}
        </div>

        <div>
          <button onClick={toggleHistory} className={`flex items-center gap-1.5 text-xs font-semibold ${s.muted}`}>
            <History size={13} /> Historique {showHistory ? "▾" : "▸"}
          </button>
          {showHistory && (
            <ul className={`mt-2 space-y-2 border-l pl-3 text-xs ${dark ? "border-zinc-800" : "border-stone-200"}`}>
              {history == null && <li className={s.sub}>Chargement…</li>}
              {history && history.length === 0 && <li className={s.sub}>Aucune modification enregistrée.</li>}
              {(history || []).map((h) => (
                <li key={h.id}>
                  <div className={s.muted}>
                    <span className={`font-semibold ${s.title}`}>{h.by_nom || "—"}</span> · {h.action} · {new Date(h.at).toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                  </div>
                  {Object.entries(h.changes || {}).filter(([k]) => !("vehicules" in (h.changes || {})) || (k !== "vehicule_vise" && k !== "vehicule_ref")).map(([k, pair]) => <div key={k} className={s.sub}>{rdvFormatChange(k, pair)}</div>)}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Modal>
  );
}

function rdvRowFactory(p) {
  return (r, extra = {}) => (
    <RdvRow key={r.id} dark={p.dark} r={r} now={p.now} today={p.today} isAdmin={p.isAdmin} vehicleByOrder={p.vehicleByOrder} onOpen={p.onOpen} onAction={p.onAction} onSuite={p.onSuite} rank={p.rankMap?.get(r.id)} plan={p.plan} busy={p.busyId === r.id} {...extra} />
  );
}
const rdvByTime = (a, b) => new Date(a.date_rdv) - new Date(b.date_rdv);

// ───────── Aujourd'hui / Ma journée ─────────
function RdvJour(p) {
  const { dark, rows, now, today, isAdmin, vendeurNames, plan, meNom } = p;
  const s = marketingStyles(dark);
  const [scope, setScope] = useState("");
  const row = rdvRowFactory(p);
  const live = useMemo(() => rows.filter((r) => !r.deleted_at && (!scope || r.commercial === scope)), [rows, scope]);
  const tomorrow = marketingAddDays(today, 1), horizon = marketingAddDays(today, 7);
  const overdue = live.filter((r) => rdvIsOverdue(r, now)).sort(rdvByTime);
  const relances = live.filter((r) => rdvRelanceDue(r, today, plan)).sort((a, b) => rdvEffectiveRelance(a, plan).localeCompare(rdvEffectiveRelance(b, plan)));
  const used = new Set([...overdue, ...relances].map((r) => r.id));
  const offToday = (isAdmin ? vendeurNames : [meNom]).filter(Boolean).map((n) => [n, rdvOffReason(plan, n, today)]).filter(([, why]) => why);
  const clashes = live.filter((r) => r.statut === "À venir" && rdvDay(r) >= today && rdvOffReason(plan, r.commercial, rdvDay(r))).sort(rdvByTime);
  const todayAll = live.filter((r) => rdvDay(r) === today);
  const todayRows = todayAll.filter((r) => !used.has(r.id)).sort(rdvByTime);
  const tomorrowRows = live.filter((r) => rdvDay(r) === tomorrow && r.statut === "À venir").sort(rdvByTime);
  const soon = live.filter((r) => { const d = rdvDay(r); return d > tomorrow && d <= horizon && r.statut === "À venir"; }).sort(rdvByTime);
  const groupedOverdue = isAdmin && !scope ? [...rdvGroupBy(overdue, (r) => r.commercial).entries()].sort((a, b) => b[1].length - a[1].length) : null;
  const empty = !overdue.length && !relances.length && !clashes.length && !todayRows.length && !tomorrowRows.length && !soon.length;
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <RdvKpi dark={dark} label="Aujourd'hui" value={todayAll.length} sub="rendez-vous" />
        <RdvKpi dark={dark} label="Résultats à saisir" value={overdue.length} tone={overdue.length ? "bad" : undefined} sub={overdue.length ? "rendez-vous passés" : "tout est à jour"} />
        <RdvKpi dark={dark} label="Relances à faire" value={relances.length} tone={relances.length ? "warn" : undefined} />
        <RdvKpi dark={dark} label="Demain" value={tomorrowRows.length} sub={tomorrowRows.length ? "pensez au SMS de rappel" : "rendez-vous"} />
      </div>
      {isAdmin && (
        <div className="flex items-center gap-2">
          <span className={`text-sm ${s.muted}`}>Vendeur</span>
          <RdvVendeurPicker dark={dark} value={scope} onChange={setScope} names={vendeurNames} plan={plan} date={today} allLabel="Toute l'équipe" className="w-64" />
        </div>
      )}
      {offToday.length > 0 && (
        <div className={`flex flex-wrap items-center gap-2 rounded-xl border px-3.5 py-2.5 text-sm ${dark ? "border-amber-500/30 bg-amber-500/10 text-amber-200" : "border-amber-200 bg-amber-50 text-amber-900"}`}>
          <CalendarClock size={15} /> <span className="font-semibold">{isAdmin ? "Pas là aujourd'hui" : "Vous n'êtes pas là aujourd'hui"} :</span>
          {offToday.map(([n, why]) => <span key={n}>{isAdmin ? `${n} (${why})` : why}</span>)}
        </div>
      )}
      {clashes.length > 0 && isAdmin && (
        <RdvSection dark={dark} tone="amber" title="Rendez-vous un jour de repos ou d'absence" count={clashes.length}>
          <div className="space-y-2">{clashes.map((r) => row(r, { showDate: true }))}</div>
        </RdvSection>
      )}
      {empty && <EmptyState dark={dark} icon={CalendarClock} title="Rien à traiter" subtitle="Aucun rendez-vous à saisir, aucune relance, rien de prévu dans les 7 prochains jours." />}
      {overdue.length > 0 && (
        <RdvSection dark={dark} tone="rose" title="À saisir — rendez-vous passés sans résultat" count={overdue.length}>
          {groupedOverdue ? (
            <div className="space-y-4">
              {groupedOverdue.map(([nom, list]) => (
                <div key={nom}>
                  <div className={`mb-1.5 text-xs font-semibold ${s.muted}`}>{nom} · {list.length}{rdvOverdueDays(list[0], today) > 0 ? ` · le plus ancien : ${rdvOverdueDays(list[0], today)} j` : ""}</div>
                  <div className="space-y-2">{list.map((r) => row(r, { showDate: true }))}</div>
                </div>
              ))}
            </div>
          ) : <div className="space-y-2">{overdue.map((r) => row(r, { showDate: true }))}</div>}
        </RdvSection>
      )}
      {relances.length > 0 && <RdvSection dark={dark} tone="amber" title="Relances à faire" count={relances.length}><div className="space-y-2">{relances.map((r) => row(r, { showDate: true }))}</div></RdvSection>}
      {todayRows.length > 0 && <RdvSection dark={dark} title="Aujourd'hui" count={todayRows.length}><div className="space-y-2">{todayRows.map((r) => row(r))}</div></RdvSection>}
      {tomorrowRows.length > 0 && <RdvSection dark={dark} title="Demain" count={tomorrowRows.length}><div className="space-y-2">{tomorrowRows.map((r) => row(r))}</div></RdvSection>}
      {soon.length > 0 && <RdvSection dark={dark} title="Les 7 prochains jours" count={soon.length}><div className="space-y-2">{soon.map((r) => row(r, { showDate: true }))}</div></RdvSection>}
    </div>
  );
}

// ───────── Liste des rendez-vous ─────────
function RdvListe(p) {
  const { dark, rows, now, today, isAdmin, vendeurNames, showToast } = p;
  const s = marketingStyles(dark);
  const row = rdvRowFactory(p);
  const [q, setQ] = useState("");
  const [vendeur, setVendeur] = useState("");
  const [statut, setStatut] = useState("");
  const [period, setPeriod] = useState("mois");
  const [custom, setCustom] = useState({ from: "", to: "" });
  const [limit, setLimit] = useState(60);
  const [sel, setSel] = useState([]);
  const [target, setTarget] = useState("");
  const range = rdvPeriodRange(period, today, custom);
  const list = useMemo(() => {
    const n = stripAccents(q).toLowerCase().trim();
    const dq = rdvDigits(q);
    return rows
      .filter((r) => !r.deleted_at && rdvInRange(r, range) && (!vendeur || r.commercial === vendeur) && (!statut || (statut === "__sans" ? rdvIsOverdue(r, now) : r.statut === statut)))
      .filter((r) => !n || stripAccents([r.client_nom, r.vehicule_vise, r.commentaire, r.source].join(" ")).toLowerCase().includes(n) || (dq.length >= 3 && rdvDigits(r.tel).includes(dq)))
      .sort((a, b) => rdvByTime(b, a));
  }, [rows, q, vendeur, statut, range.from, range.to, now]);
  const toggle = (id) => setSel((a) => (a.includes(id) ? a.filter((x) => x !== id) : [...a, id]));
  const applyReassign = async () => {
    if (!target || !sel.length) return;
    try { await p.onReassign(sel, target); showToast(`${sel.length} rendez-vous réattribué${sel.length > 1 ? "s" : ""} à ${target}`); setSel([]); setTarget(""); }
    catch (e) { showToast(`Réattribution impossible : ${e.message || e}`, { type: "error" }); }
  };
  return (
    <div className="space-y-4">
      <div className={`flex flex-wrap items-center gap-2 rounded-xl border p-2.5 ${s.card}`}>
        <div className="relative min-w-[200px] flex-1">
          <Search size={14} className={`absolute left-3 top-1/2 -translate-y-1/2 ${s.sub}`} />
          <input className={`${s.input} !pl-9`} placeholder="Client, téléphone, véhicule…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {isAdmin && <RdvVendeurPicker dark={dark} value={vendeur} onChange={setVendeur} names={vendeurNames} allLabel="Tous vendeurs" className="w-52" />}
        <select className={`${s.input} !w-auto`} value={statut} onChange={(e) => setStatut(e.target.value)}>
          <option value="">Tous statuts</option>
          <option value="__sans">Sans suivi</option>
          {RDV_STATUTS.map((st) => <option key={st} value={st}>{st}</option>)}
        </select>
        <select className={`${s.input} !w-auto`} value={period} onChange={(e) => setPeriod(e.target.value)}>
          {RDV_PERIODS.map((x) => <option key={x.k} value={x.k}>{x.label}</option>)}
          <option value="perso">Dates…</option>
        </select>
        {period === "perso" && (
          <>
            <input type="date" className={`${s.input} !w-auto`} value={custom.from} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} />
            <input type="date" className={`${s.input} !w-auto`} value={custom.to} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} />
          </>
        )}
        <span className={`text-xs ${s.sub}`}>{list.length} rendez-vous</span>
        <button onClick={() => exportRdvToExcel(list, "liste", rows)} className={`${s.ghostBtn} flex items-center gap-1.5`}><Download size={14} /> Exporter</button>
      </div>
      {isAdmin && sel.length > 0 && (
        <div className={`flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 ${dark ? "border-blue-500/30 bg-blue-500/10" : "border-blue-200 bg-blue-50"}`}>
          <span className={`text-sm font-semibold ${s.title}`}>{sel.length} sélectionné{sel.length > 1 ? "s" : ""}</span>
          <RdvVendeurPicker dark={dark} value={target} onChange={setTarget} names={vendeurNames} placeholder="Réattribuer à… (premières lettres)" className="w-60" />
          <button onClick={applyReassign} disabled={!target} className={s.primaryBtn}>Réattribuer</button>
          <button onClick={() => setSel([])} className={s.ghostBtn}>Annuler</button>
        </div>
      )}
      {list.length === 0 ? (
        <EmptyState dark={dark} icon={CalendarClock} title="Aucun rendez-vous" subtitle="Aucun rendez-vous ne correspond à ces filtres." />
      ) : (
        <div className="space-y-2">
          {list.slice(0, limit).map((r) => row(r, { showDate: true, selected: sel.includes(r.id), onSelect: isAdmin ? toggle : undefined }))}
          {list.length > limit && <button onClick={() => setLimit((l) => l + 60)} className={`${s.ghostBtn} w-full`}>Afficher plus ({list.length - limit})</button>}
        </div>
      )}
    </div>
  );
}

// ───────── Pipeline : toutes les affaires d'un coup d'œil ─────────
const RDV_STAGE_STYLE = {
  "Planifié": { bar: "bg-blue-500", dot: "bg-blue-500" },
  "À saisir": { bar: "bg-rose-500", dot: "bg-rose-500" },
  "En cours": { bar: "bg-emerald-500", dot: "bg-emerald-500" },
  "À relancer": { bar: "bg-amber-500", dot: "bg-amber-500" },
  "Vendu": { bar: "bg-violet-600", dot: "bg-violet-600" },
  "Perdu": { bar: "bg-stone-400", dot: "bg-stone-400" },
};
function RdvPipelineCard({ dark, a, today, isAdmin, plan, onOpen, onAction, onSuite }) {
  const s = marketingStyles(dark);
  const r = a.last;
  const stale = a.stage === "En cours" || a.stage === "À relancer" ? a.staleDays : 0;
  const staleTone = stale >= 14 ? (dark ? "text-rose-300" : "text-rose-600") : stale >= 7 ? (dark ? "text-amber-300" : "text-amber-700") : s.sub;
  const note = a.notes[0];
  const offDay = a.stage === "Planifié" ? rdvOffReason(plan, r.commercial, rdvDay(r)) : "";
  let line = null;
  if (a.stage === "Planifié") line = <span className={`font-medium ${s.title}`}>{rdvFrDay(r)} · {rdvTime(r)}</span>;
  else if (a.stage === "À saisir") line = <span className={`font-medium ${dark ? "text-rose-300" : "text-rose-600"}`}>{rdvOverdueDays(r, today) > 0 ? `Passé depuis ${rdvOverdueDays(r, today)} j` : "Résultat à saisir"}</span>;
  else if (a.stage === "En cours") line = <span className={staleTone}>{stale > 0 ? `Sans contact depuis ${stale} j` : "Contacté aujourd'hui"}{a.next ? ` · relance ${marketingFrDate(a.next)}` : ""}</span>;
  else if (a.stage === "À relancer") line = <span className={`font-medium ${dark ? "text-amber-300" : "text-amber-700"}`}>{a.next ? `Relance ${marketingRelativeLabel(a.next, today)}` : "À relancer"}{stale >= 7 ? ` · ${stale} j sans contact` : ""}</span>;
  else if (a.stage === "Perdu") line = <span className={s.sub}>{r.motif_perte || "Motif non précisé"}</span>;
  else line = <span className={dark ? "text-violet-300" : "text-violet-700"}>{rdvVenteLabel(r) || "Vente conclue"}</span>;
  const act = (st) => <button key={st} onClick={(e) => { e.stopPropagation(); onAction(r, st); }} className={`pl-interactive rounded-md px-2.5 py-1 text-xs font-semibold transition-colors ${dark ? RDV_ACTION_STYLE[st].dark : RDV_ACTION_STYLE[st].light}`}>{st}</button>;
  const open = a.stage === "En cours" || a.stage === "À relancer";
  return (
    <div onClick={() => onOpen(r.id)} className={`pl-interactive cursor-pointer rounded-xl border p-3 transition-colors ${s.card} ${dark ? "hover:border-zinc-700" : "hover:border-blue-300"}`}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className={`truncate text-sm font-semibold ${s.title}`}>{a.client_nom}</div>
          <div className={`truncate text-xs ${s.muted}`}>{isAdmin ? `${a.commercial}${a.vehicule_vise ? " · " : ""}` : ""}{a.vehicule_vise}</div>
        </div>
        {a.n > 1 && <RdvPill dark={dark} tone="blue" title={`${a.n} rendez-vous pour cette affaire`}>RDV n°{a.n}</RdvPill>}
      </div>
      <div className="mt-1.5 text-xs">{line}</div>
      {offDay && <div className={`mt-1 flex items-center gap-1 text-[11px] font-medium ${dark ? "text-amber-300" : "text-amber-700"}`}><AlertTriangle size={11} /> {offDay}</div>}
      {note && <div className={`mt-1.5 truncate text-[11px] italic ${s.sub}`}>{note.type}{note.texte ? ` — ${note.texte}` : ""} · {new Date(note.at).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}</div>}
      {(a.stage === "À saisir" || open || r.tel) && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
          {a.stage === "À saisir" && ["Honoré", "Absent"].map(act)}
          {open && onSuite && <button onClick={() => onSuite(r)} className={`pl-interactive flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-semibold ${dark ? "bg-blue-500/15 text-blue-300 hover:bg-blue-500/25" : "bg-blue-50 text-blue-700 hover:bg-blue-100"}`}><CalendarPlus size={12} /> Suite</button>}
          {open && (r.statut === "Absent" ? ["Honoré", "Perdu"] : ["Vendu", "Perdu"]).map(act)}
          {r.tel && <a href={`tel:${rdvTelClean(r.tel)}`} title={`Appeler ${r.tel}`} className={`ml-auto flex h-7 w-7 items-center justify-center rounded-md ${dark ? "text-zinc-400 hover:bg-zinc-800" : "text-stone-500 hover:bg-stone-100"}`}><Phone size={14} /></a>}
        </div>
      )}
    </div>
  );
}
function RdvPipeline(p) {
  const { dark, rows, notes, now, today, plan, isAdmin, vendeurNames } = p;
  const s = marketingStyles(dark);
  const [vendeur, setVendeur] = useState("");
  const [q, setQ] = useState("");
  const [showClosed, setShowClosed] = useState(false);
  const [more, setMore] = useState({});
  const cols = useMemo(() => {
    const all = rdvPipeline(rows, notes, now, today, plan);
    const n = stripAccents(q).toLowerCase().trim(), dq = rdvDigits(q);
    const keep = (a) => (!vendeur || a.commercial === vendeur) && (!n || stripAccents([a.client_nom, a.vehicule_vise, a.commercial].join(" ")).toLowerCase().includes(n) || (dq.length >= 3 && rdvDigits(a.tel).includes(dq)));
    return Object.fromEntries(RDV_STAGES.map((k) => [k, all[k].filter(keep)]));
  }, [rows, notes, now, today, plan, vendeur, q]);
  const openTotal = cols["Planifié"].length + cols["À saisir"].length + cols["En cours"].length + cols["À relancer"].length;
  const staleN = [...cols["En cours"], ...cols["À relancer"]].filter((a) => a.staleDays >= 7).length;
  const column = (k) => {
    const list = cols[k], lim = more[k] || 12, st = RDV_STAGE_STYLE[k];
    return (
      <div key={k} className={`min-w-0 overflow-hidden rounded-2xl border ${dark ? "border-zinc-800 bg-zinc-900/40" : "border-stone-200 bg-stone-50/70"}`}>
        <div className={`h-1 ${st.bar}`} />
        <div className="p-3">
          <div className="mb-0.5 flex items-center gap-2">
            <span className={`text-sm font-semibold ${s.title}`}>{k}</span>
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${dark ? "bg-zinc-800 text-zinc-300" : "bg-white text-stone-600 ring-1 ring-stone-200"}`}>{list.length}</span>
          </div>
          <div className={`mb-2.5 text-[11px] ${s.sub}`}>{RDV_STAGE_HINT[k]}</div>
          <div className="space-y-2">
            {list.slice(0, lim).map((a) => <RdvPipelineCard key={a.id} dark={dark} a={a} today={today} isAdmin={isAdmin} plan={plan} onOpen={p.onOpen} onAction={p.onAction} onSuite={p.onSuite} />)}
            {list.length === 0 && <div className={`rounded-lg border border-dashed px-3 py-5 text-center text-xs ${dark ? "border-zinc-800 text-zinc-600" : "border-stone-200 text-stone-400"}`}>Aucune affaire</div>}
            {list.length > lim && <button onClick={() => setMore((m) => ({ ...m, [k]: lim + 12 }))} className={`${s.ghostBtn} w-full`}>Afficher plus ({list.length - lim})</button>}
          </div>
        </div>
      </div>
    );
  };
  return (
    <div className="space-y-4">
      <div className={`flex flex-wrap items-center gap-2 rounded-xl border p-2.5 ${s.card}`}>
        <div className="relative min-w-[200px] flex-1">
          <Search size={14} className={`absolute left-3 top-1/2 -translate-y-1/2 ${s.sub}`} />
          <input className={`${s.input} !pl-9`} placeholder="Client, téléphone, véhicule…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {isAdmin && <RdvVendeurPicker dark={dark} value={vendeur} onChange={setVendeur} names={vendeurNames} allLabel="Toute l'équipe" className="w-56" />}
        <span className={`text-xs ${s.sub}`}>{openTotal} affaire{openTotal > 1 ? "s" : ""} en cours{staleN ? ` · ${staleN} sans contact depuis 7 j ou plus` : ""}</span>
        <button onClick={() => setShowClosed((v) => !v)} className={s.ghostBtn}>{showClosed ? "Masquer" : "Voir"} vendus / perdus ({cols["Vendu"].length + cols["Perdu"].length})</button>
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">{["Planifié", "À saisir", "En cours", "À relancer"].map(column)}</div>
      {showClosed && <div className="grid gap-3 md:grid-cols-2">{["Vendu", "Perdu"].map(column)}</div>}
    </div>
  );
}

function RdvMonthlyChart({ dark, data }) {
  const axis = dark ? "#a1a1aa" : "#78716c";
  const grid = dark ? "#27272a" : "#e7e5e4";
  const chart = data.map((d) => ({ name: rdvMonthLabel(d.mois), "Rendez-vous": d.pris, "Honorés": d.venus, "Vendus": d.vendus }));
  return (
    <div style={{ width: "100%", height: 240 }}>
      <ResponsiveContainer>
        <BarChart data={chart} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
          <CartesianGrid stroke={grid} vertical={false} />
          <XAxis dataKey="name" tick={{ fill: axis, fontSize: 12 }} axisLine={false} tickLine={false} />
          <YAxis allowDecimals={false} tick={{ fill: axis, fontSize: 12 }} axisLine={false} tickLine={false} />
          <Tooltip cursor={{ fill: dark ? "#ffffff0d" : "#0000000a" }} contentStyle={{ background: dark ? "#18181b" : "#fff", border: `1px solid ${grid}`, borderRadius: 10, fontSize: 12 }} />
          <Bar isAnimationActive={false} dataKey="Rendez-vous" fill="#2563EB" radius={[4, 4, 0, 0]} />
          <Bar isAnimationActive={false} dataKey="Honorés" fill="#10B981" radius={[4, 4, 0, 0]} />
          <Bar isAnimationActive={false} dataKey="Vendus" fill="#7C3AED" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function RdvPeriodPicker({ dark, period, setPeriod }) {
  const s = marketingStyles(dark);
  return (
    <div className="flex flex-wrap gap-1.5">
      {RDV_PERIODS.map((x) => (
        <button key={x.k} onClick={() => setPeriod(x.k)} className={`rounded-full px-3 py-1 text-[13px] font-medium transition-colors ${period === x.k ? (dark ? "bg-blue-500/15 text-blue-300" : "bg-blue-50 text-blue-700") : dark ? "text-zinc-400 hover:bg-zinc-900" : "text-stone-500 hover:bg-stone-100"}`}>{x.label}</button>
      ))}
    </div>
  );
}

// ───────── Équipe : comparaison des vendeurs ─────────
function RdvEquipe({ dark, rows, archive, objectifs, names, now, today, plan, onOpenFiche }) {
  const s = marketingStyles(dark);
  const [period, setPeriod] = useState("mois");
  const range = rdvPeriodRange(period, today);
  const weekRange = rdvPeriodRange("semaine", today);
  const inPeriod = useMemo(() => rows.filter((r) => !r.deleted_at && rdvInRange(r, range)), [rows, range.from, range.to]);
  const inWeek = useMemo(() => rows.filter((r) => !r.deleted_at && rdvInRange(r, weekRange)), [rows, weekRange.from]);
  const objBy = new Map(objectifs.map((o) => [o.commercial, o]));
  const lines = names.map((nom) => ({
    nom, st: rdvStats(inPeriod.filter((r) => r.commercial === nom), now, today, plan),
    week: rdvStats(inWeek.filter((r) => r.commercial === nom), now, today, plan), obj: objBy.get(nom) || null,
    open: rdvStats(rows.filter((r) => r.commercial === nom), now, today, plan),
  })).filter((l) => l.st.pris > 0 || l.open.sansSuivi > 0 || l.open.relancesDues > 0).sort((a, b) => b.st.vendus - a.st.vendus || b.st.pris - a.st.pris);
  const total = rdvStats(inPeriod, now, today, plan);
  const totalOpen = rdvStats(rows, now, today, plan);
  const monthly = useMemo(() => rdvMonthly(rows, archive, 12, today), [rows, archive, today]);
  const th = `px-3 py-2 text-right text-[11px] font-medium ${s.sub}`;
  const td = `px-3 py-2.5 text-right tabular-nums ${s.title}`;
  const warnTone = (v) => (v ? (dark ? "text-rose-300" : "text-rose-600") : s.sub);
  return (
    <div className="space-y-6">
      <RdvPeriodPicker dark={dark} period={period} setPeriod={setPeriod} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <RdvKpi dark={dark} label="Rendez-vous" value={total.pris} />
        <RdvKpi dark={dark} label="Honorés" value={total.venus} sub={`${rdvPct(total.tauxHonore)} des rendez-vous décidés`} />
        <RdvKpi dark={dark} label="Vendus" value={total.vendus} sub={`${rdvPct(total.tauxVente)} des affaires venues`} tone="good" />
        <RdvKpi dark={dark} label="Sans suivi" value={totalOpen.sansSuivi} tone={totalOpen.sansSuivi ? "bad" : undefined} sub="toute période" />
        <RdvKpi dark={dark} label="Réactivité moyenne" value={rdvReact(total.reactH)} sub="délai de saisie du résultat" />
      </div>
      <div className={`overflow-x-auto rounded-2xl border ${s.card}`}>
        <table className="w-full min-w-[820px] text-sm">
          <thead>
            <tr className={`border-b ${dark ? "border-zinc-800" : "border-stone-200"}`}>
              <th className={`${th} !text-left`}>Vendeur</th>
              <th className={th}>RDV</th><th className={th}>Honorés</th><th className={th}>Taux</th><th className={th}>Vendus</th><th className={th}>Transfo.</th>
              <th className={th}>Perdus</th><th className={th}>Sans suivi</th><th className={th}>Relances en retard</th><th className={th}>Réactivité</th><th className={th}>Obj. semaine</th>
            </tr>
          </thead>
          <tbody className={`divide-y ${dark ? "divide-zinc-800" : "divide-stone-100"}`}>
            {lines.map((l) => {
              const objOk = l.obj?.rdv_semaine != null ? l.week.pris >= l.obj.rdv_semaine : null;
              return (
                <tr key={l.nom} onClick={() => onOpenFiche(l.nom)} className={`cursor-pointer transition-colors ${dark ? "hover:bg-zinc-900/60" : "hover:bg-blue-50/40"}`}>
                  <td className={`px-3 py-2.5 font-semibold ${s.title}`}>{l.nom}</td>
                  <td className={td}>{l.st.pris}</td><td className={td}>{l.st.venus}</td><td className={td}>{rdvPct(l.st.tauxHonore)}</td>
                  <td className={td}>{l.st.vendus}</td><td className={td}>{rdvPct(l.st.tauxVente)}</td><td className={td}>{l.st.perdus}</td>
                  <td className={`${td} ${l.open.sansSuivi ? (dark ? "!text-rose-300" : "!text-rose-600") : ""} font-semibold`}>{l.open.sansSuivi || "—"}</td>
                  <td className={`${td} ${l.open.relancesRetard ? (dark ? "!text-amber-300" : "!text-amber-700") : ""}`}>{l.open.relancesRetard || "—"}</td>
                  <td className={td}>{rdvReact(l.st.reactH)}</td>
                  <td className={`${td} ${objOk === false ? (dark ? "!text-amber-300" : "!text-amber-700") : objOk ? (dark ? "!text-emerald-300" : "!text-emerald-600") : ""}`}>{l.obj?.rdv_semaine != null ? `${l.week.pris} / ${l.obj.rdv_semaine}` : "—"}</td>
                </tr>
              );
            })}
            {lines.length === 0 && <tr><td colSpan={11} className={`px-3 py-8 text-center ${s.sub}`}>Aucun rendez-vous sur cette période.</td></tr>}
            {lines.length > 0 && (
              <tr className={dark ? "bg-zinc-900/60" : "bg-stone-50"}>
                <td className={`px-3 py-2.5 font-semibold ${s.title}`}>Équipe</td>
                <td className={`${td} font-semibold`}>{total.pris}</td><td className={`${td} font-semibold`}>{total.venus}</td><td className={`${td} font-semibold`}>{rdvPct(total.tauxHonore)}</td>
                <td className={`${td} font-semibold`}>{total.vendus}</td><td className={`${td} font-semibold`}>{rdvPct(total.tauxVente)}</td><td className={`${td} font-semibold`}>{total.perdus}</td>
                <td className={`${td} font-semibold`}>{totalOpen.sansSuivi || "—"}</td><td className={`${td} font-semibold`}>{totalOpen.relancesRetard || "—"}</td><td className={`${td} font-semibold`}>{rdvReact(total.reactH)}</td><td className={td} />
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className={`rounded-2xl border p-4 ${s.card}`}>
        <div className={`mb-2 text-sm font-semibold ${s.title}`}>Évolution sur 12 mois</div>
        <RdvMonthlyChart dark={dark} data={monthly} />
      </div>
    </div>
  );
}

// ───────── Fiche détaillée d'un vendeur ─────────
function RdvFiche(p) {
  const { dark, nom, rows, archive, objectifs, teamRows, isAdmin, now, today, plan, notes, meNom, onBack } = p;
  const s = marketingStyles(dark);
  const row = rdvRowFactory(p);
  const [period, setPeriod] = useState("mois");
  const [limit, setLimit] = useState(30);
  const mine = useMemo(() => (nom ? rows.filter((r) => r.commercial === nom && !r.deleted_at) : rows.filter((r) => !r.deleted_at)), [rows, nom]);
  const range = rdvPeriodRange(period, today);
  const weekRange = rdvPeriodRange("semaine", today);
  const inPeriod = useMemo(() => mine.filter((r) => rdvInRange(r, range)), [mine, range.from, range.to]);
  const st = rdvStats(inPeriod, now, today, plan);
  const week = rdvStats(mine.filter((r) => rdvInRange(r, weekRange)), now, today, plan);
  const open = rdvStats(mine, now, today, plan);
  const contacts = rdvContactsBy(notes, nom || meNom, range);
  const obj = nom ? objectifs.find((o) => o.commercial === nom) : objectifs[0];
  const team = useMemo(() => (teamRows ? rdvStats(teamRows.filter((r) => !r.deleted_at && rdvInRange(r, range)), now, today, plan) : null), [teamRows, range.from, range.to, now, plan]);
  const overdue = mine.filter((r) => rdvIsOverdue(r, now)).sort(rdvByTime);
  const relances = mine.filter((r) => rdvRelanceDue(r, today, plan)).sort((a, b) => rdvEffectiveRelance(a, plan).localeCompare(rdvEffectiveRelance(b, plan)));
  const monthly = useMemo(() => rdvMonthly(rows, archive, 6, today, nom || undefined), [rows, archive, today, nom]);
  const list = [...inPeriod].sort((a, b) => rdvByTime(b, a));
  const sources = Object.entries(st.sources).sort((a, b) => b[1].pris - a[1].pris);
  const motifs = Object.entries(st.motifs).sort((a, b) => b[1] - a[1]);
  const goal = (label, value, target, fmt, higherBetter = true) => {
    if (target == null) return null;
    const ok = higherBetter ? value >= target : value <= target;
    return (
      <div key={label}>
        <div className="mb-1 flex items-center justify-between text-xs">
          <span className={s.muted}>{label}</span>
          <span className={`font-semibold tabular-nums ${s.title}`}>{value == null ? "—" : fmt(value)} <span className={s.sub}>/ {fmt(target)}</span></span>
        </div>
        <RdvBar dark={dark} value={value ?? 0} max={target} tone={value == null ? undefined : ok ? "good" : value >= target * 0.7 ? "warn" : "bad"} />
      </div>
    );
  };
  const goals = [
    goal("Rendez-vous cette semaine", week.pris, obj?.rdv_semaine, (v) => String(v)),
    goal("Taux d'honorés", st.tauxHonore == null ? null : st.tauxHonore * 100, obj?.honore_pct, (v) => Math.round(v) + " %"),
    goal("Transformation (affaires vendues / venues)", st.tauxVente == null ? null : st.tauxVente * 100, obj?.vente_pct, (v) => Math.round(v) + " %"),
  ].filter(Boolean);
  const funnel = [["Rendez-vous", st.pris, 1], ["Honorés", st.venus, st.pris ? st.venus / st.pris : 0], ["Vendus", st.vendus, st.pris ? st.vendus / st.pris : 0]];
  const cmp = (label, mineV, teamV) => (
    <tr key={label}>
      <td className={`py-1.5 ${s.muted}`}>{label}</td>
      <td className={`py-1.5 text-right font-semibold tabular-nums ${s.title}`}>{mineV}</td>
      <td className={`py-1.5 text-right tabular-nums ${s.sub}`}>{teamV}</td>
    </tr>
  );
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        {onBack && <button onClick={onBack} className={`${s.ghostBtn} flex items-center gap-1`}><ChevronLeft size={15} /> Vendeurs</button>}
        <h2 className={`text-xl font-semibold ${s.title}`}>{nom || "Ma fiche"}</h2>
        <button onClick={() => exportRdvToExcel(inPeriod, stripAccents(nom || "moi").replace(/\W+/g, "-").toLowerCase(), rows)} className={`${s.ghostBtn} ml-auto flex items-center gap-1.5`}><Download size={14} /> Exporter</button>
      </div>
      <RdvPeriodPicker dark={dark} period={period} setPeriod={setPeriod} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-7">
        <RdvKpi dark={dark} label="Rendez-vous" value={st.pris} sub={st.suites ? `dont ${st.suites} suite${st.suites > 1 ? "s" : ""}` : st.aVenir ? `${st.aVenir} à venir` : undefined} />
        <RdvKpi dark={dark} label="Honorés" value={st.venus} sub={rdvPct(st.tauxHonore)} />
        <RdvKpi dark={dark} label="Vendus" value={st.vendus} sub={`${rdvPct(st.tauxVente)} des affaires venues`} tone="good" />
        <RdvKpi dark={dark} label="Sans suivi" value={open.sansSuivi} tone={open.sansSuivi ? "bad" : undefined} sub="tous rendez-vous passés" />
        <RdvKpi dark={dark} label="Relances" value={open.relancesDues} tone={open.relancesRetard ? "warn" : undefined} sub={open.relancesRetard ? `${open.relancesRetard} en retard` : "à jour"} />
        <RdvKpi dark={dark} label="Réactivité" value={rdvReact(st.reactH)} sub="délai de saisie" />
        <RdvKpi dark={dark} label="Contacts notés" value={contacts} sub="appels, SMS, e-mails, visites" />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className={`space-y-4 rounded-2xl border p-4 ${s.card}`}>
          <div className={`text-sm font-semibold ${s.title}`}>Entonnoir</div>
          {funnel.map(([label, n, ratio]) => (
            <div key={label}>
              <div className="mb-1 flex items-center justify-between text-xs"><span className={s.muted}>{label}</span><span className={`font-semibold tabular-nums ${s.title}`}>{n} <span className={s.sub}>· {Math.round(ratio * 100)} %</span></span></div>
              <RdvBar dark={dark} value={ratio} max={1} />
            </div>
          ))}
          {st.vendus > 0 && (st.venteStock > 0 || st.venteCommande > 0) && <div className={`text-xs ${s.sub}`}>{st.venteStock} vendu{st.venteStock > 1 ? "s" : ""} sur stock · {st.venteCommande} sur commande</div>}
          {st.absents > 0 && <div className={`text-xs ${s.sub}`}>{st.absents} absent{st.absents > 1 ? "s" : ""} ou injoignable{st.absents > 1 ? "s" : ""} · {st.perdus} perdu{st.perdus > 1 ? "s" : ""}</div>}
        </div>
        <div className={`space-y-4 rounded-2xl border p-4 ${s.card}`}>
          <div className={`text-sm font-semibold ${s.title}`}>Objectifs</div>
          {goals.length ? goals : <div className={`text-sm ${s.sub}`}>Aucun objectif défini{isAdmin ? " — à fixer dans Gestion." : "."}</div>}
          {team && (
            <>
              <div className={`border-t pt-3 text-sm font-semibold ${dark ? "border-zinc-800" : "border-stone-100"} ${s.title}`}>Par rapport à l'équipe</div>
              <table className="w-full text-xs"><thead><tr className={s.sub}><th className="text-left font-medium">&nbsp;</th><th className="text-right font-medium">{nom}</th><th className="text-right font-medium">Équipe</th></tr></thead>
                <tbody>{cmp("Taux d'honorés", rdvPct(st.tauxHonore), rdvPct(team.tauxHonore))}{cmp("Transformation", rdvPct(st.tauxVente), rdvPct(team.tauxVente))}{cmp("Réactivité", rdvReact(st.reactH), rdvReact(team.reactH))}</tbody></table>
            </>
          )}
        </div>
      </div>
      {(overdue.length > 0 || relances.length > 0) && (
        <div className="space-y-5">
          {overdue.length > 0 && <RdvSection dark={dark} tone="rose" title="Résultats à saisir" count={overdue.length}><div className="space-y-2">{overdue.map((r) => row(r, { showDate: true }))}</div></RdvSection>}
          {relances.length > 0 && <RdvSection dark={dark} tone="amber" title="Relances à faire" count={relances.length}><div className="space-y-2">{relances.map((r) => row(r, { showDate: true }))}</div></RdvSection>}
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className={`rounded-2xl border p-4 ${s.card}`}>
          <div className={`mb-2 text-sm font-semibold ${s.title}`}>Par source</div>
          {sources.length === 0 ? <div className={`text-sm ${s.sub}`}>Aucune donnée.</div> : (
            <table className="w-full text-xs">
              <thead><tr className={s.sub}><th className="py-1 text-left font-medium">Source</th><th className="text-right font-medium">RDV</th><th className="text-right font-medium">Honorés</th><th className="text-right font-medium">Vendus</th><th className="text-right font-medium">Transfo.</th></tr></thead>
              <tbody className={`divide-y ${dark ? "divide-zinc-800" : "divide-stone-100"}`}>
                {sources.map(([k, v]) => (
                  <tr key={k}><td className={`py-1.5 ${s.title}`}>{k}</td><td className={`text-right tabular-nums ${s.title}`}>{v.pris}</td><td className={`text-right tabular-nums ${s.title}`}>{v.venus}</td><td className={`text-right tabular-nums ${s.title}`}>{v.vendus}</td><td className={`text-right tabular-nums ${s.muted}`}>{v.venus ? Math.round((v.vendus / v.venus) * 100) + " %" : "—"}</td></tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className={`rounded-2xl border p-4 ${s.card}`}>
          <div className={`mb-2 text-sm font-semibold ${s.title}`}>Motifs de perte</div>
          {motifs.length === 0 ? <div className={`text-sm ${s.sub}`}>Aucune vente perdue sur la période.</div> : (
            <div className="space-y-2.5">
              {motifs.map(([k, n]) => (
                <div key={k}><div className="mb-1 flex justify-between text-xs"><span className={s.muted}>{k}</span><span className={`font-semibold tabular-nums ${s.title}`}>{n}</span></div><RdvBar dark={dark} value={n} max={motifs[0][1]} tone="bad" /></div>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className={`rounded-2xl border p-4 ${s.card}`}>
        <div className={`mb-2 text-sm font-semibold ${s.title}`}>Évolution sur 6 mois</div>
        <RdvMonthlyChart dark={dark} data={monthly} />
      </div>
      <RdvSection dark={dark} title="Rendez-vous de la période" count={list.length}>
        {list.length === 0 ? <div className={`text-sm ${s.sub}`}>Aucun rendez-vous sur cette période.</div> : (
          <div className="space-y-2">
            {list.slice(0, limit).map((r) => row(r, { showDate: true }))}
            {list.length > limit && <button onClick={() => setLimit((l) => l + 30)} className={`${s.ghostBtn} w-full`}>Afficher plus ({list.length - limit})</button>}
          </div>
        )}
      </RdvSection>
    </div>
  );
}

// ───────── Récap hebdomadaire ─────────
function rdvPrintRecap(rc) {
  const esc = (x) => String(x ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  const w = window.open("", "_blank");
  if (!w) return false;
  const rowsHtml = rc.per.map((p) => `<tr><td>${esc(p.nom)}</td><td>${p.st.pris}</td><td>${p.st.venus}</td><td>${rdvPct(p.st.tauxHonore)}</td><td>${p.st.vendus}</td><td>${rdvPct(p.st.tauxVente)}</td><td>${p.obj?.rdv_semaine != null ? p.st.pris + " / " + p.obj.rdv_semaine : "—"}</td><td>${p.sansSuiviAll || "—"}</td></tr>`).join("");
  const att = rc.attention.length ? rc.attention.map((a) => `<li>${esc(a)}</li>`).join("") : "<li>Aucun point d'attention</li>";
  w.document.write(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Rapport RDV — semaine du ${esc(rdvFrRange(rc.from, rc.to))}</title><style>
  body{font-family:Inter,Arial,sans-serif;color:#1c1917;margin:32px;font-size:14px}h1{font-size:22px;margin:0 0 4px}h2{font-size:15px;margin:24px 0 8px}
  .sub{color:#78716c;margin-bottom:20px}.kpis{display:flex;gap:12px;margin:16px 0}.kpi{border:1px solid #e7e5e4;border-radius:10px;padding:10px 16px;min-width:110px}.kpi b{display:block;font-size:22px}
  table{border-collapse:collapse;width:100%}th,td{border-bottom:1px solid #e7e5e4;padding:8px 10px;text-align:right}th:first-child,td:first-child{text-align:left}th{font-size:12px;color:#78716c;font-weight:500}li{margin:4px 0}
  </style></head><body><h1>Rapport RDV — Ford Caen</h1><div class="sub">Semaine du ${esc(rdvFrRange(rc.from, rc.to))}</div>
  <div class="kpis"><div class="kpi"><b>${rc.team.pris}</b>rendez-vous</div><div class="kpi"><b>${rc.team.venus}</b>honorés · ${rdvPct(rc.team.tauxHonore)}</div><div class="kpi"><b>${rc.team.vendus}</b>vendus · ${rdvPct(rc.team.tauxVente)}</div></div>
  <h2>Par vendeur</h2><table><thead><tr><th>Vendeur</th><th>RDV</th><th>Honorés</th><th>Taux</th><th>Vendus</th><th>Transfo.</th><th>Objectif</th><th>Sans suivi</th></tr></thead><tbody>${rowsHtml}</tbody></table>
  <h2>Points d'attention</h2><ul>${att}</ul><h2>Semaine suivante</h2><p>${rc.next.total} rendez-vous planifiés (${esc(rdvFrRange(rc.next.from, rc.next.to))}).</p></body></html>`);
  w.document.close(); w.focus();
  setTimeout(() => w.print(), 350);
  return true;
}

function RdvRecap({ dark, rows, names, objectifs, now, today, plan, showToast }) {
  const s = marketingStyles(dark);
  const [offset, setOffset] = useState(0);
  const weekStart = marketingAddDays(rdvWeekStart(today), offset * 7);
  const rc = useMemo(() => rdvWeekRecap(rows, names, objectifs, weekStart, now, today, plan), [rows, names, objectifs, weekStart, now, today, plan]);
  const th = `px-3 py-2 text-right text-[11px] font-medium ${s.sub}`;
  const td = `px-3 py-2.5 text-right tabular-nums ${s.title}`;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => setOffset((o) => o - 1)} className={s.ghostBtn} aria-label="Semaine précédente"><ChevronLeft size={15} /></button>
        <div className={`min-w-[190px] text-center text-sm font-semibold ${s.title}`}>Semaine du {rdvFrRange(rc.from, rc.to)}</div>
        <button onClick={() => setOffset((o) => Math.min(0, o + 1))} disabled={offset >= 0} className={`${s.ghostBtn} disabled:opacity-40`} aria-label="Semaine suivante"><ChevronRight size={15} /></button>
        {offset !== 0 && <button onClick={() => setOffset(0)} className={`text-xs underline ${s.muted}`}>cette semaine</button>}
        <div className="ml-auto flex gap-2">
          <button onClick={() => marketingCopy(rdvRecapText(rc), showToast, "Récap copié — prêt à coller")} className={`${s.ghostBtn} flex items-center gap-1.5`}><Copy size={14} /> Copier</button>
          <button onClick={() => { if (!rdvPrintRecap(rc)) showToast("Autorisez les fenêtres pop-up pour imprimer", { type: "error" }); }} className={`${s.ghostBtn} flex items-center gap-1.5`}><Printer size={14} /> Imprimer / PDF</button>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <RdvKpi dark={dark} label="Rendez-vous" value={rc.team.pris} />
        <RdvKpi dark={dark} label="Honorés" value={rc.team.venus} sub={rdvPct(rc.team.tauxHonore)} />
        <RdvKpi dark={dark} label="Vendus" value={rc.team.vendus} sub={`${rdvPct(rc.team.tauxVente)} des affaires venues`} tone="good" />
        <RdvKpi dark={dark} label="Semaine suivante" value={rc.next.total} sub="rendez-vous planifiés" />
      </div>
      <div className={`overflow-x-auto rounded-2xl border ${s.card}`}>
        <table className="w-full min-w-[640px] text-sm">
          <thead><tr className={`border-b ${dark ? "border-zinc-800" : "border-stone-200"}`}><th className={`${th} !text-left`}>Vendeur</th><th className={th}>RDV</th><th className={th}>Honorés</th><th className={th}>Taux</th><th className={th}>Vendus</th><th className={th}>Objectif</th><th className={th}>Sans suivi</th><th className={th}>Semaine suivante</th></tr></thead>
          <tbody className={`divide-y ${dark ? "divide-zinc-800" : "divide-stone-100"}`}>
            {rc.per.map((p) => (
              <tr key={p.nom}>
                <td className={`px-3 py-2.5 font-semibold ${s.title}`}>{p.nom}</td><td className={td}>{p.st.pris}</td><td className={td}>{p.st.venus}</td><td className={td}>{rdvPct(p.st.tauxHonore)}</td><td className={td}>{p.st.vendus}</td>
                <td className={td}>{p.obj?.rdv_semaine != null ? `${p.st.pris} / ${p.obj.rdv_semaine}` : "—"}</td>
                <td className={`${td} ${p.sansSuiviAll ? (dark ? "!text-rose-300" : "!text-rose-600") : ""}`}>{p.sansSuiviAll || "—"}</td><td className={td}>{rc.next.by[p.nom] || "—"}</td>
              </tr>
            ))}
            {rc.per.length === 0 && <tr><td colSpan={8} className={`px-3 py-8 text-center ${s.sub}`}>Aucun rendez-vous cette semaine.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className={`rounded-2xl border p-4 ${s.card}`}>
        <div className={`mb-2 flex items-center gap-2 text-sm font-semibold ${s.title}`}><Flag size={15} className={s.sub} /> Points d'attention</div>
        {rc.attention.length === 0 ? <div className={`text-sm ${s.sub}`}>Rien à signaler.</div> : (
          <ul className={`space-y-1.5 text-sm ${s.muted}`}>{rc.attention.map((a, i) => <li key={i} className="flex gap-2"><span className={dark ? "text-amber-300" : "text-amber-600"}>•</span>{a}</li>)}</ul>
        )}
      </div>
    </div>
  );
}

// ───────── Gestion (administrateur) ─────────
function RdvGestion({ dark, rdv, vendeursList, vendeurNames, now, today, showToast, onRestore, onReassign }) {
  const s = marketingStyles(dark);
  const [addNom, setAddNom] = useState("");
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState({});
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [abs, setAbs] = useState({ commercial: "", du: "", au: "", note: "" });
  const upcomingAbs = rdv.absences.filter((a) => a.au >= today).sort((a, b) => a.du.localeCompare(b.du));
  const addAbs = async () => {
    try { await rdv.addAbsence(abs); setAbs({ commercial: "", du: "", au: "", note: "" }); showToast("Absence enregistrée"); }
    catch (e) { showToast(`Impossible : ${e.message || e}`, { type: "error" }); }
  };
  const memberNames = new Set(rdv.members.map((m) => m.nom));
  const candidates = vendeursList.filter((v) => !RDV_EXCLUDED_ROLES.includes(v.role) && !memberNames.has(v.nom));
  const objBy = new Map(rdv.objectifs.map((o) => [o.commercial, o]));
  const trash = rdv.rows.filter((r) => r.deleted_at).sort((a, b) => new Date(b.deleted_at) - new Date(a.deleted_at));
  const movable = from ? rdv.rows.filter((r) => !r.deleted_at && r.commercial === from && r.statut === "À venir" && !rdvIsOverdue(r, now)) : [];
  const toStr = (v) => (v == null ? "" : String(v));
  const val = (nom, k) => (draft[nom] && k in draft[nom] ? draft[nom][k] : toStr(objBy.get(nom)?.[k]));
  const setVal = (nom, k, v) => setDraft((d) => ({ ...d, [nom]: { ...(d[nom] || {}), [k]: v } }));
  const grant = async () => {
    const v = vendeursList.find((x) => x.nom === addNom);
    if (!v) return;
    if (!v.email) { showToast("Ce vendeur n'a pas d'email : renseignez-le dans Réglages", { type: "error" }); return; }
    setBusy(true);
    try {
      const ok = await rdv.addMember(v.email, v.nom);
      showToast(ok ? `${v.nom} voit maintenant ses rendez-vous` : "Aucun compte ParcLive pour cet email : le vendeur doit se connecter une première fois", { type: ok ? "success" : "error" });
      if (ok) setAddNom("");
    } catch (e) { showToast(`Impossible : ${e.message || e}`, { type: "error" }); }
    setBusy(false);
  };
  const saveObj = async (nom) => {
    const num = (k) => { const x = val(nom, k).trim(); return x === "" ? null : Math.max(0, parseInt(x, 10) || 0); };
    const pct = (k) => { const x = num(k); return x == null ? null : Math.min(100, x); };
    try {
      await rdv.saveObjectif(nom, { rdv_semaine: num("rdv_semaine"), honore_pct: pct("honore_pct"), vente_pct: pct("vente_pct") });
      setDraft((d) => { const n = { ...d }; delete n[nom]; return n; });
      showToast(`Objectifs de ${nom} enregistrés`);
    } catch (e) { showToast(`Impossible : ${e.message || e}`, { type: "error" }); }
  };
  const doMove = async () => {
    if (!movable.length || !to || to === from) return;
    if (!window.confirm(`Réattribuer ${movable.length} rendez-vous à venir de ${from} vers ${to} ?`)) return;
    try { await onReassign(movable.map((r) => r.id), to); showToast(`${movable.length} rendez-vous réattribués à ${to}`); setFrom(""); setTo(""); }
    catch (e) { showToast(`Impossible : ${e.message || e}`, { type: "error" }); }
  };
  const card = `rounded-2xl border p-4 ${s.card}`;
  const small = `${s.input} !w-20 text-right`;
  return (
    <div className="space-y-5">
      <div className={card}>
        <div className={`text-sm font-semibold ${s.title}`}>Accès des vendeurs</div>
        <p className={`mb-3 mt-0.5 text-xs ${s.sub}`}>Un vendeur ajouté voit uniquement ses propres rendez-vous et ne remplit que le suivi. Seul vous créez et modifiez les rendez-vous.</p>
        <ul className={`divide-y ${dark ? "divide-zinc-800" : "divide-stone-100"}`}>
          {rdv.members.map((m) => (
            <li key={m.user_id} className="flex items-center gap-3 py-2 text-sm">
              <span className={`font-medium ${s.title}`}>{m.nom}</span>
              <span className={`text-xs ${s.sub}`}>{m.email}</span>
              <span className="ml-auto"><RdvPill dark={dark} tone={m.role === "admin" ? "blue" : "gray"}>{m.role === "admin" ? "Administrateur" : "Vendeur"}</RdvPill></span>
              {m.role !== "admin" && (
                <button onClick={async () => { if (window.confirm(`Retirer l'accès de ${m.nom} ?`)) { try { await rdv.removeMember(m.user_id); showToast("Accès retiré"); } catch (e) { showToast(`Impossible : ${e.message || e}`, { type: "error" }); } } }} className={`rounded p-1.5 ${dark ? "text-zinc-400 hover:bg-zinc-800" : "text-stone-400 hover:bg-stone-100"}`} title="Retirer l'accès"><Trash2 size={14} /></button>
              )}
            </li>
          ))}
        </ul>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <select className={`${s.input} !w-auto min-w-[220px]`} value={addNom} onChange={(e) => setAddNom(e.target.value)}>
            <option value="">Donner l'accès à…</option>
            {candidates.map((v) => <option key={v.nom} value={v.nom}>{v.nom}{v.email ? "" : " (email manquant)"}</option>)}
          </select>
          <button onClick={grant} disabled={!addNom || busy} className={s.primaryBtn}>{busy ? "…" : "Donner l'accès"}</button>
        </div>
      </div>

      <div className={card}>
        <div className={`mb-3 text-sm font-semibold ${s.title}`}>Objectifs par vendeur</div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead><tr className={s.sub}><th className="py-1 text-left text-[11px] font-medium">Vendeur</th><th className="text-right text-[11px] font-medium">RDV / semaine</th><th className="text-right text-[11px] font-medium">% honorés</th><th className="text-right text-[11px] font-medium">% transfo.</th><th /></tr></thead>
            <tbody className={`divide-y ${dark ? "divide-zinc-800" : "divide-stone-100"}`}>
              {vendeurNames.map((nom) => (
                <tr key={nom}>
                  <td className={`py-2 font-medium ${s.title}`}>{nom}</td>
                  {["rdv_semaine", "honore_pct", "vente_pct"].map((k) => (
                    <td key={k} className="py-1.5 text-right"><input className={small} inputMode="numeric" value={val(nom, k)} onChange={(e) => setVal(nom, k, e.target.value.replace(/\D/g, ""))} placeholder="—" /></td>
                  ))}
                  <td className="py-1.5 pl-3 text-right">{draft[nom] && <button onClick={() => saveObj(nom)} className={s.primaryBtn}>Enregistrer</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className={card}>
        <div className={`text-sm font-semibold ${s.title}`}>Planning des vendeurs</div>
        <p className={`mb-3 mt-0.5 text-xs ${s.sub}`}>Cochez les jours de repos habituels : à la création d'un rendez-vous, ParcLive prévient si le vendeur n'est pas là et propose un autre jour ou un collègue présent. Les relances tombant un jour d'absence sont reportées au premier jour de présence.</p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead><tr className={s.sub}><th className="py-1 text-left text-[11px] font-medium">Vendeur — jours de repos</th>{RDV_WEEK_ORDER.map((d) => <th key={d} className="px-0.5 text-center text-[11px] font-medium">{RDV_DAYS_SHORT[d]}</th>)}</tr></thead>
            <tbody className={`divide-y ${dark ? "divide-zinc-800" : "divide-stone-100"}`}>
              {vendeurNames.map((nom) => {
                const set = rdv.plan.repos.get(nom) || new Set();
                const toggle = async (d) => {
                  const next = new Set(set); if (next.has(d)) next.delete(d); else next.add(d);
                  try { await rdv.savePlanning(nom, [...next].sort((a, b) => a - b)); } catch (e) { showToast(`Impossible : ${e.message || e}`, { type: "error" }); }
                };
                return (
                  <tr key={nom}>
                    <td className={`py-2 font-medium ${s.title}`}>{nom}</td>
                    {RDV_WEEK_ORDER.map((d) => (
                      <td key={d} className="px-0.5 py-1.5 text-center">
                        <button onClick={() => toggle(d)} aria-pressed={set.has(d)} title={`${set.has(d) ? "Repos" : "Présent"} le ${RDV_DAYS[d]}`} className={`h-8 w-10 rounded-lg text-xs font-semibold transition-colors ${set.has(d) ? (dark ? "bg-amber-500/20 text-amber-200 ring-1 ring-amber-500/40" : "bg-amber-100 text-amber-800 ring-1 ring-amber-300") : dark ? "bg-zinc-800 text-zinc-500 hover:bg-zinc-700" : "bg-stone-100 text-stone-400 hover:bg-stone-200"}`}>{set.has(d) ? "Repos" : "·"}</button>
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className={`mt-4 border-t pt-3 ${dark ? "border-zinc-800" : "border-stone-100"}`}>
          <div className={`mb-2 text-sm font-semibold ${s.title}`}>Absences et congés</div>
          {upcomingAbs.length === 0 ? <div className={`mb-2 text-sm ${s.sub}`}>Aucune absence à venir.</div> : (
            <ul className={`mb-3 divide-y ${dark ? "divide-zinc-800" : "divide-stone-100"}`}>
              {upcomingAbs.map((a) => {
                const hit = rdv.rows.filter((r) => !r.deleted_at && r.commercial === a.commercial && r.statut === "À venir" && rdvDay(r) >= a.du && rdvDay(r) <= a.au).length;
                return (
                  <li key={a.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                    <span className={`font-medium ${s.title}`}>{a.commercial}</span>
                    <span className={`text-xs ${s.muted}`}>{a.du === a.au ? marketingFrDate(a.du) : `du ${marketingFrDate(a.du)} au ${marketingFrDate(a.au)}`}{a.note ? ` · ${a.note}` : ""}</span>
                    {hit > 0 && <RdvPill dark={dark} tone="amber"><AlertTriangle size={11} /> {hit} rendez-vous à venir</RdvPill>}
                    <button onClick={async () => { try { await rdv.removeAbsence(a.id); } catch (e) { showToast(`Impossible : ${e.message || e}`, { type: "error" }); } }} className={`ml-auto rounded p-1.5 ${dark ? "text-zinc-400 hover:bg-zinc-800" : "text-stone-400 hover:bg-stone-100"}`} title="Supprimer l'absence"><Trash2 size={14} /></button>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="flex flex-wrap items-end gap-2">
            <div className="w-56"><div className={s.label}>Vendeur</div><RdvVendeurPicker dark={dark} value={abs.commercial} onChange={(v) => setAbs((x) => ({ ...x, commercial: v }))} names={vendeurNames} /></div>
            <div><div className={s.label}>Du</div><input type="date" className={`${s.input} !w-auto`} value={abs.du} onChange={(e) => setAbs((x) => ({ ...x, du: e.target.value, au: x.au && x.au >= e.target.value ? x.au : e.target.value }))} /></div>
            <div><div className={s.label}>Au</div><input type="date" className={`${s.input} !w-auto`} value={abs.au} min={abs.du} onChange={(e) => setAbs((x) => ({ ...x, au: e.target.value }))} /></div>
            <div className="min-w-[160px] flex-1"><div className={s.label}>Motif (facultatif)</div><input className={s.input} value={abs.note} onChange={(e) => setAbs((x) => ({ ...x, note: e.target.value }))} placeholder="Congés, formation…" /></div>
            <button onClick={addAbs} disabled={!abs.commercial || !abs.du || !abs.au || abs.au < abs.du} className={s.primaryBtn}>Ajouter</button>
          </div>
        </div>
      </div>

      <div className={card}>
        <div className={`text-sm font-semibold ${s.title}`}>Réattribuer en cas d'absence</div>
        <p className={`mb-3 mt-0.5 text-xs ${s.sub}`}>Déplace tous les rendez-vous à venir d'un vendeur vers un autre. L'historique garde la trace du changement.</p>
        <div className="flex flex-wrap items-center gap-2">
          <RdvVendeurPicker dark={dark} value={from} onChange={setFrom} names={vendeurNames} placeholder="De… (premières lettres)" className="w-56" />
          <ChevronRight size={14} className={s.sub} />
          <RdvVendeurPicker dark={dark} value={to} onChange={setTo} names={vendeurNames.filter((n) => n !== from)} plan={rdv.plan} date={today} placeholder="Vers… (premières lettres)" className="w-56" />
          <button onClick={doMove} disabled={!movable.length || !to} className={s.primaryBtn}>Réattribuer{from ? ` (${movable.length})` : ""}</button>
        </div>
      </div>

      <div className={card}>
        <div className="flex items-center gap-2">
          <div className={`text-sm font-semibold ${s.title}`}>Corbeille</div>
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${dark ? "bg-zinc-800 text-zinc-300" : "bg-stone-100 text-stone-600"}`}>{trash.length}</span>
        </div>
        <p className={`mb-2 mt-0.5 text-xs ${s.sub}`}>Les rendez-vous supprimés restent récupérables 30 jours, puis sont effacés définitivement.</p>
        {trash.length === 0 ? <div className={`text-sm ${s.sub}`}>La corbeille est vide.</div> : (
          <ul className={`divide-y ${dark ? "divide-zinc-800" : "divide-stone-100"}`}>
            {trash.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                <span className={`font-medium ${s.title}`}>{r.client_nom}</span>
                <span className={`text-xs ${s.sub}`}>{new Date(r.date_rdv).toLocaleDateString("fr-FR")} · {r.commercial} · supprimé le {new Date(r.deleted_at).toLocaleDateString("fr-FR")}</span>
                <button onClick={() => onRestore(r)} className={`${s.ghostBtn} ml-auto flex items-center gap-1.5`}><RotateCcw size={13} /> Restaurer</button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className={card}>
        <div className={`text-sm font-semibold ${s.title}`}>Données</div>
        <p className={`mb-3 mt-0.5 text-xs ${s.sub}`}>Les rendez-vous de plus de 24 mois sont supprimés automatiquement ; leurs statistiques mensuelles (sans nom de client) restent dans les graphiques.</p>
        <button onClick={() => exportRdvToExcel(rdv.rows, "tout", rdv.rows)} className={`${s.ghostBtn} flex items-center gap-1.5`}><Download size={14} /> Exporter tous les rendez-vous (Excel)</button>
      </div>
    </div>
  );
}

// ───────── Onglet ─────────
function RdvTab({ dark, me, rdv, vendeursList, vehicles, showToast }) {
  const isAdmin = me.role === "admin";
  const s = marketingStyles(dark);
  const views = isAdmin
    ? [["jour", "Aujourd'hui"], ["pipeline", "Pipeline"], ["rdv", "Rendez-vous"], ["equipe", "Vendeurs"], ["recap", "Récap hebdo"], ["gestion", "Gestion"]]
    : [["jour", "Ma journée"], ["pipeline", "Mon pipeline"], ["rdv", "Mes rendez-vous"], ["fiche", "Ma fiche"]];
  const [vue, setVueRaw] = useState(() => { const v = loadLocal("dsr:rdv-vue", "jour"); return views.some((x) => x[0] === v) ? v : "jour"; });
  const setVue = (v) => { setVueRaw(v); saveLocal("dsr:rdv-vue", v); };
  const [ficheNom, setFicheNom] = useState("");
  const [modalId, setModalId] = useState(null);
  const [preset, setPreset] = useState(null);
  const [form, setForm] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 60000); return () => clearInterval(t); }, []);
  const today = prospectionTodayISO(now);

  const vehicleByOrder = useMemo(() => new Map(vehicles.map((v) => [normalizeOrderNum(v.orderNumber), v])), [vehicles]);
  const vendeurNames = useMemo(() => {
    const set = new Set(vendeursList.filter((v) => !RDV_EXCLUDED_ROLES.includes(v.role)).map((v) => v.nom));
    rdv.rows.forEach((r) => { if (r.commercial) set.add(r.commercial); });
    return [...set].sort((a, b) => a.localeCompare(b, "fr"));
  }, [vendeursList, rdv.rows]);
  const modalRdv = modalId ? rdv.rows.find((r) => r.id === modalId) : null;
  const plan = rdv.plan;
  const rankMap = useMemo(() => rdvRankMap(rdv.rows), [rdv.rows]);
  const affaires = useMemo(() => rdvAffaires(rdv.rows), [rdv.rows]);
  const modalChain = modalRdv ? affaires.get(rdvAffaireKey(modalRdv)) : null;
  const modalNotes = useMemo(() => (modalRdv ? rdv.notes.filter((n) => (n.affaire_id || n.rdv_id) === rdvAffaireKey(modalRdv)) : []), [rdv.notes, modalRdv]);

  const openRdv = useCallback((id) => { setPreset(null); setModalId(id); }, []);
  const fail = (e) => showToast(`Action impossible : ${e.message || e}`, { type: "error" });
  const onAction = async (r, st) => {
    if (st === "Honoré") {
      setBusyId(r.id);
      try { await rdv.update(r.id, { statut: "Honoré" }); showToast(`${r.client_nom} : rendez-vous honoré`); } catch (e) { fail(e); }
      setBusyId(null);
      return;
    }
    setPreset(st); setModalId(r.id);
  };
  const saveSuivi = async (id, patch) => {
    await rdv.update(id, patch);
    showToast(patch.statut === "Vendu" ? "Vente enregistrée" : "Suivi enregistré", patch.statut === "Vendu" ? { type: "celebrate" } : undefined);
  };
  const createSave = async (fields, another) => {
    const row = await rdv.create(fields);
    showToast(fields.parent_id ? `Suite planifiée le ${new Date(row.date_rdv).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })}` : "Rendez-vous créé");
    if (!another) setForm(null);
  };
  const onSuite = (r) => { setModalId(null); setPreset(null); setForm({ initial: null, suiteOf: r }); };
  const editSave = async (fields) => {
    await rdv.update(form.initial.id, rdvCleanRow(fields));
    showToast("Rendez-vous modifié");
    setForm(null);
  };
  const trashRdv = async (r) => {
    if (!window.confirm(`Mettre le rendez-vous de ${r.client_nom} à la corbeille ?`)) return;
    try { await rdv.update(r.id, { deleted_at: new Date().toISOString() }); setModalId(null); showToast("Mis à la corbeille (récupérable 30 jours)"); } catch (e) { fail(e); }
  };
  const restoreRdv = async (r) => {
    try { await rdv.update(r.id, { deleted_at: null }); showToast("Rendez-vous restauré"); } catch (e) { fail(e); }
  };
  const common = { dark, rows: rdv.rows, now, today, isAdmin, vendeurNames, vehicleByOrder, onOpen: openRdv, onAction, onSuite, busyId, showToast, plan, rankMap, notes: rdv.notes, meNom: me.nom };

  if (rdv.loading) return <div className={`py-16 text-center text-sm ${s.sub}`}>Chargement des rendez-vous…</div>;
  if (rdv.error) {
    return (
      <div className={`rounded-xl border p-5 text-sm ${dark ? "border-rose-500/30 bg-rose-500/10 text-rose-200" : "border-rose-200 bg-rose-50 text-rose-800"}`}>
        <div className="mb-1 font-semibold">Impossible de charger les rendez-vous</div>
        <div className="mb-3 text-xs opacity-80">{rdv.error}</div>
        <button onClick={rdv.refresh} className={s.ghostBtn}>Réessayer</button>
      </div>
    );
  }
  const liveCount = rdv.rows.filter((r) => !r.deleted_at).length;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <div className={`flex max-w-full items-center gap-1 overflow-x-auto rounded-xl border p-1 ${dark ? "border-zinc-800 bg-zinc-900/60" : "border-stone-200 bg-white shadow-sm"}`} style={{ scrollbarWidth: "none" }}>
          {views.map(([k, label]) => (
            <button key={k} onClick={() => { setVue(k); if (k !== "equipe") setFicheNom(""); }} className={`shrink-0 whitespace-nowrap rounded-lg px-3.5 py-1.5 text-sm font-medium transition-colors ${vue === k ? (dark ? "bg-blue-500/10 text-blue-300" : "bg-blue-50 text-blue-700") : dark ? "text-zinc-400 hover:text-zinc-200" : "text-stone-500 hover:text-stone-800"}`}>{label}</button>
          ))}
        </div>
        {isAdmin && (
          <button onClick={() => setForm({ initial: null })} className={`${s.primaryBtn} ml-auto flex items-center gap-1.5`}><Plus size={15} /> Nouveau rendez-vous</button>
        )}
      </div>

      {isAdmin && liveCount === 0 && vue !== "gestion" && (
        <div className={`rounded-2xl border p-6 text-center ${s.card}`}>
          <CalendarClock size={26} className={`mx-auto mb-2 ${s.sub}`} />
          <div className={`font-semibold ${s.title}`}>Aucun rendez-vous pour l'instant</div>
          <p className={`mx-auto mb-4 mt-1 max-w-md text-sm ${s.sub}`}>Créez le premier rendez-vous : vous seul pouvez en ajouter, vos vendeurs renseignent ensuite le suivi. Donnez-leur l'accès dans « Gestion ».</p>
          <button onClick={() => setForm({ initial: null })} className={s.primaryBtn}>Créer un rendez-vous</button>
        </div>
      )}

      {vue === "jour" && <RdvJour {...common} />}
      {vue === "pipeline" && <RdvPipeline {...common} />}
      {vue === "rdv" && <RdvListe {...common} onReassign={rdv.reassign} />}
      {vue === "equipe" && isAdmin && (ficheNom
        ? <RdvFiche {...common} nom={ficheNom} archive={rdv.archive} objectifs={rdv.objectifs} teamRows={rdv.rows} onBack={() => setFicheNom("")} />
        : <RdvEquipe dark={dark} rows={rdv.rows} archive={rdv.archive} objectifs={rdv.objectifs} names={vendeurNames} now={now} today={today} plan={plan} onOpenFiche={setFicheNom} />)}
      {vue === "recap" && isAdmin && <RdvRecap dark={dark} rows={rdv.rows} names={vendeurNames} objectifs={rdv.objectifs} now={now} today={today} plan={plan} showToast={showToast} />}
      {vue === "gestion" && isAdmin && <RdvGestion dark={dark} rdv={rdv} vendeursList={vendeursList} vendeurNames={vendeurNames} now={now} today={today} showToast={showToast} onRestore={restoreRdv} onReassign={rdv.reassign} />}
      {vue === "fiche" && !isAdmin && <RdvFiche {...common} nom={null} archive={[]} objectifs={rdv.objectifs} teamRows={null} />}

      {modalRdv && (
        <RdvModal
          key={modalRdv.id + (preset || "")}
          dark={dark} rdv={modalRdv} preset={preset} isAdmin={isAdmin} vehicles={vehicles} vehicleByOrder={vehicleByOrder} today={today}
          plan={plan} chain={modalChain} notes={modalNotes} onSuite={onSuite} onOpenOther={openRdv} onAddNote={rdv.addNote}
          onClose={() => { setModalId(null); setPreset(null); }}
          onSaveSuivi={saveSuivi}
          onEdit={(r) => { setModalId(null); setForm({ initial: r }); }}
          onDelete={trashRdv}
          loadHistory={rdv.loadHistory}
        />
      )}
      {form && (
        <RdvFormModal
          key={form.initial?.id || form.suiteOf?.id || "new"}
          dark={dark} initial={form.initial} suiteOf={form.suiteOf} isAdmin={isAdmin} today={today} plan={plan} vendeurNames={vendeurNames} vehicles={vehicles} rows={rdv.rows}
          onSave={form.initial ? editSave : createSave}
          onClose={() => setForm(null)}
        />
      )}
    </div>
  );
}

export default function App() {
  const [dark, setDark] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const [dbStatus, setDbStatus] = useState("checking");
  const [authEmail, setAuthEmail] = useState("");
  const [authUserId, setAuthUserId] = useState("");
  const [passwordRecovery, setPasswordRecovery] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [ordersData, setOrdersData] = useState([]);
  const [stockData, setStockData] = useState([]);
  const [overlays, setOverlays] = useState({});
  const [importMeta, setImportMeta] = useState(null);
  const [accidents, setAccidents] = useState([]);
  const [dossiersData, setDossiersData] = useState([]);
  const [vendeursList, setVendeursList] = useState([]);
  const [manualSales, setManualSales] = useState({});
  const [sitesList, setSitesList] = useState(FORD_SITES);
  const [alertSettings, setAlertSettings] = useState(DEFAULT_ALERT_SETTINGS);
  const [activityLog, setActivityLog] = useState([]);
  const [convoyages, setConvoyages] = useState([]);
  const [challengeConfig, setChallengeConfig] = useState(DEFAULT_CHALLENGE_CONFIG);
  const [challengeEntries, setChallengeEntries] = useState([]);
  const [vehicleComments, setVehicleComments] = useState([]);
  const [documentsConfig, setDocumentsConfig] = useState(DEFAULT_DOCUMENTS_CONFIG);
  const [dossiersMeta, setDossiersMeta] = useState(null);
  const [lastSync, setLastSync] = useState(null);
  const [importOpen, setImportOpen] = useState(false);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [legendOpen, setLegendOpen] = useState(false);
  const [showWelcome, setShowWelcome] = useState(() => !loadLocal("dsr:welcome-seen", false));
  const [dossiersSubTab, setDossiersSubTab] = useState("dossiers");
  const [selected, setSelected] = useState(() => {
    const saved = loadLocal("dsr:ui-selected", null);
    return saved ? { orderNumber: saved } : null;
  });
  const [resetConfirm, setResetConfirm] = useState(false);
  // Onglets retirés de la navigation (non utilisés) : si l'un d'eux était mémorisé, on retombe sur Véhicules.
  const [tab, setTab] = useState(() => {
    const saved = loadLocal("dsr:ui-tab", "vehicules");
    return ["convoyage", "challenge", "documents"].includes(saved) ? "vehicules" : saved;
  });
  const [filters, setFilters] = useState(() =>
    loadLocal("dsr:ui-filters", { modele: "all", site: "all", typeVente: [], vu: "all", statut: "all", vendeur: "all", carrosserie: "all", boite: "all", query: "" })
  );
  const [sortBy, setSortBy] = useState(() => loadLocal("dsr:ui-sort", "stock_desc"));


  useEffect(() => { saveLocal("dsr:ui-tab", tab); }, [tab]);
  useEffect(() => { saveLocal("dsr:ui-filters", filters); }, [filters]);
  useEffect(() => { saveLocal("dsr:ui-sort", sortBy); }, [sortBy]);
  useEffect(() => { saveLocal("dsr:ui-selected", selected?.orderNumber || null); }, [selected]);

  const [toast, setToast] = useState(null);
  function showToast(message, opts = {}) {
    setToast({ message, type: opts.type || "success", action: opts.action, id: Date.now() });
  }
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), toast.action ? 5000 : 3000);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    function onKeyDown(e) {
      const tag = document.activeElement?.tagName;
      const typing = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || document.activeElement?.isContentEditable;
      if (e.key === "/" && !typing) {
        e.preventDefault();
        setTab("vehicules");
        setTimeout(() => document.getElementById("parclive-search")?.focus(), 0);
      } else if (e.key === "Escape") {
        if (importOpen) setImportOpen(false);
        else if (alertsOpen) setAlertsOpen(false);
        else if (legendOpen) setLegendOpen(false);
        else if (selected) setSelected(null);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [importOpen, alertsOpen, selected, legendOpen]);

  const localWriteVersionRef = useRef(0);
  const PROTECTED_KEYS = useMemo(
    () =>
      new Set([
        STORE_KEYS.overlays,
        STORE_KEYS.accidents,
        STORE_KEYS.dossiers,
        STORE_KEYS.vendeurs,
        STORE_KEYS.manualSales,
        STORE_KEYS.convoyages,
        STORE_KEYS.challengeEntries,
        STORE_KEYS.vehicleComments,
      ]),
    []
  );
  function applyStoreValue(key, raw) {
    switch (key) {
      case STORE_KEYS.orders: if (raw) setOrdersData(JSON.parse(raw)); break;
      case STORE_KEYS.stock: if (raw) setStockData(JSON.parse(raw)); break;
      case STORE_KEYS.meta: if (raw) setImportMeta(JSON.parse(raw)); break;
      case STORE_KEYS.dossiersMeta: if (raw) setDossiersMeta(JSON.parse(raw)); break;
      case STORE_KEYS.sites: if (raw) setSitesList(JSON.parse(raw)); break;
      case STORE_KEYS.alertSettings: if (raw) setAlertSettings({ ...DEFAULT_ALERT_SETTINGS, ...JSON.parse(raw) }); break;
      case STORE_KEYS.activityLog: if (raw) setActivityLog(JSON.parse(raw)); break;
      case STORE_KEYS.challengeConfig: if (raw) setChallengeConfig({ ...DEFAULT_CHALLENGE_CONFIG, ...JSON.parse(raw) }); break;
      case STORE_KEYS.documentsConfig: if (raw) setDocumentsConfig({ ...DEFAULT_DOCUMENTS_CONFIG, ...JSON.parse(raw) }); break;
      case STORE_KEYS.overlays: setOverlays(raw ? JSON.parse(raw) : {}); break;
      case STORE_KEYS.accidents: setAccidents(raw ? JSON.parse(raw) : []); break;
      case STORE_KEYS.dossiers: setDossiersData(raw ? JSON.parse(raw) : []); break;
      case STORE_KEYS.vendeurs: if (raw) setVendeursList(JSON.parse(raw).map(normalizeVendeur)); break;
      case STORE_KEYS.manualSales: setManualSales(raw ? JSON.parse(raw) : {}); break;
      case STORE_KEYS.convoyages: setConvoyages(raw ? JSON.parse(raw) : []); break;
      case STORE_KEYS.challengeEntries: setChallengeEntries(raw ? JSON.parse(raw) : []); break;
      case STORE_KEYS.vehicleComments: setVehicleComments(raw ? JSON.parse(raw) : []); break;
      default: break;
    }
  }
  const lastMetaRef = useRef(null);
  const refreshAll = useCallback(async (indicate) => {
    if (indicate) setSyncing(true);
    const versionBefore = localWriteVersionRef.current;
    const allKeys = Object.values(STORE_KEYS);
    const meta = await sGetTableMeta();

    const applyKey = (key, raw) => {
      if (PROTECTED_KEYS.has(key)) {
        // Skip overwriting locally-edited stores if a save happened while this fetch was in flight —
        // the fetch may have captured data from just before that save committed. The next poll
        // will pick up the now-committed version.
        if (versionBefore === localWriteVersionRef.current) applyStoreValue(key, raw);
      } else {
        applyStoreValue(key, raw);
      }
    };

    if (!meta) {
      // Meta check unavailable (e.g. transient error) — fall back to fetching everything,
      // exactly as before, so a hiccup here never breaks syncing.
      const values = await Promise.all(allKeys.map((k) => sGet(k, true)));
      allKeys.forEach((key, i) => applyKey(key, values[i]));
      setLastSync(new Date());
      if (indicate) setSyncing(false);
      return;
    }

    const changedKeys = allKeys.filter((key) => meta[key] && lastMetaRef.current?.[key] !== meta[key]);
    lastMetaRef.current = meta;
    if (changedKeys.length > 0) {
      const values = await Promise.all(changedKeys.map((k) => sGet(k, true)));
      changedKeys.forEach((key, i) => applyKey(key, values[i]));
    }
    setLastSync(new Date());
    if (indicate) setSyncing(false);
  }, [PROTECTED_KEYS]);

  // A save was refused because a colleague changed the same data first (see sSet / sPatch):
  // tell the user and reload the latest values instead of silently overwriting them.
  useEffect(() => {
    let last = 0;
    const onConflict = () => {
      if (Date.now() - last < 4000) return;
      last = Date.now();
      showToast("Un collègue vient de modifier les mêmes données — elles ont été rechargées, refaites votre modification", { type: "error" });
      refreshAll(false);
    };
    window.addEventListener("parclive:conflict", onConflict);
    return () => window.removeEventListener("parclive:conflict", onConflict);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshAll]);

  const dataLoadedRef = useRef(false);
  async function loadInitialData() {
    const [o, s, ov, meta] = await Promise.all([
      sGet(STORE_KEYS.orders, true),
      sGet(STORE_KEYS.stock, true),
      sGet(STORE_KEYS.overlays, true),
      sGet(STORE_KEYS.meta, true),
    ]);
    if (o) setOrdersData(JSON.parse(o));
    if (s) setStockData(JSON.parse(s));
    setOverlays(ov ? JSON.parse(ov) : {});
    if (meta) setImportMeta(JSON.parse(meta));
    setLastSync(new Date());
    setLoading(false);
    dataLoadedRef.current = true;

    Promise.all([
      sGet(STORE_KEYS.accidents, true),
      sGet(STORE_KEYS.dossiers, true),
      sGet(STORE_KEYS.dossiersMeta, true),
      sGet(STORE_KEYS.manualSales, true),
      sGet(STORE_KEYS.sites, true),
      sGet(STORE_KEYS.alertSettings, true),
      sGet(STORE_KEYS.activityLog, true),
      sGet(STORE_KEYS.convoyages, true),
      sGet(STORE_KEYS.challengeConfig, true),
      sGet(STORE_KEYS.challengeEntries, true),
      sGet(STORE_KEYS.vehicleComments, true),
      sGet(STORE_KEYS.documentsConfig, true),
    ]).then(([acc2, doss, dossMeta, manual, sites, alertCfg, log, conv, chalCfg, chalEntries, comments, docCfg]) => {
      setAccidents(acc2 ? JSON.parse(acc2) : []);
      setDossiersData(doss ? JSON.parse(doss) : []);
      if (dossMeta) setDossiersMeta(JSON.parse(dossMeta));
      setManualSales(manual ? JSON.parse(manual) : {});
      if (sites) setSitesList(JSON.parse(sites));
      if (alertCfg) setAlertSettings({ ...DEFAULT_ALERT_SETTINGS, ...JSON.parse(alertCfg) });
      if (log) setActivityLog(JSON.parse(log));
      if (conv) setConvoyages(JSON.parse(conv));
      if (chalCfg) setChallengeConfig({ ...DEFAULT_CHALLENGE_CONFIG, ...JSON.parse(chalCfg) });
      if (chalEntries) setChallengeEntries(JSON.parse(chalEntries));
      if (comments) setVehicleComments(JSON.parse(comments));
      if (docCfg) setDocumentsConfig({ ...DEFAULT_DOCUMENTS_CONFIG, ...JSON.parse(docCfg) });
    });
  }

  useEffect(() => {
    (async () => {
      const t = await sGet(STORE_KEYS.theme, false);
      if (t) setDark(t === "dark");
      sGet(STORE_KEYS.vendeurs, true).then((v) => v && setVendeursList(JSON.parse(v).map(normalizeVendeur)));

      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user?.email) {
        setAuthEmail(session.user.email);
        setAuthUserId(session.user.id);
        setUnlocked(true);
        await loadInitialData();
      } else {
        setLoading(false);
      }
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY") {
        setPasswordRecovery(true);
      } else if (event === "SIGNED_OUT") {
        setUnlocked(false);
        setAuthEmail("");
        setAuthUserId("");
        dataLoadedRef.current = false;
      } else if (session?.user?.email) {
        setAuthEmail(session.user.email);
        setAuthUserId(session.user.id);
        setUnlocked(true);
        if (!dataLoadedRef.current) {
          // A fresh login happening after mount (not caught by the getSession() check above) —
          // load the data now instead of waiting up to 8s for the next background poll, which
          // would otherwise show the import screen briefly since ordersData is still empty.
          setLoading(true);
          loadInitialData();
        }
      }
    });
    return () => sub.subscription.unsubscribe();
  }, [refreshAll]);

  useEffect(() => {
    if (!unlocked) return;
    const id = setInterval(() => refreshAll(true), 8000);
    return () => clearInterval(id);
  }, [refreshAll, unlocked]);

  useEffect(() => {
    (async () => {
      try {
        const { error } = await supabase.from(TABLE).select("key").limit(1);
        setDbStatus(error ? "error" : "ok");
      } catch (e) {
        setDbStatus("error");
      }
    })();
  }, []);

  async function handleLogout() {
    await supabase.auth.signOut();
    setUnlocked(false);
    setAuthEmail("");
  }

  useEffect(() => { sSet(STORE_KEYS.theme, dark ? "dark" : "light", false); }, [dark]);

  useEffect(() => {
    if (!resetConfirm) return;
    const id = setTimeout(() => setResetConfirm(false), 4000);
    return () => clearTimeout(id);
  }, [resetConfirm]);

  async function handleImport({ ordersRows, stockRows, ordersFileName, stockFileName }) {
    const orders = ordersRows.map(toOrderRecord).filter((o) => o.orderNumber);
    const stock = stockRows.map(toStockRecord).filter((s) => s.orderNumber);
    const meta = { importedAt: new Date().toISOString(), ordersCount: orders.length, stockCount: stock.length, ordersFileName, stockFileName };
    const results = await Promise.all([
      sSet(STORE_KEYS.orders, JSON.stringify(orders), true, { force: true }),
      sSet(STORE_KEYS.stock, JSON.stringify(stock), true, { force: true }),
      sSet(STORE_KEYS.meta, JSON.stringify(meta), true, { force: true }),
    ]);
    const ok = results.every(Boolean);
    if (ok) {
      setOrdersData(orders);
      setStockData(stock);
      setImportMeta(meta);
      setImportOpen(false);
      showToast(`Import réussi — ${orders.length} commandes, ${stock.length} en stock`);
      logActivity(`Import véhicules — ${orders.length} commandes, ${stock.length} en stock`);
    }
    return ok;
  }

  async function handleUpdateVehicleSite(orderNumber, site) {
    const { ok, next } = await sPatch(STORE_KEYS.overlays, (fresh) => {
      const current = fresh[orderNumber] || {};
      return { ...fresh, [orderNumber]: { ...current, siteLocation: site } };
    }, {});
    if (next) setOverlays(next);
    localWriteVersionRef.current++;
    if (ok) showToast(site ? `Site rattaché : ${site}` : "Site retiré");
    else showToast("Échec de l'enregistrement — vérifiez la connexion à la base de données", { type: "error" });
  }

  async function handleCreateConvoyage({ orderNumber, siteDepart, siteArrivee, dateSouhaitee, commentaire }) {
    const freshRaw = await sGet(STORE_KEYS.convoyages, true);
    const fresh = freshRaw ? JSON.parse(freshRaw) : [];
    const entry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      orderNumber,
      siteDepart,
      siteArrivee,
      dateSouhaitee,
      commentaire,
      statut: "Demandé",
      demandePar: vendorName,
      demandeLe: new Date().toLocaleDateString("fr-FR"),
    };
    const next = [entry, ...fresh];
    const ok = await sSet(STORE_KEYS.convoyages, JSON.stringify(next), true);
    setConvoyages(next);
    localWriteVersionRef.current++;
    // Recording the departure site also confirms/corrects the vehicle's current known location.
    await handleUpdateVehicleSite(orderNumber, siteDepart);
    if (ok) {
      showToast(`Convoyage demandé : ${siteDepart} → ${siteArrivee}`);
      logActivity(`Convoyage demandé — commande ${orderNumber} (${siteDepart} → ${siteArrivee})`);
      const recipients = openConvoyageMailDraft({ orderNumber, siteDepart, siteArrivee, dateSouhaitee, commentaire, demandePar: vendorName, vehicles, vendeursList });
      if (recipients.length === 0) showToast("Aucun destinataire trouvé — vérifiez que les emails sont renseignés dans Réglages", { type: "error" });
    }
    else showToast("Échec de l'enregistrement — vérifiez la connexion à la base de données", { type: "error" });
  }

  async function handleUpdateConvoyageStatut(id, statut) {
    const freshRaw = await sGet(STORE_KEYS.convoyages, true);
    const fresh = freshRaw ? JSON.parse(freshRaw) : [];
    const entry = fresh.find((c) => c.id === id);
    const next = fresh.map((c) => (c.id === id ? { ...c, statut } : c));
    const ok = await sSet(STORE_KEYS.convoyages, JSON.stringify(next), true);
    setConvoyages(next);
    localWriteVersionRef.current++;
    if (statut === "Fait" && entry) await handleUpdateVehicleSite(entry.orderNumber, entry.siteArrivee);
    if (ok) {
      if (statut === "Fait") showToast(`✅ Convoyage terminé — arrivé à ${entry?.siteArrivee || ""}`, { type: "celebrate" });
      else showToast(`Convoyage : ${statut}`);
      if (entry) logActivity(`Convoyage "${statut}" — commande ${entry.orderNumber}`);
    }
    else showToast("Échec de l'enregistrement — vérifiez la connexion à la base de données", { type: "error" });
  }

  async function handleDeleteConvoyage(id) {
    const freshRaw = await sGet(STORE_KEYS.convoyages, true);
    const fresh = freshRaw ? JSON.parse(freshRaw) : [];
    const next = fresh.filter((c) => c.id !== id);
    const ok = await sSet(STORE_KEYS.convoyages, JSON.stringify(next), true);
    setConvoyages(next);
    localWriteVersionRef.current++;
    if (ok) showToast("Convoyage retiré");
    else showToast("Échec de l'enregistrement — vérifiez la connexion à la base de données", { type: "error" });
  }

  async function handleReservationSave(orderNumber, form) {
    const now = new Date();
    let old = {};
    const { ok: saved, next } = await sPatch(STORE_KEYS.overlays, (freshOverlays) => {
      const current = freshOverlays[orderNumber] || { reservation: null, history: [] };
      old = current.reservation || {};
      const history = [...(current.history || [])];
      [
        ["vendeur", "Vendeur"],
        ["client", "Client"],
        ["statut", "Statut"],
        ["dateDebut", "Date début"],
        ["dateFin", "Date fin"],
        ["commentaire", "Commentaire"],
      ].forEach(([key, label]) => {
        const oldVal = old[key] || "—";
        const newVal = form[key] || "—";
        if (oldVal !== newVal) {
          history.unshift({
            utilisateur: vendorName || "Vendeur",
            date: now.toLocaleDateString("fr-FR"),
            heure: now.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }),
            champ: label,
            ancienne: oldVal,
            nouvelle: newVal,
          });
        }
      });
      return { ...freshOverlays, [orderNumber]: { ...current, reservation: form, history } };
    }, {});
    if (next) setOverlays(next);
    localWriteVersionRef.current++;
    if (!saved) { showToast("Échec de l'enregistrement de la réservation — rechargez la page et réessayez", { type: "error" }); return; }
    if (form.statut === "Réservation annulée") logActivity(`Annulation réservation — commande ${orderNumber}`);
    else if (!old.statut) {
      logActivity(`Nouvelle réservation — commande ${orderNumber} pour ${form.client || "client inconnu"}`);
      showToast(`🎉 Véhicule réservé pour ${form.client || "le client"}`, { type: "celebrate" });
    }
  }


  async function handleImportDossiers({ rows, fileName }) {
    const dossiers = rows.map(toDossierRecord).filter((d) => d.numero || d.numeroUsine || d.vendeur);
    const meta = { importedAt: new Date().toISOString(), count: dossiers.length, fileName };
    const results = await Promise.all([
      sSet(STORE_KEYS.dossiers, JSON.stringify(dossiers), true, { force: true }),
      sSet(STORE_KEYS.dossiersMeta, JSON.stringify(meta), true, { force: true }),
    ]);
    const ok = results.every(Boolean);
    if (ok) {
      setDossiersData(dossiers);
      setDossiersMeta(meta);
      showToast(`Import réussi — ${dossiers.length} dossiers`);
      logActivity(`Import dossiers MyAna — ${dossiers.length} dossiers`);

      const foundNames = [...new Set(dossiers.map((d) => d.vendeur).filter(Boolean))];
      let newOnes = [];
      const vr = await sPatch(STORE_KEYS.vendeurs, (fresh) => {
        const freshVendeurs = fresh.map(normalizeVendeur);
        const lowerExisting = new Set(freshVendeurs.map((v) => v.nom.toLowerCase()));
        const newNames = foundNames.filter((n) => !lowerExisting.has(n.toLowerCase()));
        if (newNames.length === 0) return undefined;
        newOnes = newNames.map((n) => {
          const localisation = dossiers.find((d) => d.vendeur === n)?.localisation || "";
          const matchedSite = sitesList.find((s) => localisation && s.toLowerCase().includes(localisation.toLowerCase()));
          return { nom: n, site: matchedSite || "" };
        });
        return [...freshVendeurs, ...newOnes];
      }, []);
      if (vr.next && newOnes.length > 0) {
        setVendeursList(vr.next);
        showToast(`${newOnes.length} nouveau${newOnes.length > 1 ? "x" : ""} vendeur${newOnes.length > 1 ? "s" : ""} ajouté${newOnes.length > 1 ? "s" : ""} depuis l'import`);
      }
    }
    return ok;
  }

  const pendingAccidentDeleteRef = useRef(null);
  const pendingVendeurDeleteRef = useRef(null);

  async function patchVendeursList(updater) {
    const { ok, next } = await sPatch(STORE_KEYS.vendeurs, (fresh) => updater(fresh.map(normalizeVendeur)), []);
    if (next) setVendeursList(next);
    localWriteVersionRef.current++;
    return ok;
  }

  async function handleAddVendeur(name, site) {
    let dup = false;
    const ok = await patchVendeursList((fresh) => {
      if (fresh.some((v) => v.nom.toLowerCase() === name.toLowerCase())) { dup = true; return undefined; }
      return [...fresh, { nom: name, site: site || "" }];
    });
    if (dup) {
      showToast(`${name} est déjà dans la liste`, { type: "error" });
      return;
    }
    if (ok) showToast(`${name} ajouté à la liste des vendeurs`);
    else showToast("Échec de l'enregistrement — vérifiez la connexion à la base de données", { type: "error" });
  }

  async function handleUpdateVendeurSite(name, site) {
    const ok = await patchVendeursList((fresh) => fresh.map((v) => (v.nom === name ? { ...v, site } : v)));
    if (ok) showToast(site ? `${name} rattaché à ${site}` : `Site retiré pour ${name}`);
    else showToast("Échec de l'enregistrement — vérifiez la connexion à la base de données", { type: "error" });
  }

  async function handleUpdateVendeurEmail(name, email) {
    const clean = email.trim().toLowerCase();
    const ok = await patchVendeursList((fresh) => fresh.map((v) => (v.nom === name ? { ...v, email: clean } : v)));
    if (ok) showToast(clean ? `Email relié pour ${name}` : `Email retiré pour ${name}`);
    else showToast("Échec de l'enregistrement — vérifiez la connexion à la base de données", { type: "error" });
  }

  async function handleUpdateVendeurRole(name, role) {
    const ok = await patchVendeursList((fresh) => fresh.map((v) => (v.nom === name ? { ...v, role } : v)));
    if (ok) { showToast(`Rôle de ${name} : ${role}`); logActivity(`Rôle de ${name} changé en ${role}`); }
    else showToast("Échec de l'enregistrement — vérifiez la connexion à la base de données", { type: "error" });
  }

  async function handleUpdateVendeurPermission(name, key, value) {
    const ok = await patchVendeursList((fresh) =>
      fresh.map((v) => {
        if (v.nom !== name) return v;
        const overrides = { ...(v.permOverrides || {}) };
        if (value === null) delete overrides[key];
        else overrides[key] = value;
        return { ...v, permOverrides: overrides };
      })
    );
    if (ok) showToast(value === null ? `Permission "${PERMISSION_LABELS[key]}" remise au réglage du rôle` : `Permission "${PERMISSION_LABELS[key]}" mise à jour pour ${name}`);
    else showToast("Échec de l'enregistrement — vérifiez la connexion à la base de données", { type: "error" });
  }

  async function logActivity(action) {
    const entry = {
      date: new Date().toLocaleDateString("fr-FR"),
      heure: new Date().toLocaleTimeString("fr-FR"),
      utilisateur: vendorName || "—",
      action,
    };
    const { next } = await sPatch(STORE_KEYS.activityLog, (fresh) => [entry, ...fresh].slice(0, 200), []);
    if (next) setActivityLog(next);
    localWriteVersionRef.current++;
  }

  async function handleUpdateSites(newList) {
    const ok = await sSet(STORE_KEYS.sites, JSON.stringify(newList), true);
    setSitesList(newList);
    localWriteVersionRef.current++;
    if (ok) showToast("Liste des sites mise à jour");
    else showToast("Échec de l'enregistrement — vérifiez la connexion à la base de données", { type: "error" });
  }

  async function handleUpdateAlertSettings(newSettings) {
    const merged = { ...DEFAULT_ALERT_SETTINGS, ...newSettings };
    const ok = await sSet(STORE_KEYS.alertSettings, JSON.stringify(merged), true);
    setAlertSettings(merged);
    localWriteVersionRef.current++;
    if (ok) showToast("Seuils d'alerte enregistrés");
    else showToast("Échec de l'enregistrement — vérifiez la connexion à la base de données", { type: "error" });
  }

  async function handleUpdateChallengeConfig(newConfig) {
    const merged = { ...DEFAULT_CHALLENGE_CONFIG, ...newConfig };
    const ok = await sSet(STORE_KEYS.challengeConfig, JSON.stringify(merged), true);
    setChallengeConfig(merged);
    localWriteVersionRef.current++;
    if (ok) { showToast("Challenge enregistré"); logActivity(`Challenge mis à jour — ${merged.montantParVehicule}€/véhicule, ${merged.dateDebut || "?"} → ${merged.dateFin || "?"}, ${merged.actif ? "actif" : "inactif"}`); }
    else showToast("Échec de l'enregistrement — vérifiez la connexion à la base de données", { type: "error" });
  }

  async function handleUpdateDocumentsConfig(newConfig) {
    const merged = { ...DEFAULT_DOCUMENTS_CONFIG, ...newConfig };
    const ok = await sSet(STORE_KEYS.documentsConfig, JSON.stringify(merged), true);
    setDocumentsConfig(merged);
    localWriteVersionRef.current++;
    if (ok) { showToast("Dossier Documents mis à jour"); logActivity("Dossier Documents (Google Drive) reconfiguré"); }
    else showToast("Échec de l'enregistrement — vérifiez la connexion à la base de données", { type: "error" });
  }

  async function handleResetChallengeEntries() {
    const ok = await sSet(STORE_KEYS.challengeEntries, JSON.stringify([]), true);
    setChallengeEntries([]);
    localWriteVersionRef.current++;
    if (ok) { showToast("Compteurs du challenge réinitialisés"); logActivity("Challenge : compteurs réinitialisés"); }
    else showToast("Échec de l'enregistrement — vérifiez la connexion à la base de données", { type: "error" });
  }

  async function handleAddVehicleComment(orderNumber, categorie, texte) {
    const now = new Date();
    const entry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      orderNumber,
      categorie,
      texte,
      auteur: vendorName,
      date: now.toLocaleDateString("fr-FR"),
      heure: now.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }),
    };
    const { ok, next } = await sPatch(STORE_KEYS.vehicleComments, (fresh) => [entry, ...fresh], []);
    if (next) setVehicleComments(next);
    localWriteVersionRef.current++;
    if (ok) showToast("Commentaire ajouté");
    else showToast("Échec de l'enregistrement — vérifiez la connexion à la base de données", { type: "error" });
  }

  async function handleDeleteVehicleComment(id) {
    const { ok, next } = await sPatch(STORE_KEYS.vehicleComments, (fresh) => fresh.filter((c) => c.id !== id), []);
    if (next) setVehicleComments(next);
    localWriteVersionRef.current++;
    if (ok) showToast("Commentaire supprimé");
    else showToast("Échec de l'enregistrement — vérifiez la connexion à la base de données", { type: "error" });
  }

  async function detectNewChallengeEntries(candidates) {
    if (candidates.length === 0) return;
    const freshRaw = await sGet(STORE_KEYS.challengeEntries, true);
    const fresh = freshRaw ? JSON.parse(freshRaw) : [];
    const already = new Set(fresh.map((e) => e.orderNumber));
    const additions = candidates
      .filter((v) => !already.has(v.orderNumber))
      .map((v) => ({
        id: `${Date.now()}-${v.orderNumber}`,
        orderNumber: v.orderNumber,
        vendeur: v.venduPar,
        montant: challengeConfig.montantParVehicule,
        date: new Date().toLocaleDateString("fr-FR"),
      }));
    if (additions.length === 0) return;
    const next = [...fresh, ...additions];
    const ok = await sSet(STORE_KEYS.challengeEntries, JSON.stringify(next), true);
    setChallengeEntries(next);
    localWriteVersionRef.current++;
    if (ok) {
      additions.forEach((a) => logActivity(`Challenge : ${a.vendeur} débloque ${a.montant}€ — commande ${a.orderNumber}`));
      const mine = additions.filter((a) => a.vendeur === vendorName);
      if (mine.length > 0) {
        const total = mine.reduce((n, a) => n + a.montant, 0);
        showToast(`🏆 Bravo ! Vous débloquez ${total}€ sur le Challenge stock ancien`, { type: "celebrate" });
      }
    }
  }

  async function handleRenameVendeur(oldName, newName) {
    const clean = newName.trim();
    if (!clean || clean === oldName) return;
    let dup = false;
    const { ok: okV, next: nextVendeurs } = await sPatch(STORE_KEYS.vendeurs, (fresh) => {
      const freshVendeurs = fresh.map(normalizeVendeur);
      if (freshVendeurs.some((v) => v.nom.toLowerCase() === clean.toLowerCase())) { dup = true; return undefined; }
      return freshVendeurs.map((v) => (v.nom === oldName ? { ...v, nom: clean } : v));
    }, []);
    if (dup) {
      showToast(`${clean} existe déjà dans la liste`, { type: "error" });
      return;
    }
    if (nextVendeurs) setVendeursList(nextVendeurs);

    const { next: nextOverlays } = await sPatch(STORE_KEYS.overlays, (freshOverlays) => {
      const out = {};
      Object.entries(freshOverlays).forEach(([orderNumber, ov]) => {
        const nov = { ...ov };
        if (nov.reservation?.vendeur === oldName) nov.reservation = { ...nov.reservation, vendeur: clean };
        out[orderNumber] = nov;
      });
      return out;
    }, {});
    if (nextOverlays) setOverlays(nextOverlays);

    const { next: nextManual } = await sPatch(STORE_KEYS.manualSales, (freshManual) => {
      const out = {};
      Object.entries(freshManual).forEach(([orderNumber, ms]) => {
        const m = typeof ms === "string" ? { vendeur: ms, client: "" } : ms;
        out[orderNumber] = m.vendeur === oldName ? { ...m, vendeur: clean } : m;
      });
      return out;
    }, {});
    if (nextManual) setManualSales(nextManual);

    localWriteVersionRef.current++;
    if (okV) showToast(`${oldName} renommé en ${clean}`);
    else showToast("Échec de l'enregistrement — vérifiez la connexion à la base de données", { type: "error" });
  }

  async function handleAssignManualSale(orderNumber, patch) {
    const key = normalizeOrderNum(orderNumber);
    let merged = {};
    const { ok, next } = await sPatch(STORE_KEYS.manualSales, (fresh) => {
      const out = { ...fresh };
      const existing = fresh[key];
      const existingObj = typeof existing === "string" ? { vendeur: existing, client: "" } : existing || { vendeur: "", client: "" };
      merged = { ...existingObj, ...patch };
      if (merged.vendeur || merged.client) out[key] = merged;
      else delete out[key];
      return out;
    }, {});
    if (next) setManualSales(next);
    localWriteVersionRef.current++;
    if (ok) showToast(merged.vendeur || merged.client ? `Commande ${orderNumber} mise à jour` : `Attribution retirée pour ${orderNumber}`);
    else showToast("Échec de l'enregistrement — vérifiez la connexion à la base de données", { type: "error" });
  }

  async function commitVendeurDelete(name) {
    await sPatch(STORE_KEYS.vendeurs, (fresh) => fresh.map(normalizeVendeur).filter((v) => v.nom !== name), []);
  }

  function handleRemoveVendeur(name) {
    const removed = vendeursList.find((v) => v.nom === name);
    if (pendingVendeurDeleteRef.current) {
      clearTimeout(pendingVendeurDeleteRef.current.timer);
      commitVendeurDelete(pendingVendeurDeleteRef.current.name);
    }
    setVendeursList((prev) => prev.filter((v) => v.nom !== name));
    localWriteVersionRef.current++;
    const timer = setTimeout(() => {
      commitVendeurDelete(name);
      pendingVendeurDeleteRef.current = null;
    }, 5000);
    pendingVendeurDeleteRef.current = { name, timer };
    showToast(`${name} retiré de la liste des vendeurs`, {
      action: {
        label: "Annuler",
        onClick: () => {
          clearTimeout(timer);
          pendingVendeurDeleteRef.current = null;
          setVendeursList((prev) => [...prev, removed || { nom: name, site: "" }]);
          localWriteVersionRef.current++;
        },
      },
    });
  }

  async function commitAccidentDelete(id) {
    await sPatch(STORE_KEYS.accidents, (fresh) => fresh.filter((a) => a.id !== id), []);
  }

  async function handleAddAccident({ orderNumber, note, addedBy }) {
    const now = new Date();
    const entry = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, orderNumber, note, addedBy, addedAt: now.toLocaleDateString("fr-FR") };
    const { ok, next } = await sPatch(STORE_KEYS.accidents, (fresh) => [entry, ...fresh], []);
    if (next) setAccidents(next);
    localWriteVersionRef.current++;
    if (ok) { showToast(`Véhicule ${orderNumber} ajouté aux accidentés`); logActivity(`Véhicule accidenté ajouté — commande ${orderNumber}`); }
    else showToast("Échec de l'enregistrement — vérifiez la connexion à la base de données", { type: "error" });
  }

  async function handleRemoveAccident(id) {
    const removed = accidents.find((a) => a.id === id);
    if (!removed) return;
    if (pendingAccidentDeleteRef.current) {
      clearTimeout(pendingAccidentDeleteRef.current.timer);
      commitAccidentDelete(pendingAccidentDeleteRef.current.id);
    }
    setAccidents((prev) => prev.filter((a) => a.id !== id));
    localWriteVersionRef.current++;
    const timer = setTimeout(() => {
      commitAccidentDelete(id);
      pendingAccidentDeleteRef.current = null;
    }, 5000);
    pendingAccidentDeleteRef.current = { id, timer };
    showToast(`Véhicule ${removed.orderNumber} retiré des accidentés`, {
      action: {
        label: "Annuler",
        onClick: () => {
          clearTimeout(timer);
          pendingAccidentDeleteRef.current = null;
          setAccidents((prev) => [removed, ...prev]);
          localWriteVersionRef.current++;
        },
      },
    });
  }

  async function handleRestoreVersion(key, row, label, when) {
    try {
      const { data, error } = await supabase.from("parclive_data_history").select("value").eq("id", row.id).maybeSingle();
      if (error || !data) { showToast("Version introuvable", { type: "error" }); return false; }
      const ok = await sSet(key, JSON.stringify(data.value), true, { force: true });
      if (!ok) { showToast("Échec de la restauration — réessayez", { type: "error" }); return false; }
      localWriteVersionRef.current++;
      showToast(`Version restaurée — ${label}`);
      logActivity(`Restauration d'une version — ${label} (état avant le ${when})`);
      refreshAll(true);
      return true;
    } catch (e) {
      console.error("restore failed", e);
      showToast("Échec de la restauration — réessayez", { type: "error" });
      return false;
    }
  }

  async function handleReset() {
    await Promise.all([
      sSet(STORE_KEYS.orders, JSON.stringify([]), true, { force: true }),
      sSet(STORE_KEYS.stock, JSON.stringify([]), true, { force: true }),
      sSet(STORE_KEYS.overlays, JSON.stringify({}), true, { force: true }),
      sSet(STORE_KEYS.meta, JSON.stringify(null), true, { force: true }),
    ]);
    setOrdersData([]);
    setStockData([]);
    setOverlays({});
    setImportMeta(null);
    setResetConfirm(false);
  }

  const vehicles = useMemo(() => {
    const stockByOrder = new Map(stockData.map((s) => [s.orderNumber, s]));
    const dossierByOrder = new Map();
    dossiersData.forEach((d) => {
      if ((d.categorie || "").toUpperCase().trim() === "VD") return;
      const key = normalizeOrderNum(d.numeroUsine);
      if (key && !dossierByOrder.has(key)) dossierByOrder.set(key, d);
    });
    const accidentedOrders = new Set(accidents.map((a) => normalizeOrderNum(a.orderNumber)));
    const commentsByOrder = new Map();
    vehicleComments.forEach((c) => {
      const key = c.orderNumber;
      if (!commentsByOrder.has(key)) commentsByOrder.set(key, []);
      commentsByOrder.get(key).push(c);
    });
    return ordersData
      .map((o) =>
        buildVehicle(
          o,
          stockByOrder.get(o.orderNumber) || null,
          overlays[o.orderNumber] || null,
          dossierByOrder.get(normalizeOrderNum(o.orderNumber)) || null,
          accidentedOrders.has(normalizeOrderNum(o.orderNumber)),
          manualSales[normalizeOrderNum(o.orderNumber)] || null,
          alertSettings,
          commentsByOrder.get(o.orderNumber) || []
        )
      )
      .filter((v) => v.baseStatus !== "livre_client");
  }, [ordersData, stockData, overlays, dossiersData, accidents, manualSales, alertSettings, vehicleComments]);

  const dossiers = useMemo(() => {
    const vehicleByOrder = new Map(vehicles.map((v) => [normalizeOrderNum(v.orderNumber), v]));
    const filteredDossiers = dossiersData.filter((d) => (d.categorie || "").toUpperCase().trim() !== "VD");
    // Most dossiers match a vehicle already in `vehicles`. The rare exception is an order filtered
    // out there (e.g. already delivered to the client) — only rebuild those specific orders, not all of them.
    const missingKeys = new Set(
      filteredDossiers.map((d) => normalizeOrderNum(d.numeroUsine)).filter((key) => key && !vehicleByOrder.has(key))
    );
    let fallbackByOrder = new Map();
    if (missingKeys.size > 0) {
      const stockByOrder = new Map(stockData.map((s) => [s.orderNumber, s]));
      fallbackByOrder = new Map(
        ordersData
          .filter((o) => missingKeys.has(normalizeOrderNum(o.orderNumber)))
          .map((o) => [normalizeOrderNum(o.orderNumber), buildVehicle(o, stockByOrder.get(o.orderNumber) || null, overlays[o.orderNumber] || null)])
      );
    }
    return filteredDossiers.map((d) => {
      const key = normalizeOrderNum(d.numeroUsine);
      return { ...d, vehicle: vehicleByOrder.get(key) || fallbackByOrder.get(key) || null };
    });
  }, [dossiersData, vehicles, ordersData, stockData, overlays]);

  const expandedOrder = selected?.orderNumber ?? null;
  function toggleExpand(v) {
    setSelected((prev) => (prev && prev.orderNumber === v.orderNumber ? null : v));
  }
  function openInVehicules(v) {
    setTab("vehicules");
    setSelected(v);
  }
  function goToVehicles(patch) {
    setTab("vehicules");
    setFilters((f) => ({ ...f, modele: "all", site: "all", typeVente: [], vu: "all", statut: "all", vendeur: "all", carrosserie: "all", boite: "all", query: "", ...patch }));
  }

  const stats = useMemo(() => computeStats(vehicles), [vehicles]);

  const typeVentes = useMemo(() => [...new Set(vehicles.map((v) => v.typeVente))].filter(Boolean).sort(), [vehicles]);
  const vendeurs = useMemo(() => [...new Set(vehicles.map((v) => activeReservationVendeur(v)).filter(Boolean))].sort(), [vehicles]);
  const models = useMemo(() => [...new Set(vehicles.map((v) => v.model))].filter(Boolean).sort(), [vehicles]);

  const filtered = useMemo(() => {
    const terms = filters.query.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean);
    const siteByVendeur = new Map(vendeursList.map((v) => [v.nom, v.site]));
    let list = vehicles.filter((v) => {
      if (filters.site !== "all" && vehicleEffectiveSite(v, siteByVendeur) !== filters.site) return false;
      if (filters.typeVente.length > 0 && !filters.typeVente.includes(v.typeVente)) return false;
      if (filters.vu === "vp" && v.vu) return false;
      if (filters.vu === "vu" && !v.vu) return false;
      if (filters.statut !== "all" && v.baseStatus !== filters.statut) return false;
      if (filters.vendeur !== "all" && activeReservationVendeur(v) !== filters.vendeur) return false;
      if (filters.modele && filters.modele !== "all" && v.model !== filters.modele) return false;
      if (filters.carrosserie && filters.carrosserie !== "all" && v.bodyCode !== filters.carrosserie) return false;
      if (filters.boite && filters.boite !== "all" && v.transmission !== filters.boite) return false;
      if (terms.length > 0) {
        const hay = `${v.orderNumber} ${v.vin} ${v.description} ${v.model} ${v.concession} ${activeReservationVendeur(v)} ${v.venduPar || ""} ${v.clientLabel || ""}`.toLowerCase();
        if (!terms.some((t) => hay.includes(t))) return false;
      }
      return true;
    });
    if (sortBy === "order") list = [...list].sort((a, b) => a.orderNumber.localeCompare(b.orderNumber));
    else if (sortBy === "model") list = [...list].sort((a, b) => a.model.localeCompare(b.model));
    else {
      const desc = sortBy === "stock_desc";
      list = [...list].sort((a, b) => {
        const aIn = a.joursStock != null;
        const bIn = b.joursStock != null;
        if (aIn && bIn) return desc ? b.joursStock - a.joursStock : a.joursStock - b.joursStock;
        if (aIn !== bIn) return aIn ? -1 : 1; // véhicules déjà en stock d'abord
        // ni l'un ni l'autre en stock : trier par date d'arrivée estimée, la plus proche d'abord
        const aDate = a.estRange?.end ? a.estRange.end.getTime() : Infinity;
        const bDate = b.estRange?.end ? b.estRange.end.getTime() : Infinity;
        return aDate - bDate;
      });
    }
    // HS vehicles always go last, whatever the chosen sort — they're not sellable stock.
    list = [...list.filter((v) => v.baseStatus !== "hs"), ...list.filter((v) => v.baseStatus === "hs")];
    return list;
  }, [vehicles, filters, sortBy, vendeursList]);

  const totalAlerts = useMemo(
    () => vehicles.reduce((n, v) => n + v.alerts.filter((a) => a.type === "resa_expiree" || a.type === "resa_bientot").length, 0),
    [vehicles]
  );
  const vendorName = useMemo(() => {
    const e = (authEmail || "").toLowerCase();
    if (!e) return "";
    if (e.includes("steven.beaumont")) return "BEAUMONT Steven";
    const match = vendeursList.find((v) => (v.email || "").toLowerCase() === e);
    return match ? match.nom : "";
  }, [authEmail, vendeursList]);

  useEffect(() => {
    if (!authEmail || vendeursList.length === 0) return;
    const e = authEmail.toLowerCase();
    const alreadyLinked = vendeursList.some((v) => (v.email || "").toLowerCase() === e);
    if (alreadyLinked) return;
    const localPart = e.split("@")[0];
    const parts = stripAccents(localPart).split(".").filter(Boolean);
    if (parts.length < 2) return;
    const match = vendeursList.find((v) => {
      const n = stripAccents(v.nom.toLowerCase());
      return parts.every((p) => n.includes(p)) && !v.email;
    });
    if (match) handleUpdateVendeurEmail(match.nom, authEmail);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authEmail, vendeursList]);

  const lastLoginRecordedRef = useRef(false);
  useEffect(() => {
    if (!vendorName || lastLoginRecordedRef.current) return;
    if (isSuperAdmin(vendorName)) return; // Steven doesn't need a vendeur record to function; skip if not present.
    const vd = findVendeur(vendeursList, vendorName);
    if (!vd) return;
    lastLoginRecordedRef.current = true;
    patchVendeursList((fresh) => fresh.map((v) => (v.nom === vendorName ? { ...v, lastLogin: new Date().toISOString() } : v)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vendorName, vendeursList]);

  const permissions = useMemo(() => getPermissions(vendorName, vendeursList), [vendorName, vendeursList]);
  const prospectionAccess = useProspectionAccess(authUserId);
  const canProspect = prospectionAccess.allowed;
  const marketingMe = useMarketingAccess(authUserId);
  const canMarketing = !!marketingMe;
  const rdvMe = useRdvAccess(authUserId);
  const rdvData = useRdv(rdvMe);
  const rdvOverdueCount = useMemo(() => { const n = new Date(); return rdvData.rows.filter((r) => rdvIsOverdue(r, n)).length; }, [rdvData.rows]);

  const mySiteScope = useMemo(() => {
    if (isSuperAdmin(vendorName)) return null;
    const n = (vendorName || "").toLowerCase();
    if (n.includes("audrey")) return null;
    const vd = findVendeur(vendeursList, vendorName);
    if (vd?.role === "Directeur de plaque") return null;
    return vd?.site || null;
  }, [vendorName, vendeursList]);

  const visibleVehicles = useMemo(() => {
    if (!mySiteScope) return vehicles;
    const siteByVendeur = new Map(vendeursList.map((v) => [v.nom, v.site]));
    return vehicles.filter((v) => {
      const site = vehicleEffectiveSite(v, siteByVendeur);
      return !site || site === mySiteScope;
    });
  }, [vehicles, vendeursList, mySiteScope]);

  const myRole = useMemo(() => findVendeur(vendeursList, vendorName)?.role || "Vendeur", [vendeursList, vendorName]);
  const logisticsVehicles = useMemo(() => {
    if (!mySiteScope) return visibleVehicles;
    if (myRole !== "Vendeur") return visibleVehicles;
    return visibleVehicles.filter((v) => v.venduPar === vendorName || activeReservationVendeur(v) === vendorName);
  }, [visibleVehicles, mySiteScope, myRole, vendorName]);

  const dashboardStats = useMemo(() => computeStats(visibleVehicles), [visibleVehicles]);

  useEffect(() => {
    if (!challengeConfig.actif) return;
    const today = new Date().toISOString().slice(0, 10);
    if (challengeConfig.dateDebut && today < challengeConfig.dateDebut) return;
    if (challengeConfig.dateFin && today > challengeConfig.dateFin) return;
    const seuil = alertSettings.challengeSeuilJours;
    const candidates = vehicles.filter((v) => v.baseStatus === "vendu" && v.venduPar && v.inStock && v.joursStock >= seuil);
    detectNewChallengeEntries(candidates);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehicles, challengeConfig, alertSettings.challengeSeuilJours]);
  useEffect(() => {
    if (tab === "vendeurs" || tab === "permissions") { setTab("vehicules"); return; }
    if (tab === "rdv" && rdvMe === null) { setTab("vehicules"); return; }
    const gated = { dossiers: permissions.dossiers, accidentes: permissions.accidentes, dashboard: permissions.dashboard };
    if (tab in gated && !gated[tab]) setTab("vehicules");
  }, [tab, permissions, rdvMe]);

  useEffect(() => {
    if (!unlocked || vehicles.length === 0) return;
    const todayKey = new Date().toISOString().slice(0, 10);
    let lastSnap = null;
    try { lastSnap = localStorage.getItem("dsr:last-snapshot-date"); } catch (e) {}
    if (lastSnap === todayKey) return;
    (async () => {
      try {
        const { error } = await supabase.from("parclive_snapshots").upsert({
          date: todayKey,
          stats: {
            total: stats.total,
            vp: stats.vp,
            vu: stats.vu,
            disponibles: stats.disponibles,
            reserves: stats.reserves,
            nonSerialises: stats.nonSerialises,
            avgJoursStock: stats.avgJoursStock,
            electriques: stats.electriques,
            hybridesRecharge: stats.hybridesRecharge,
          },
        });
        if (!error) { try { localStorage.setItem("dsr:last-snapshot-date", todayKey); } catch (e) {} }
      } catch (e) {
        console.error("snapshot save failed", e);
      }
    })();
  }, [unlocked, vehicles.length, stats.total, stats.avgJoursStock]);

  return (
    <div
      className={`min-h-screen w-full font-sans ${dark ? "bg-zinc-950 text-zinc-200" : "bg-stone-50 text-stone-800"}`}
      style={{
        backgroundImage: dark
          ? "radial-gradient(1100px circle at 85% -15%, rgba(59,130,246,0.09), transparent 55%)"
          : "radial-gradient(1100px circle at 85% -15%, rgba(37,99,235,0.05), transparent 55%)",
        backgroundRepeat: "no-repeat",
      }}
    >
      <style>{`
        @keyframes plFadeIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
        .pl-fade-in { animation: plFadeIn 0.28s cubic-bezier(0.16, 1, 0.3, 1); }
        @keyframes plPop { 0% { transform: scale(0.85); opacity: 0; } 60% { transform: scale(1.05); opacity: 1; } 100% { transform: scale(1); } }
        .pl-pop { animation: plPop 0.35s cubic-bezier(0.34, 1.56, 0.64, 1); }
        @keyframes plCelebrate { 0%, 100% { transform: scale(1) rotate(0deg); } 25% { transform: scale(1.15) rotate(-8deg); } 50% { transform: scale(1.1) rotate(6deg); } 75% { transform: scale(1.15) rotate(-4deg); } }
        .pl-celebrate { animation: plCelebrate 0.6s ease-in-out; }
        .pl-interactive { transition: transform 0.15s ease, box-shadow 0.15s ease; }
        .pl-interactive:hover { transform: none; }
        .pl-interactive:active { transform: scale(0.985); }
        .prospection-map-dark .leaflet-tile-pane { filter: invert(1) hue-rotate(180deg) brightness(0.95) contrast(0.9); }
        .leaflet-container { background: #ddd; }
        .leaflet-container img.leaflet-tile { max-width: none !important; max-height: none !important; width: 256px !important; height: 256px !important; }
        .leaflet-container img.leaflet-marker-icon, .leaflet-container img.leaflet-marker-shadow { max-width: none !important; }
        .prospection-label { background: #ffffff; color: #292524; border: 1px solid #e7e5e4; border-radius: 6px; padding: 1px 6px; font-size: 11px; font-weight: 600; box-shadow: 0 1px 3px rgba(0,0,0,0.25); white-space: nowrap; }
        .prospection-label::before { display: none; }
        .prospection-map-dark .prospection-label { background: #18181b; color: #f4f4f5; border-color: #3f3f46; }
      `}</style>
      <datalist id="vendeurs-datalist">
        {vendeursList.map((v) => (
          <option key={v.nom} value={v.nom} />
        ))}
      </datalist>
      {passwordRecovery ? (
        <SetNewPasswordScreen dark={dark} onDone={() => { setPasswordRecovery(false); showToast("Mot de passe mis à jour"); }} />
      ) : !unlocked ? (
        <LoginScreen dark={dark} onLogin={() => {}} />
      ) : !vendorName ? (
        <div className="flex min-h-[520px] items-center justify-center p-6">
          <div className={`w-full max-w-sm rounded-2xl border p-6 text-center shadow-sm ${dark ? "bg-zinc-900 border-zinc-800" : "bg-white border-stone-200"}`}>
            <div className="mb-4 flex justify-center">
              <span className={`flex h-12 w-12 items-center justify-center rounded-full ring-1 ${dark ? "bg-rose-500/10 text-rose-400 ring-rose-500/20" : "bg-rose-50 text-rose-700 ring-rose-200"}`}>
                <User size={20} />
              </span>
            </div>
            <div className={`font-display text-lg font-semibold ${dark ? "text-zinc-50" : "text-stone-900"}`}>Compte non relié</div>
            <p className={`mb-4 mt-1 text-sm ${dark ? "text-zinc-500" : "text-stone-400"}`}>
              Votre compte ({authEmail}) n'est relié à aucun profil vendeur. Demandez à un administrateur de renseigner votre email dans l'onglet Vendeurs.
            </p>
            <button onClick={handleLogout} className="pl-interactive w-full rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-blue-500">
              Se déconnecter
            </button>
          </div>
        </div>
      ) : (
        <>
      <TopBar
        dark={dark}
        setDark={setDark}
        vendorName={vendorName}
        onOpenPasswordModal={() => setShowPasswordModal(true)}
        onLogout={handleLogout}
        onImport={() => setImportOpen(true)}
        onRefresh={() => refreshAll(true)}
        lastSync={lastSync}
        alertCount={totalAlerts}
        onOpenAlerts={() => setAlertsOpen(true)}
        syncing={syncing}
        legendOpen={legendOpen}
        setLegendOpen={setLegendOpen}
        canImport={permissions.import}
        navAccess={{ prospect: canProspect, marketing: canMarketing, rdv: rdvMe?.role || "" }}
      />
      {dbStatus === "error" && (
        <div className={`flex items-center gap-2 px-4 py-2 text-xs font-semibold md:px-8 ${dark ? "bg-rose-500/15 text-rose-300" : "bg-rose-50 text-rose-700"}`}>
          <AlertTriangle size={13} /> Connexion à la base de données impossible — vérifiez que la table Supabase existe (voir README) et que la clé API est correcte. Rien ne sera sauvegardé tant que ce n'est pas résolu.
        </div>
      )}
      {showWelcome && vendorName && (
        <div className={`flex flex-wrap items-center gap-2 border-b px-4 py-2 text-xs font-medium md:px-8 ${dark ? "border-zinc-800 bg-zinc-900/50 text-zinc-400" : "border-stone-200/70 bg-stone-100/60 text-stone-600"}`}>
          <Info size={13} className="shrink-0" />
          <span>
            Bienvenue {vendorName} — vous êtes connecté avec le rôle <span className="font-semibold">{isSuperAdmin(vendorName) ? "Accès complet" : (findVendeur(vendeursList, vendorName)?.role || "Vendeur")}</span>.
            <span className="hidden sm:inline"> Certaines fonctionnalités sont réservées aux rôles de gestion.</span>
          </span>
          <button onClick={() => { setShowWelcome(false); saveLocal("dsr:welcome-seen", true); }} className="ml-auto shrink-0 underline-offset-2 hover:underline">
            Ne plus afficher
          </button>
        </div>
      )}

      {loading ? (
        <div className="flex h-[500px] items-center justify-center">
          <RefreshCw className={`animate-spin ${dark ? "text-zinc-600" : "text-stone-300"}`} size={24} />
        </div>
      ) : ordersData.length === 0 ? (
        <ImportGate dark={dark} onImport={handleImport} onImportDossiers={handleImportDossiers} />
      ) : (
        <div className="mx-auto w-full max-w-[1400px] px-4 pb-12 pt-6 md:px-8">
          <div className="mb-6 lg:hidden">
            <Tabs dark={dark} tab={tab} setTab={setTab} accidentCount={accidents.length} dossierUnmatchedCount={dossiers.filter((d) => !d.vehicle).length} permissions={permissions} vendorName={vendorName} canProspect={canProspect} canMarketing={canMarketing} rdvMe={rdvMe} rdvOverdueCount={rdvOverdueCount} />
          </div>
          <div className="flex items-start gap-8">
            <div className="hidden lg:block">
              <Sidebar
                dark={dark}
                tab={tab}
                setTab={setTab}
                accidentCount={accidents.length}
                dossierUnmatchedCount={dossiers.filter((d) => !d.vehicle).length}
                permissions={permissions}
                vendorName={vendorName}
                canProspect={canProspect}
                canMarketing={canMarketing}
                rdvMe={rdvMe}
                rdvOverdueCount={rdvOverdueCount}
              />
            </div>
            <div key={tab} className="pl-fade-in min-w-0 flex-1 space-y-6">
          {(() => {
            const meta = {
              vehicules: ["Véhicules", `${dashboardStats.total} véhicules · ${dashboardStats.disponibles} disponibles · ${dashboardStats.reserves} réservés`],
              logistique: ["Logistique", "Stock, véhicules en transit et non sérialisés"],
              dashboard: ["Tableau de bord", "Vue d'ensemble et tendances du parc"],
              dossiers: ["Dossiers", "Import MyAna et attribution des ventes"],
              accidentes: ["Accidentés", "Véhicules signalés hors service"],
              reglages: ["Réglages", "Vendeurs, sites, alertes et sauvegardes"],
              rdv: rdvMe ? (rdvMe.role === "admin" ? ["Rapports RDV", "Rendez-vous clients et suivi par vendeur"] : ["Mes rendez-vous", "Votre journée et votre suivi"]) : null,
            }[tab];
            return meta ? <PageHeader dark={dark} title={meta[0]} subtitle={meta[1]} /> : null;
          })()}

          {tab === "logistique" ? (
            <LogisticsTab dark={dark} vehicles={logisticsVehicles} vendeursList={mySiteScope ? vendeursList.filter((v) => v.site === mySiteScope) : vendeursList} sitesList={sitesList} onOpenVehicle={openInVehicules} simpleMode={myRole === "Vendeur" && !!mySiteScope} onSave={handleReservationSave} vendorName={vendorName} onUpdateVehicleSite={handleUpdateVehicleSite} onAddComment={handleAddVehicleComment} onDeleteComment={handleDeleteVehicleComment} />
          ) : tab === "convoyage" ? (
            <ConvoyageTab
              dark={dark}
              vehicles={vehicles}
              convoyages={convoyages}
              sitesList={sitesList}
              vendorName={vendorName}
              onCreateConvoyage={handleCreateConvoyage}
              onUpdateConvoyageStatut={handleUpdateConvoyageStatut}
              onDeleteConvoyage={handleDeleteConvoyage}
              onUpdateVehicleSite={handleUpdateVehicleSite}
              onOpenVehicle={openInVehicules}
            />
          ) : tab === "prospection" ? (
            canProspect ? (
              <ProspectionTab dark={dark} currentUserName={vendorName} readOnly={prospectionAccess.readOnly} showToast={showToast} />
            ) : null
          ) : tab === "rdv" ? (
            rdvMe ? (
              <RdvTab dark={dark} me={rdvMe} rdv={rdvData} vendeursList={vendeursList} vehicles={vehicles} showToast={showToast} />
            ) : null
          ) : tab === "marketing" ? (
            canMarketing ? (
              <MarketingTab dark={dark} me={marketingMe} showToast={showToast} />
            ) : null
          ) : tab === "challenge" ? (
            <ChallengeTab dark={dark} vehicles={vehicles} vendeursList={vendeursList} seuilJours={alertSettings.challengeSeuilJours} challengeConfig={challengeConfig} challengeEntries={challengeEntries} onOpenVehicle={openInVehicules} />
          ) : tab === "dashboard" ? (
            <div className="space-y-8">
              <DashboardSection dark={dark} icon={Info} title="Vue d'ensemble">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                  <KPICard dark={dark} label="Total" value={dashboardStats.total} onClick={() => goToVehicles({ statut: "all" })} />
                  <KPICard dark={dark} label="Disponibles" value={dashboardStats.disponibles} onClick={() => goToVehicles({ statut: "disponible" })} />
                  <KPICard dark={dark} label="Réservés" value={dashboardStats.reserves} onClick={() => goToVehicles({ statut: "reserve" })} />
                  <KPICard dark={dark} label="Vendus" value={dashboardStats.vendus} onClick={() => goToVehicles({ statut: "vendu" })} />
                  <KPICard dark={dark} label="HS" value={dashboardStats.hsCount} onClick={() => goToVehicles({ statut: "hs" })} />
                </div>
                <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4 lg:grid-cols-7">
                  <KPICard dark={dark} size="sm" label="VP" value={dashboardStats.vp} onClick={() => goToVehicles({ vu: "vp" })} />
                  <KPICard dark={dark} size="sm" label="VU" value={dashboardStats.vu} onClick={() => goToVehicles({ vu: "vu" })} />
                  <KPICard dark={dark} size="sm" label="Commandé" value={dashboardStats.total - dashboardStats.disponibles - dashboardStats.reserves - dashboardStats.vendus - dashboardStats.hsCount - dashboardStats.nonSerialises} />
                  <KPICard dark={dark} size="sm" label="Non sérialisés" value={dashboardStats.nonSerialises} onClick={() => goToVehicles({ statut: "non_serialise" })} />
                  <KPICard dark={dark} size="sm" label="Arrivés ≤3j" value={dashboardStats.arrivees} />
                  <KPICard dark={dark} size="sm" label="Alertes" value={dashboardStats.activeAlerts} />
                  <KPICard dark={dark} size="sm" label="Stock moy." value={`${dashboardStats.avgJoursStock} j`} />
                </div>
              </DashboardSection>

              <DashboardSection dark={dark} icon={Layers} title="Répartition">
                <div className="grid gap-4 lg:grid-cols-3">
                  <DonutCard dark={dark} title="Par statut" data={dashboardStats.byStatus} />
                  <DonutCard dark={dark} title="VP / VU" data={dashboardStats.byType} />
                  <DonutCard dark={dark} title="Par concession" data={dashboardStats.byConcession} />
                </div>
                <SiteComparisonTable dark={dark} vehicles={visibleVehicles} />
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  <KPICard dark={dark} size="sm" label="Électriques" value={dashboardStats.electriques} />
                  <KPICard dark={dark} size="sm" label="Hybrides rechargeables" value={dashboardStats.hybridesRecharge} />
                </div>
              </DashboardSection>

              <DashboardSection dark={dark} icon={Users} title="Activité commerciale">
                <div className="grid grid-cols-3 gap-3">
                  <KPICard dark={dark} size="sm" label="Ventes totales" value={dashboardStats.vendus} />
                  <KPICard dark={dark} size="sm" label="Ventes attribuées" value={visibleVehicles.filter((v) => v.vendu && v.venduPar).length} />
                  <KPICard dark={dark} size="sm" label="Non attribuées" value={visibleVehicles.filter((v) => v.vendu && !v.venduPar).length} onClick={() => setTab("dossiers")} />
                </div>
                <VendeurPerformanceTable dark={dark} vehicles={visibleVehicles} vendeursList={mySiteScope ? vendeursList.filter((v) => v.site === mySiteScope) : vendeursList} dossiers={dossiers} />
                <div className="grid gap-4 lg:grid-cols-3">
                  <BarListCard dark={dark} title="Ventes par vendeur" data={dashboardStats.byVenteVendeur.slice(0, 8)} color={dark ? "#A78BFA" : "#7C3AED"} layout="vertical" />
                  <BarListCard dark={dark} title="Réservations par vendeur" data={dashboardStats.byVendeur.slice(0, 8)} color={dark ? "#38BDF8" : "#0284C7"} layout="vertical" />
                  <DonutCard dark={dark} title="Statut de livraison (dossiers)" data={groupCount(dossiers, (d) => d.statutLivraison)} />
                </div>
                <div className="grid gap-4 lg:grid-cols-2">
                  <BarListCard dark={dark} title="Par type de vente" data={dashboardStats.byTypeVente.slice(0, 8)} color={dark ? "#3B82F6" : "#1D4ED8"} />
                  <BarListCard dark={dark} title="Top 5 modèles" data={dashboardStats.topModels} color={dark ? "#FB923C" : "#EA580C"} layout="vertical" />
                </div>
              </DashboardSection>

              <DashboardSection dark={dark} icon={TrendingUp} title="Stock, alertes & tendance">
                <div className="grid gap-4 lg:grid-cols-3">
                  <BarListCard dark={dark} title="Ancienneté du stock" data={dashboardStats.stockBuckets} color={dark ? "#34D399" : "#059669"} />
                  <AlertsSummaryCard dark={dark} vehicles={visibleVehicles} />
                  <div className="lg:col-span-1">
                    <TrendChart dark={dark} />
                  </div>
                </div>
              </DashboardSection>
            </div>
          ) : tab === "accidentes" ? (
            <AccidentManualList dark={dark} accidents={accidents} vehicles={vehicles} vendorName={vendorName} onAdd={handleAddAccident} onRemove={handleRemoveAccident} />
          ) : tab === "dossiers" ? (
            <div className="space-y-4">
              <div className={`inline-flex gap-1 rounded-xl border p-1 ${dark ? "bg-zinc-900/60 border-zinc-800" : "bg-white border-stone-200"}`}>
                {[
                  { id: "dossiers", label: "Dossiers importés", count: dossiers.length },
                  { id: "non-attribuees", label: "Non attribuées", count: vehicles.filter((v) => v.vendu && !v.venduPar && !v.clientLabel).length },
                  { id: "attribuees", label: "Attribuées manuellement", count: vehicles.filter((v) => v.venduAttribManuelle).length },
                ].map((it) => (
                  <button
                    key={it.id}
                    onClick={() => setDossiersSubTab(it.id)}
                    className={`pl-interactive flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-sm font-medium ${
                      dossiersSubTab === it.id ? (dark ? "bg-blue-500/10 text-blue-300" : "bg-blue-50 text-blue-700") : dark ? "text-zinc-400 hover:text-zinc-200" : "text-stone-500 hover:text-stone-800"
                    }`}
                  >
                    {it.label}
                    {it.count > 0 && (
                      <span className={`flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 text-[10px] font-bold ${dossiersSubTab === it.id ? "bg-white/25 text-white" : dark ? "bg-zinc-800 text-zinc-400" : "bg-stone-100 text-stone-500"}`}>
                        {it.count}
                      </span>
                    )}
                  </button>
                ))}
              </div>

              {dossiersSubTab === "dossiers" ? (
                dossiers.length > 0 ? (
                  <DossierList dark={dark} dossiers={dossiers} onExport={exportDossiersToExcel} />
                ) : (
                  <EmptyState
                    dark={dark}
                    icon={FileText}
                    title="Aucun dossier importé pour l'instant"
                    subtitle="Utilisez le bouton Importer en haut de la page pour charger le fichier MyAna."
                  />
                )
              ) : dossiersSubTab === "non-attribuees" ? (
                <UnattributedSalesPanel dark={dark} vehicles={vehicles} vendeursList={vendeursList} onAssign={handleAssignManualSale} />
              ) : (
                <AttributedManuallyPanel dark={dark} vehicles={vehicles} vendeursList={vendeursList} onAssign={handleAssignManualSale} />
              )}
            </div>
          ) : tab === "documents" ? (
            <DocumentsTab
              dark={dark}
              folderUrl={documentsConfig.folderUrl}
              canConfigure={permissions.vendeurs}
              onOpenSettings={() => setTab("reglages")}
            />
          ) : tab === "reglages" ? (
            <SettingsPanel
              dark={dark}
              vendeurs={vendeursList}
              vehicles={vehicles}
              dossiers={dossiers}
              sitesList={sitesList}
              alertSettings={alertSettings}
              activityLog={activityLog}
              challengeConfig={challengeConfig}
              challengeEntries={challengeEntries}
              documentsConfig={documentsConfig}
              onAdd={handleAddVendeur}
              onRemove={handleRemoveVendeur}
              onUpdateSite={handleUpdateVendeurSite}
              onUpdateRole={handleUpdateVendeurRole}
              onUpdatePermission={handleUpdateVendeurPermission}
              onRename={handleRenameVendeur}
              onUpdateEmail={handleUpdateVendeurEmail}
              onUpdateSites={handleUpdateSites}
              onUpdateAlertSettings={handleUpdateAlertSettings}
              onUpdateChallengeConfig={handleUpdateChallengeConfig}
              onResetChallengeEntries={handleResetChallengeEntries}
              onExportBackup={() => exportFullBackup(vehicles, dossiers, vendeursList)}
              onUpdateDocumentsConfig={handleUpdateDocumentsConfig}
              onRestoreVersion={isSuperAdmin(vendorName) || myRole === "Chef des ventes" || myRole === "Directeur de plaque" ? handleRestoreVersion : undefined}
            />
          ) : (
            <>
              <FilterBar
                dark={dark}
                filters={filters}
                setFilters={setFilters}
                sitesList={sitesList}
                typeVentes={typeVentes}
                vendeurs={vendeurs}
                models={models}
                sortBy={sortBy}
                setSortBy={setSortBy}
                onExport={() => exportVehiclesToExcel(filtered)}
              />
              <div className="hidden lg:block">
                <VehicleTable dark={dark} vehicles={filtered} expandedOrder={expandedOrder} onSelect={toggleExpand} />
              </div>
              <div className="lg:hidden">
                <VehicleCardList dark={dark} vehicles={filtered} expandedOrder={expandedOrder} onSelect={toggleExpand} />
              </div>
              {expandedOrder && vehicles.find((v) => v.orderNumber === expandedOrder) && (
                <div className="fixed inset-0 z-40 flex items-center justify-center p-4">
                  <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setSelected(null)} />
                  <div className="relative max-h-[85vh] w-full max-w-4xl overflow-y-auto rounded-2xl shadow-xl">
                    <ExpandedDetail
                      v={vehicles.find((v) => v.orderNumber === expandedOrder)}
                      dark={dark}
                      onClose={() => setSelected(null)}
                      onSave={handleReservationSave}
                      vendorName={vendorName}
                      vendeursList={vendeursList}
                      sitesList={sitesList}
                      onUpdateVehicleSite={handleUpdateVehicleSite}
                      onAddComment={handleAddVehicleComment}
                      onDeleteComment={handleDeleteVehicleComment}
                    />
                  </div>
                </div>
              )}
            </>
          )}
            </div>
          </div>
          <div className={`mt-6 text-center text-xs ${dark ? "text-zinc-600" : "text-stone-400"}`}>
            <span className={`font-display font-semibold ${dark ? "text-zinc-500" : "text-stone-500"}`}>{stats.total}</span> véhicules au total
            {lastSync && ` · synchronisé à ${lastSync.toLocaleTimeString("fr-FR")}`}
          </div>
        </div>
      )}

      {alertsOpen && (
        <AlertsDrawer
          dark={dark}
          vehicles={vehicles}
          onClose={() => setAlertsOpen(false)}
          onSelect={(v) => {
            setTab("vehicules");
            toggleExpand(v);
          }}
        />
      )}
      {importOpen && (
        <Modal dark={dark} title="Importer / mettre à jour les fichiers" onClose={() => setImportOpen(false)}>
          <ImportForm
            dark={dark}
            onImport={handleImport}
            existingMeta={importMeta}
            onImportDossiers={handleImportDossiers}
            existingDossiersMeta={dossiersMeta}
            dataWarningsCount={stats.dataWarnings}
            onReset={permissions.reset ? () => (resetConfirm ? handleReset() : setResetConfirm(true)) : null}
            resetConfirm={resetConfirm}
          />
        </Modal>
      )}
      {showPasswordModal && <PasswordChangeModal dark={dark} onClose={() => setShowPasswordModal(false)} showToast={showToast} />}
        </>
      )}
      <Toast dark={dark} toast={toast} onDismiss={() => setToast(null)} />
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
