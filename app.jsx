import React, { useState, useEffect, useMemo, useCallback, Fragment } from "react";
import { createRoot } from "react-dom/client";
import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";
import {
  Car, Truck, Search, Bell, Sun, Moon, RefreshCw,
  Upload, X, ChevronRight, User, AlertTriangle,
  RotateCcw, FileSpreadsheet, Zap, SlidersHorizontal, CheckCircle2,
  CalendarClock, History, Info, Trash2, Plus, Download, Lock,
} from "lucide-react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
} from "recharts";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const MONTHS = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };
const VU_KEYWORDS = ["transit", "tourneo", "ranger"];
const VP_OVERRIDE_MODELS = ["tourneo connect", "tourneo courier"];
const RESERVATION_STATUSES = [
  "Réservé",
  "En attente d'accord FI",
  "Dossier en cours",
  "Client confirmé",
  "Livraison programmée",
  "Réservation annulée",
];
const STORE_KEYS = {
  orders: "dsr:orders",
  stock: "dsr:stock",
  overlays: "dsr:overlays",
  meta: "dsr:import-meta",
  theme: "dsr:theme",
  vendor: "dsr:vendor-name",
  accidents: "dsr:accidents",
  access: "dsr:access-unlocked",
};
const ACCESS_CODE = "Legrand27";

// ---------------------------------------------------------------------------
// Supabase (shared/collaborative data) — personal settings use localStorage
// ---------------------------------------------------------------------------
const SUPABASE_URL = "https://zdzpmlkzujzvjigcdwmf.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpkenBtbGt6dWp6dmppZ2Nkd21mIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI5MTAxNTUsImV4cCI6MjA5ODQ4NjE1NX0.v2RZnooxZEWSAv1bXaW2aHUYcJPZlHAjWhi4FkDXwGs";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const TABLE = "parclive_data";

async function sGet(key, shared) {
  if (!shared) {
    try {
      return localStorage.getItem(key);
    } catch (e) {
      return null;
    }
  }
  try {
    const { data, error } = await supabase.from(TABLE).select("value").eq("key", key).maybeSingle();
    if (error || !data) return null;
    return JSON.stringify(data.value);
  } catch (e) {
    console.error("supabase get failed", key, e);
    return null;
  }
}
async function sSet(key, value, shared) {
  if (!shared) {
    try {
      localStorage.setItem(key, value);
      return true;
    } catch (e) {
      return false;
    }
  }
  try {
    const { error } = await supabase.from(TABLE).upsert({ key, value: JSON.parse(value), updated_at: new Date().toISOString() });
    if (error) console.error("supabase set failed", key, error);
    return !error;
  } catch (e) {
    console.error("supabase set failed", key, e);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Excel parsing helpers
// ---------------------------------------------------------------------------
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
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array", cellDates: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: "", raw: false });
  return rows.map(normalizeRow);
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
    deliveryEstimate: pick(n, "delivery estimate"),
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
  return { model, bodyType, trim, color, power, gearbox, energy, battery, length, options };
}
function displayModel(v) {
  const bits = [v.model];
  if (v.model === "Transit Custom") {
    const bt = (v.bodyType || "").toUpperCase().trim();
    if (bt.includes("KOMBI FG") || bt.includes("KOMBI-FG")) bits.push("Kombi FG");
    else if (bt.includes("MULTICAB")) bits.push("Multicab");
    else if (bt.includes("KOMBI")) bits.push("Kombi");
    else if (bt === "CA" || bt.includes("CABINE APPROFONDIE")) bits.push("CA");
    else if (bt === "FG" || bt.includes("FOURGON")) bits.push("FG");
  }
  if (v.vu && v.length && !/courier/i.test(v.model)) bits.push(v.length);
  return bits.join(" ");
}
function gearboxLabel(v) {
  if (v.energy === "Électrique") return "BVA";
  return v.gearbox || "—";
}
function powerLabel(v) {
  if (v.energy === "Électrique") return v.battery ? `${v.battery} kWh` : "—";
  return v.power ? `${v.power} ch` : "—";
}
function exportVehiclesToExcel(vehicles) {
  const rows = vehicles.map((v) => ({
    "N° commande": v.orderNumber,
    "Véhicule": displayModel(v),
    "Finition": v.trim || "",
    "Couleur": v.color || "",
    "VIN": v.vin || "",
    "Concession": v.concession || "",
    "Statut": STATUS_META[v.baseStatus]?.label || v.baseStatus,
    "Réservé par": v.reservation?.vendeur || "",
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

// ---------------------------------------------------------------------------
// Vehicle derivation (join order + stock + user overlay, compute status/alerts)
// ---------------------------------------------------------------------------
function buildVehicle(order, stock, overlay) {
  const { model, bodyType, trim, color, power, gearbox, energy, battery, length, options: optionsList } = parseDescription(order.description);
  const vu = isVU(model);
  const inStock = !!stock;
  const deliveredToClient = /customer|livre client/i.test(order.localisation || "");
  const reservation = overlay?.reservation || null;
  const activeReservation = !!(reservation && reservation.statut && reservation.statut !== "Réservation annulée");

  let baseStatus;
  if (deliveredToClient) baseStatus = "livre_client";
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
  const alerts = [];
  if (inStock && stock.joursStock <= 3) alerts.push({ type: "arrivee", label: "Arrivée récente" });
  if (!inStock && !deliveredToClient && estRange?.end && estRange.end < today)
    alerts.push({ type: "retard", label: "Délai de livraison dépassé" });
  if (activeReservation && reservation.dateFin) {
    const fin = new Date(reservation.dateFin);
    if (!isNaN(fin)) {
      const diffDays = (fin - today) / 86400000;
      if (diffDays < 0) alerts.push({ type: "resa_expiree", label: "Réservation expirée" });
      else if (diffDays <= 2) alerts.push({ type: "resa_bientot", label: "Réservation expire bientôt" });
    }
  }
  if (activeReservation && reservation.dateDebut) {
    const debut = new Date(reservation.dateDebut);
    if (!isNaN(debut)) {
      const diffDays = (today - debut) / 86400000;
      if (diffDays > 21) alerts.push({ type: "resa_longue", label: "Réservé depuis longtemps" });
    }
  }

  return {
    ...order,
    model,
    bodyType,
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
  reserve: { label: "Réservé", dot: "bg-amber-500", text: "text-amber-800", bg: "bg-amber-100", textDark: "text-amber-300", bgDark: "bg-amber-500/20" },
  commande: { label: "Commandé", dot: "bg-zinc-400", text: "text-zinc-700", bg: "bg-zinc-200", textDark: "text-zinc-300", bgDark: "bg-zinc-500/20" },
  non_serialise: { label: "Non sérialisé", dot: "bg-indigo-500", text: "text-indigo-800", bg: "bg-indigo-100", textDark: "text-indigo-300", bgDark: "bg-indigo-500/20" },
  livre_client: { label: "Livré client", dot: "bg-zinc-600", text: "text-zinc-700", bg: "bg-zinc-200", textDark: "text-zinc-200", bgDark: "bg-zinc-600/20" },
};

// ---------------------------------------------------------------------------
// Small presentational components
// ---------------------------------------------------------------------------
function StatusBadge({ vehicle, dark }) {
  const meta = STATUS_META[vehicle.baseStatus];
  const label = vehicle.baseStatus === "reserve" && vehicle.reservation?.statut ? vehicle.reservation.statut : meta.label;
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ${dark ? meta.bgDark + " " + meta.textDark : meta.bg + " " + meta.text}`}>
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
      className={`inline-flex ${dims} items-center justify-center rounded-lg ring-1 ${dark ? "bg-amber-500/10 text-amber-400 ring-amber-500/20" : "bg-amber-50 text-amber-700 ring-amber-200"}`}
      title={vu ? "Véhicule Utilitaire" : "Véhicule Particulier"}
    >
      <Icon size={iconSize} />
    </span>
  );
}

function KPICard({ label, value, dark }) {
  return (
    <div
      className={`rounded-2xl border p-4 ${dark ? "bg-zinc-900/60 border-zinc-800" : "bg-white border-stone-200"}`}
      style={dark ? { boxShadow: "inset 0 1px 0 rgba(255,255,255,0.05)" } : { boxShadow: "0 1px 2px rgba(0,0,0,0.03)" }}
    >
      <div className={`text-[11px] font-semibold uppercase tracking-widest ${dark ? "text-zinc-500" : "text-stone-400"}`}>{label}</div>
      <div className={`font-display mt-1.5 text-3xl font-semibold tabular-nums ${dark ? "text-zinc-50" : "text-stone-900"}`}>{value}</div>
    </div>
  );
}


function Tabs({ dark, tab, setTab, accidentCount }) {
  const items = [
    { id: "vehicules", label: "Véhicules" },
    { id: "dashboard", label: "Tableau de bord" },
    { id: "accidentes", label: "Accidentés", count: accidentCount },
  ];
  return (
    <div className={`inline-flex gap-1 rounded-xl border p-1 ${dark ? "bg-zinc-900/60 border-zinc-800" : "bg-white border-stone-200"}`}>
      {items.map((it) => (
        <button
          key={it.id}
          onClick={() => setTab(it.id)}
          className={`flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-sm font-medium transition-colors ${
            tab === it.id
              ? "bg-amber-500 text-zinc-950"
              : dark
              ? "text-zinc-400 hover:text-zinc-200"
              : "text-stone-500 hover:text-stone-800"
          }`}
        >
          {it.label}
          {!!it.count && (
            <span className={`flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 text-[10px] font-bold ${tab === it.id ? "bg-zinc-950/20 text-zinc-950" : "bg-rose-500 text-white"}`}>
              {it.count}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

function TopBar({ dark, setDark, vendorName, onOpenVendor, onImport, onRefresh, lastSync, alertCount, onOpenAlerts, syncing }) {
  const btnCls = `flex h-9 items-center justify-center rounded-lg border transition-colors ${dark ? "border-zinc-800 text-zinc-300 hover:bg-zinc-800/70 hover:border-zinc-700" : "border-stone-200 text-stone-600 hover:bg-stone-100"}`;
  return (
    <div className={`sticky top-0 z-20 flex flex-wrap items-center gap-3 rounded-t-2xl border-b px-4 py-3 md:px-6 ${dark ? "bg-zinc-950 border-zinc-800" : "bg-white border-stone-200"}`}>
      <div className="flex items-center gap-2.5">
        <span className="relative inline-flex h-2.5 w-2.5">
          <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 ${dark ? "bg-emerald-400" : "bg-emerald-500"}`} />
          <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${dark ? "bg-emerald-400" : "bg-emerald-500"}`} />
        </span>
        <span className={`font-display text-xl font-semibold tracking-tight ${dark ? "text-zinc-50" : "text-stone-900"}`}>
          Parc<span className={dark ? "text-amber-400" : "text-amber-600"}>Live</span>
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
      <button onClick={onImport} className={`gap-1.5 px-3 text-sm font-medium ${btnCls}`}>
        <Upload size={14} /> Importer
      </button>
      <button onClick={() => setDark(!dark)} className={`w-9 ${btnCls}`}>
        {dark ? <Sun size={16} /> : <Moon size={16} />}
      </button>
      <button onClick={onOpenVendor} className={`gap-2 px-3 text-sm font-medium ${btnCls}`}>
        <User size={14} /> {vendorName || "Définir mon nom"}
      </button>
    </div>
  );
}

function FiltersPopover({ dark, filters, setFilters, concessions, typeVentes, vendeurs }) {
  const [open, setOpen] = useState(false);
  const selectCls = `h-9 w-full rounded-lg border px-3 text-sm outline-none transition-shadow focus:ring-2 ${dark ? "bg-zinc-950 border-zinc-800 text-zinc-200 focus:ring-amber-500/30" : "bg-white border-stone-200 text-stone-700 focus:ring-amber-500/20"}`;
  const labelCls = `mb-1.5 text-[11px] font-semibold uppercase tracking-widest ${dark ? "text-zinc-500" : "text-stone-400"}`;

  const activeCount =
    (filters.concession !== "all" ? 1 : 0) +
    (filters.vu !== "all" ? 1 : 0) +
    (filters.statut !== "all" ? 1 : 0) +
    (filters.vendeur !== "all" ? 1 : 0) +
    (filters.typeVente.length > 0 ? 1 : 0);

  function chipCls(active) {
    return `rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
      active ? "bg-amber-500 text-zinc-950" : dark ? "bg-zinc-800 text-zinc-300 hover:bg-zinc-700" : "bg-stone-100 text-stone-600 hover:bg-stone-200"
    }`;
  }
  function toggleTypeVente(code) {
    setFilters((f) => ({ ...f, typeVente: f.typeVente.includes(code) ? f.typeVente.filter((c) => c !== code) : [...f.typeVente, code] }));
  }
  function reset() {
    setFilters((f) => ({ ...f, concession: "all", vu: "all", statut: "all", vendeur: "all", typeVente: [] }));
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className={`relative flex h-9 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium ${dark ? "border-zinc-800 text-zinc-300 hover:bg-zinc-800/70" : "border-stone-200 text-stone-600 hover:bg-stone-100"}`}
      >
        <SlidersHorizontal size={14} /> Filtres
        {activeCount > 0 && (
          <span className="flex h-4 min-w-[16px] items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-bold text-zinc-950">{activeCount}</span>
        )}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className={`absolute right-0 z-20 mt-1 w-72 space-y-3 rounded-xl border p-3.5 shadow-lg ${dark ? "bg-zinc-900 border-zinc-800" : "bg-white border-stone-200"}`}>
            <div>
              <div className={labelCls}>Concession</div>
              <select className={selectCls} value={filters.concession} onChange={(e) => setFilters((f) => ({ ...f, concession: e.target.value }))}>
                <option value="all">Toutes concessions</option>
                {concessions.map((c) => (
                  <option key={c} value={c}>{c}</option>
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
              <div className={labelCls}>Statut</div>
              <div className="flex flex-wrap gap-1.5">
                {[["all", "Tous"], ["disponible", "Disponible"], ["reserve", "Réservé"], ["commande", "Commandé"], ["non_serialise", "Non sérialisé"]].map(([val, lbl]) => (
                  <button key={val} onClick={() => setFilters((f) => ({ ...f, statut: val }))} className={chipCls(filters.statut === val)}>{lbl}</button>
                ))}
              </div>
            </div>
            <div>
              <div className={labelCls}>Type de vente</div>
              <div className={`max-h-28 space-y-0.5 overflow-y-auto rounded-lg border p-1.5 ${dark ? "border-zinc-800" : "border-stone-200"}`}>
                {typeVentes.map((t) => (
                  <label key={t} className={`flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-sm ${dark ? "hover:bg-zinc-800" : "hover:bg-stone-50"}`}>
                    <input type="checkbox" checked={filters.typeVente.includes(t)} onChange={() => toggleTypeVente(t)} className="accent-amber-500" />
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
            {activeCount > 0 && (
              <button onClick={reset} className={`text-xs underline ${dark ? "text-zinc-500 hover:text-zinc-300" : "text-stone-400 hover:text-stone-700"}`}>
                Réinitialiser les filtres
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function FilterBar({ dark, filters, setFilters, concessions, typeVentes, vendeurs, sortBy, setSortBy, onExport }) {
  const inputCls = `h-9 rounded-lg border px-3 text-sm outline-none transition-shadow focus:ring-2 ${dark ? "bg-zinc-950 border-zinc-800 text-zinc-200 focus:ring-amber-500/30 focus:border-amber-500/40" : "bg-white border-stone-200 text-stone-700 focus:ring-amber-500/20 focus:border-amber-400"}`;
  return (
    <div className={`flex flex-wrap items-center gap-2 rounded-2xl border p-2.5 shadow-sm ${dark ? "bg-zinc-900/50 border-zinc-800" : "bg-white border-stone-200"}`}>
      <div className={`flex h-9 min-w-[220px] flex-1 items-center gap-2 rounded-lg border px-3 transition-shadow focus-within:ring-2 ${dark ? "bg-zinc-950 border-zinc-800 focus-within:ring-amber-500/30" : "bg-stone-50 border-stone-200 focus-within:ring-amber-500/20"}`}>
        <Search size={14} className={dark ? "text-zinc-500" : "text-stone-400"} />
        <input
          value={filters.query}
          onChange={(e) => setFilters((f) => ({ ...f, query: e.target.value }))}
          placeholder="Commande, VIN, modèle… (séparez par une virgule)"
          className={`w-full bg-transparent text-sm outline-none ${dark ? "text-zinc-200 placeholder:text-zinc-600" : "text-stone-700 placeholder:text-stone-400"}`}
        />
      </div>
      <FiltersPopover dark={dark} filters={filters} setFilters={setFilters} concessions={concessions} typeVentes={typeVentes} vendeurs={vendeurs} />
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
        expanded ? (dark ? "border-zinc-800 bg-zinc-900/70" : "border-stone-200 bg-amber-50/60") : dark ? "border-zinc-800 hover:bg-zinc-800/70" : "border-stone-200 hover:bg-amber-50/40"
      }`}
      style={{ boxShadow: `inset 4px 0 0 ${hasAlert ? "#E11D48" : "transparent"}` }}
    >
      <td className="px-3 py-2 text-center">
        <VehicleTypeIcon vu={v.vu} dark={dark} size="sm" />
        <div className={`mt-1 truncate font-mono text-[11px] font-semibold transition-colors ${dark ? "text-zinc-300 group-hover:text-amber-400" : "text-stone-600 group-hover:text-amber-600"}`}>
          {v.orderNumber}
        </div>
      </td>
      <td className="px-2 py-2" title={v.description}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className={`truncate font-semibold ${dark ? "text-zinc-50" : "text-stone-900"}`}>{displayModel(v)}</span>
              {(isElectric || isPHEV) && (
                <Zap size={13} className={`shrink-0 ${isElectric ? (dark ? "text-sky-400" : "text-sky-600") : (dark ? "text-violet-400" : "text-violet-600")}`} aria-label={v.energy}>
                  <title>{v.energy}</title>
                </Zap>
              )}
            </div>
            <div className={`truncate text-xs ${dark ? "text-zinc-400" : "text-stone-500"}`} title={meta}>{meta}</div>
          </div>
          <div className="shrink-0 text-right">
            <StatusBadge vehicle={v} dark={dark} />
            {v.baseStatus === "reserve" && v.reservation?.vendeur && (
              <div className={`mt-1 flex items-center justify-end gap-1 text-xs font-medium ${dark ? "text-zinc-300" : "text-stone-600"}`} title={v.reservation.vendeur}>
                <span className="max-w-[100px] truncate">{v.reservation.vendeur}</span>
                <User size={10} className="shrink-0" />
              </div>
            )}
          </div>
        </div>
      </td>
      <td className={`truncate px-2 py-2 font-mono text-xs ${dark ? "text-zinc-400" : "text-stone-500"}`} title={v.vin}>{v.vin || "—"}</td>
      <td className={`truncate px-2 py-2 font-medium tabular-nums ${dark ? "text-zinc-200" : "text-stone-700"}`}>
        {v.inStock ? `${v.joursStock} j` : (fmtRange(v.estRange) || "—")}
      </td>
      <td className="whitespace-nowrap px-2 py-2 pr-4 text-right">
        {hasAlert && <AlertTriangle size={14} className="inline text-rose-500" />}
      </td>
    </tr>
  );
}

function VehiclesHeader({ dark, count, totalCount }) {
  return (
    <div className="flex items-baseline justify-between">
      <div>
        <h2 className={`font-display text-2xl font-semibold tracking-tight ${dark ? "text-zinc-50" : "text-stone-900"}`}>Véhicules</h2>
        <p className={`mt-0.5 text-sm ${dark ? "text-zinc-500" : "text-stone-400"}`}>
          {count === totalCount ? (
            <>
              <span className={`font-display font-semibold ${dark ? "text-zinc-300" : "text-stone-600"}`}>{count}</span> véhicule{count > 1 ? "s" : ""} au total
            </>
          ) : (
            <>
              <span className={`font-display font-semibold ${dark ? "text-zinc-300" : "text-stone-600"}`}>{count}</span> sur {totalCount} véhicules
            </>
          )}
        </p>
      </div>
    </div>
  );
}

function VehicleTable({ dark, vehicles, expandedOrder, onSelect, onSave, vendorName }) {
  const thCls = `sticky top-0 z-10 py-2.5 text-left text-xs font-bold uppercase tracking-widest ${dark ? "bg-zinc-900 text-zinc-300 border-b-2 border-zinc-800" : "bg-stone-100 text-stone-600 border-b-2 border-stone-200"}`;
  return (
    <div className={`overflow-hidden rounded-2xl border-2 shadow-sm ${dark ? "border-zinc-800" : "border-stone-200"}`}>
      <div className="max-h-[640px] overflow-auto">
        <table className="w-full table-fixed text-sm">
          <colgroup>
            <col style={{ width: "11%" }} />
            <col style={{ width: "44%" }} />
            <col style={{ width: "17%" }} />
            <col style={{ width: "22%" }} />
            <col style={{ width: "6%" }} />
          </colgroup>
          <thead>
            <tr>
              <th className={`${thCls} px-3 text-center`}>Véhicule</th>
              <th className={`${thCls} px-2`}>Modèle &amp; statut</th>
              <th className={`${thCls} px-2`}>VIN</th>
              <th className={`${thCls} px-2`}>Stock / Arrivée</th>
              <th className={`${thCls} px-2`}></th>
            </tr>
          </thead>
          <tbody>
            {vehicles.map((v, i) => {
              const isOpen = v.orderNumber === expandedOrder;
              return (
                <Fragment key={v.orderNumber}>
                  <VehicleRow v={v} dark={dark} onSelect={onSelect} expanded={isOpen} zebra={i % 2 === 1} />
                  {isOpen && (
                    <tr>
                      <td colSpan={5} className="p-0">
                        <ExpandedDetail v={v} dark={dark} onClose={() => onSelect(v)} onSave={onSave} vendorName={vendorName} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {vehicles.length === 0 && (
              <tr>
                <td colSpan={5} className={`px-4 py-10 text-center text-sm ${dark ? "text-zinc-500" : "text-stone-400"}`}>
                  Aucun véhicule ne correspond aux filtres.
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
      className={`cursor-pointer border p-3.5 shadow-sm transition-colors ${expanded ? "rounded-t-xl" : "rounded-xl"} ${
        expanded ? (dark ? "border-amber-500 bg-zinc-900/60" : "border-amber-400 bg-amber-50/50") : dark ? "border-zinc-800 bg-zinc-900/40 active:bg-zinc-800" : "border-stone-200 bg-white active:bg-stone-50"
      }`}
      style={{ boxShadow: hasAlert ? "inset 4px 0 0 #E11D48" : undefined }}
    >
      <div className="flex items-start gap-3">
        <VehicleTypeIcon vu={v.vu} dark={dark} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className={`truncate font-semibold ${dark ? "text-zinc-50" : "text-stone-900"}`}>{displayModel(v)}</span>
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
        {v.baseStatus === "reserve" && v.reservation?.vendeur && (
          <span className={`flex items-center gap-1 text-xs font-medium ${dark ? "text-zinc-300" : "text-stone-600"}`}>
            <User size={11} /> {v.reservation.vendeur}
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

function VehicleCardList({ dark, vehicles, expandedOrder, onSelect, onSave, vendorName }) {
  if (vehicles.length === 0) {
    return (
      <div className={`rounded-2xl border p-10 text-center text-sm ${dark ? "border-zinc-800 bg-zinc-900/40 text-zinc-500" : "border-stone-200 bg-white text-stone-400"}`}>
        Aucun véhicule ne correspond aux filtres.
      </div>
    );
  }
  return (
    <div className="space-y-2.5">
      {vehicles.map((v) => {
        const isOpen = v.orderNumber === expandedOrder;
        return (
          <div key={v.orderNumber}>
            <VehicleCard v={v} dark={dark} onSelect={onSelect} expanded={isOpen} />
            {isOpen && (
              <div className={`overflow-hidden rounded-b-xl border border-t-0 ${dark ? "border-amber-500/60" : "border-amber-400/60"}`}>
                <ExpandedDetail v={v} dark={dark} onClose={() => onSelect(v)} onSave={onSave} vendorName={vendorName} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ChartsRow({ dark, stats }) {
  const gridColor = dark ? "#27272A" : "#E7E5E4";
  const tickColor = dark ? "#71717A" : "#A8A29E";
  const tooltipStyle = { background: dark ? "#18181B" : "#fff", border: `1px solid ${gridColor}`, borderRadius: 10, fontSize: 12 };
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className={`rounded-2xl border p-4 ${dark ? "bg-zinc-900/60 border-zinc-800" : "bg-white border-stone-200"}`}>
        <div className={`mb-3 text-[11px] font-semibold uppercase tracking-widest ${dark ? "text-zinc-500" : "text-stone-400"}`}>Par type de vente</div>
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={stats.byTypeVente.slice(0, 8)}>
            <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
            <XAxis dataKey="name" tick={{ fill: tickColor, fontSize: 11 }} axisLine={{ stroke: gridColor }} tickLine={false} />
            <YAxis tick={{ fill: tickColor, fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
            <Tooltip contentStyle={tooltipStyle} cursor={{ fill: dark ? "rgba(251,191,36,0.06)" : "rgba(217,119,6,0.06)" }} />
            <Bar dataKey="count" fill={dark ? "#FBBF24" : "#D97706"} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className={`rounded-2xl border p-4 ${dark ? "bg-zinc-900/60 border-zinc-800" : "bg-white border-stone-200"}`}>
        <div className={`mb-3 text-[11px] font-semibold uppercase tracking-widest ${dark ? "text-zinc-500" : "text-stone-400"}`}>Réservations par vendeur</div>
        {stats.byVendeur.length === 0 ? (
          <div className={`flex h-[180px] items-center justify-center text-xs ${dark ? "text-zinc-600" : "text-stone-400"}`}>Aucune réservation pour l'instant</div>
        ) : (
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={stats.byVendeur.slice(0, 8)} layout="vertical" margin={{ left: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={gridColor} horizontal={false} />
              <XAxis type="number" tick={{ fill: tickColor, fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
              <YAxis type="category" dataKey="name" tick={{ fill: tickColor, fontSize: 11 }} axisLine={false} tickLine={false} width={80} />
              <Tooltip contentStyle={tooltipStyle} cursor={{ fill: dark ? "rgba(56,189,248,0.06)" : "rgba(2,132,199,0.06)" }} />
              <Bar dataKey="count" fill={dark ? "#38BDF8" : "#0284C7"} radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

function ExpandedDetail({ v, dark, onClose, onSave, vendorName }) {
  const [form, setForm] = useState(() => v.reservation || { vendeur: vendorName || "", statut: "", dateDebut: "", dateFin: "", commentaire: "" });
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    setForm(v.reservation || { vendeur: vendorName || "", statut: "", dateDebut: "", dateFin: "", commentaire: "" });
    setSaved(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v.orderNumber]);

  const inputCls = `w-full rounded-lg border px-3 py-2 text-sm outline-none transition-shadow focus:ring-2 ${dark ? "bg-zinc-950 border-zinc-800 text-zinc-200 focus:ring-amber-500/30 focus:border-amber-500/40" : "bg-white border-stone-200 text-stone-700 focus:ring-amber-500/20 focus:border-amber-400"}`;

  function save() {
    onSave(v.orderNumber, { ...form, vendeur: form.vendeur || vendorName });
    setSaved(true);
    setTimeout(() => setSaved(false), 2200);
  }
  function cancelReservation() {
    const cleared = { ...form, statut: "Réservation annulée" };
    setForm(cleared);
    onSave(v.orderNumber, cleared);
  }

  return (
    <div
      className={`border-t-2 border-l-4 border-amber-500 px-5 py-5 ${dark ? "bg-zinc-950 border-t-zinc-800" : "bg-stone-50 border-t-stone-200"}`}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2.5">
          <VehicleTypeIcon vu={v.vu} dark={dark} />
          <div>
            <div className={`text-base font-bold ${dark ? "text-zinc-50" : "text-stone-900"}`}>{displayModel(v)}</div>
            <div className={`text-xs font-medium ${dark ? "text-zinc-400" : "text-stone-500"}`}>Commande {v.orderNumber} · {v.concession}</div>
          </div>
          <StatusBadge vehicle={v} dark={dark} />
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
        <button onClick={onClose} className={`rounded-lg p-1.5 transition-colors ${dark ? "text-zinc-400 hover:bg-zinc-800" : "text-stone-500 hover:bg-stone-200"}`}>
          <X size={16} />
        </button>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className={`space-y-4 rounded-xl border p-4 ${dark ? "bg-zinc-900/60 border-zinc-800" : "bg-white border-stone-200"}`}>
          <div className={`flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest ${dark ? "text-zinc-400" : "text-stone-500"}`}>
            <Info size={13} /> Fiche véhicule
          </div>
          {v.dataWarning && (
            <div className={`flex items-start gap-1.5 rounded-lg border px-2.5 py-2 text-xs font-medium ${dark ? "border-amber-800 bg-amber-500/10 text-amber-300" : "border-amber-300 bg-amber-50 text-amber-800"}`}>
              <AlertTriangle size={13} className="mt-0.5 shrink-0" /> {v.dataWarningReason}
            </div>
          )}
          <div className={`rounded-lg border p-3 text-xs leading-relaxed ${dark ? "border-zinc-800 bg-zinc-950 text-zinc-300" : "border-stone-200 bg-stone-50 text-stone-600"}`}>{v.description}</div>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-2.5 text-sm">
            <div><dt className={`text-[11px] font-medium ${dark ? "text-zinc-500" : "text-stone-400"}`}>VIN</dt><dd className={`font-mono font-medium ${dark ? "text-zinc-100" : "text-stone-800"}`}>{v.vin || "—"}</dd></div>
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
          <div className="space-y-2.5">
            <input className={inputCls} placeholder="Nom du vendeur" value={form.vendeur} onChange={(e) => setForm((f) => ({ ...f, vendeur: e.target.value }))} />
            <select className={inputCls} value={form.statut} onChange={(e) => setForm((f) => ({ ...f, statut: e.target.value }))}>
              <option value="">— Statut —</option>
              {RESERVATION_STATUSES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <div className="flex gap-2">
              <input type="date" className={inputCls} value={form.dateDebut} onChange={(e) => setForm((f) => ({ ...f, dateDebut: e.target.value }))} />
              <input type="date" className={inputCls} value={form.dateFin} onChange={(e) => setForm((f) => ({ ...f, dateFin: e.target.value }))} />
            </div>
            <textarea className={inputCls} rows={3} placeholder="Commentaire libre" value={form.commentaire} onChange={(e) => setForm((f) => ({ ...f, commentaire: e.target.value }))} />
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button onClick={save} className="flex-1 rounded-lg bg-amber-500 px-3 py-2 text-sm font-bold text-zinc-950 shadow-sm transition-colors hover:bg-amber-400">Enregistrer</button>
              {v.reservation?.statut && v.reservation.statut !== "Réservation annulée" && (
                <button onClick={cancelReservation} className={`rounded-lg border px-3 py-2 text-sm font-semibold transition-colors ${dark ? "border-zinc-700 text-zinc-200 hover:bg-zinc-800" : "border-stone-300 text-stone-700 hover:bg-stone-100"}`}>Annuler</button>
              )}
              {saved && (
                <span className={`flex items-center gap-1 text-xs font-semibold ${dark ? "text-emerald-400" : "text-emerald-600"}`}>
                  <CheckCircle2 size={13} /> Enregistré
                </span>
              )}
            </div>
          </div>
        </div>

        <div className={`rounded-xl border p-4 ${dark ? "bg-zinc-900/60 border-zinc-800" : "bg-white border-stone-200"}`}>
          <div className={`mb-3 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest ${dark ? "text-zinc-400" : "text-stone-500"}`}>
            <History size={13} /> Historique
          </div>
          {v.history.length === 0 && <div className={`text-xs ${dark ? "text-zinc-600" : "text-stone-400"}`}>Aucune modification enregistrée.</div>}
          <ul className="max-h-72 space-y-2 overflow-y-auto pr-1">
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
        </div>
      </div>
    </div>
  );
}

function AlertsDrawer({ dark, vehicles, onClose, onSelect }) {
  const flat = [];
  vehicles.forEach((v) => v.alerts.forEach((a) => flat.push({ v, a })));
  return (
    <div className="fixed inset-0 z-30 flex justify-end">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className={`relative flex h-full w-full max-w-sm flex-col overflow-y-auto border-l ${dark ? "bg-zinc-950/98 border-zinc-800" : "bg-white border-stone-200"}`}>
        <div className={`flex items-center justify-between border-b px-5 py-4 ${dark ? "border-zinc-800" : "border-stone-200"}`}>
          <div className={`text-sm font-semibold ${dark ? "text-zinc-100" : "text-stone-900"}`}>Alertes ({flat.length})</div>
          <button onClick={onClose} className={`rounded-lg p-1.5 ${dark ? "text-zinc-400 hover:bg-zinc-800" : "text-stone-500 hover:bg-stone-100"}`}>
            <X size={16} />
          </button>
        </div>
        <div className="space-y-2 p-4">
          {flat.length === 0 && <div className={`text-sm ${dark ? "text-zinc-500" : "text-stone-400"}`}>Aucune alerte active.</div>}
          {flat.map(({ v, a }, i) => (
            <button
              key={i}
              onClick={() => { onSelect(v); onClose(); }}
              className={`block w-full rounded-lg border p-3 text-left text-sm ${dark ? "border-zinc-800 hover:bg-zinc-900" : "border-stone-200 hover:bg-stone-50"}`}
            >
              <div className="flex items-center gap-1.5 text-xs font-medium text-rose-500"><AlertTriangle size={12} />{a.label}</div>
              <div className={`mt-1 ${dark ? "text-zinc-200" : "text-stone-800"}`}>{displayModel(v)} · {v.orderNumber}</div>
              <div className={`text-xs ${dark ? "text-zinc-500" : "text-stone-400"}`}>{v.concession}{v.reservation?.vendeur ? ` · ${v.reservation.vendeur}` : ""}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function Modal({ dark, title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className={`relative w-full max-w-md rounded-2xl border p-5 ${dark ? "bg-zinc-900 border-zinc-800" : "bg-white border-stone-200"}`}>
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

function ImportForm({ dark, onImport, existingMeta }) {
  const [ordersFile, setOrdersFile] = useState(null);
  const [stockFile, setStockFile] = useState(null);
  const [ordersRows, setOrdersRows] = useState(null);
  const [stockRows, setStockRows] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function handleFile(file, which) {
    setError("");
    try {
      const rows = await parseWorkbook(file);
      if (which === "orders") { setOrdersFile(file); setOrdersRows(rows); }
      else { setStockFile(file); setStockRows(rows); }
    } catch (e) {
      setError("Impossible de lire ce fichier. Vérifiez qu'il s'agit bien d'un export DSR au format Excel.");
    }
  }

  async function submit() {
    if (!ordersRows) { setError("Le fichier des véhicules commandés est requis."); return; }
    setBusy(true);
    const ok = await onImport({ ordersRows, stockRows: stockRows || [], ordersFileName: ordersFile?.name, stockFileName: stockFile?.name });
    setBusy(false);
    if (!ok) setError("Échec de l'enregistrement (base de données injoignable ou table absente). Ouvrez la console du navigateur (F12) pour le détail, et vérifiez la table Supabase.");
  }

  const dropCls = `flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-6 text-center cursor-pointer transition-colors ${dark ? "border-zinc-700 hover:border-amber-500/60 hover:bg-amber-500/5" : "border-stone-300 hover:border-amber-400 hover:bg-amber-50/50"}`;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
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
      </div>
      {error && <div className="text-sm text-rose-500">{error}</div>}
      {existingMeta && (
        <div className={`text-xs ${dark ? "text-zinc-500" : "text-stone-400"}`}>
          Dernier import : {new Date(existingMeta.importedAt).toLocaleString("fr-FR")} · {existingMeta.ordersCount} commandes, {existingMeta.stockCount} en stock
        </div>
      )}
      <button onClick={submit} disabled={!ordersRows || busy} className="w-full rounded-lg bg-amber-500 px-4 py-2.5 text-sm font-semibold text-zinc-950 transition-colors hover:bg-amber-400 disabled:opacity-40">
        {busy ? "Import en cours…" : "Valider l'import"}
      </button>
    </div>
  );
}

function ImportGate({ dark, onImport }) {
  return (
    <div className="flex min-h-[500px] items-center justify-center p-6">
      <div className={`w-full max-w-lg rounded-2xl border p-6 ${dark ? "bg-zinc-900/60 border-zinc-800" : "bg-white border-stone-200"}`}>
        <div className={`font-display mb-1 text-lg font-semibold ${dark ? "text-zinc-100" : "text-stone-900"}`}>Importer les données du jour</div>
        <div className={`mb-5 text-sm ${dark ? "text-zinc-500" : "text-stone-400"}`}>
          Chargez les deux exports DSR pour démarrer le suivi du parc. Ces données de référence resteront visibles par toute l'équipe et ne pourront pas être modifiées directement.
        </div>
        <ImportForm dark={dark} onImport={onImport} />
      </div>
    </div>
  );
}

function VendorPrompt({ dark, onSave, onClose }) {
  const [name, setName] = useState("");
  return (
    <Modal dark={dark} title="Qui êtes-vous ?" onClose={onClose}>
      <p className={`mb-3 text-sm ${dark ? "text-zinc-400" : "text-stone-500"}`}>Ce nom sera associé à vos réservations et à l'historique des modifications.</p>
      <input
        autoFocus
        className={`w-full rounded-lg border px-3 py-2 text-sm outline-none transition-shadow focus:ring-2 ${dark ? "bg-zinc-950 border-zinc-800 text-zinc-200 focus:ring-amber-500/30" : "bg-white border-stone-200 text-stone-700 focus:ring-amber-500/20"}`}
        placeholder="Nom du vendeur"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && name.trim() && onSave(name.trim())}
      />
      <button onClick={() => name.trim() && onSave(name.trim())} className="mt-3 w-full rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-zinc-950 transition-colors hover:bg-amber-400">Continuer</button>
    </Modal>
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
        <div className={`rounded-2xl border p-10 text-center ${dark ? "border-zinc-800 bg-zinc-900/40 text-zinc-500" : "border-stone-200 bg-white text-stone-400"}`}>
          Aucun véhicule accidenté ajouté pour l'instant.
        </div>
      ) : (
        <div className={`overflow-hidden rounded-2xl border ${dark ? "border-zinc-800" : "border-stone-200"}`}>
          <ul className={`divide-y ${dark ? "divide-zinc-800" : "divide-stone-200"}`}>
            {accidents.map((a) => {
              const match = vehicles.find((v) => v.orderNumber === a.orderNumber);
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

function AccessGate({ dark, onUnlock }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState(false);

  function submit() {
    if (code === ACCESS_CODE) {
      onUnlock();
    } else {
      setError(true);
      setTimeout(() => setError(false), 1600);
    }
  }

  return (
    <div className="flex min-h-[520px] items-center justify-center p-6">
      <div className={`w-full max-w-sm rounded-2xl border p-6 text-center shadow-sm ${dark ? "bg-zinc-900 border-zinc-800" : "bg-white border-stone-200"}`}>
        <div className="mb-4 flex justify-center">
          <span className={`flex h-12 w-12 items-center justify-center rounded-full ring-1 ${dark ? "bg-amber-500/10 text-amber-400 ring-amber-500/20" : "bg-amber-50 text-amber-700 ring-amber-200"}`}>
            <Lock size={20} />
          </span>
        </div>
        <div className={`font-display text-lg font-semibold ${dark ? "text-zinc-50" : "text-stone-900"}`}>
            Parc<span className={dark ? "text-amber-400" : "text-amber-600"}>Live</span>
        </div>
        <p className={`mb-4 mt-1 text-sm ${dark ? "text-zinc-500" : "text-stone-400"}`}>Accès réservé à l'équipe — entrez le code pour continuer.</p>
        <input
          type="password"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="Code d'accès"
          autoFocus
          className={`w-full rounded-lg border px-3 py-2.5 text-center text-sm outline-none transition-shadow focus:ring-2 ${
            error
              ? "border-rose-500 focus:ring-rose-500/30"
              : dark
              ? "bg-zinc-950 border-zinc-800 text-zinc-200 focus:ring-amber-500/30"
              : "bg-white border-stone-200 text-stone-700 focus:ring-amber-500/20"
          }`}
        />
        {error && <div className="mt-2 text-xs font-semibold text-rose-500">Code incorrect, réessayez.</div>}
        <button onClick={submit} className="mt-3 w-full rounded-lg bg-amber-500 px-4 py-2.5 text-sm font-bold text-zinc-950 transition-colors hover:bg-amber-400">
          Continuer
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main app
// ---------------------------------------------------------------------------
export default function App() {
  const [dark, setDark] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const [dbStatus, setDbStatus] = useState("checking");
  const [vendorName, setVendorName] = useState("");
  const [showVendorPrompt, setShowVendorPrompt] = useState(false);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [ordersData, setOrdersData] = useState([]);
  const [stockData, setStockData] = useState([]);
  const [overlays, setOverlays] = useState({});
  const [importMeta, setImportMeta] = useState(null);
  const [accidents, setAccidents] = useState([]);
  const [lastSync, setLastSync] = useState(null);
  const [importOpen, setImportOpen] = useState(false);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [selected, setSelected] = useState(null);
  const [resetConfirm, setResetConfirm] = useState(false);
  const [tab, setTab] = useState("vehicules");
  const [filters, setFilters] = useState({ concession: "all", typeVente: [], vu: "all", statut: "all", vendeur: "all", query: "" });
  const [sortBy, setSortBy] = useState("stock_desc");

  const refreshAll = useCallback(async (indicate) => {
    if (indicate) setSyncing(true);
    const [o, s, ov, meta, acc] = await Promise.all([
      sGet(STORE_KEYS.orders, true),
      sGet(STORE_KEYS.stock, true),
      sGet(STORE_KEYS.overlays, true),
      sGet(STORE_KEYS.meta, true),
      sGet(STORE_KEYS.accidents, true),
    ]);
    if (o) setOrdersData(JSON.parse(o));
    if (s) setStockData(JSON.parse(s));
    setOverlays(ov ? JSON.parse(ov) : {});
    if (meta) setImportMeta(JSON.parse(meta));
    setAccidents(acc ? JSON.parse(acc) : []);
    setLastSync(new Date());
    if (indicate) setSyncing(false);
  }, []);

  useEffect(() => {
    (async () => {
      const t = await sGet(STORE_KEYS.theme, false);
      if (t) setDark(t === "dark");
      const acc = await sGet(STORE_KEYS.access, false);
      if (acc === "true") {
        setUnlocked(true);
        const vn = await sGet(STORE_KEYS.vendor, false);
        if (vn) setVendorName(vn);
        else setShowVendorPrompt(true);
        await refreshAll(false);
      }
      setLoading(false);
    })();
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

  async function handleUnlock() {
    setUnlocked(true);
    await sSet(STORE_KEYS.access, "true", false);
    const vn = await sGet(STORE_KEYS.vendor, false);
    if (vn) setVendorName(vn);
    else setShowVendorPrompt(true);
    await refreshAll(false);
  }

  useEffect(() => { sSet(STORE_KEYS.theme, dark ? "dark" : "light", false); }, [dark]);

  useEffect(() => {
    if (!resetConfirm) return;
    const id = setTimeout(() => setResetConfirm(false), 4000);
    return () => clearTimeout(id);
  }, [resetConfirm]);

  async function handleSetVendor(name) {
    setVendorName(name);
    setShowVendorPrompt(false);
    await sSet(STORE_KEYS.vendor, name, false);
  }

  async function handleImport({ ordersRows, stockRows, ordersFileName, stockFileName }) {
    const orders = ordersRows.map(toOrderRecord).filter((o) => o.orderNumber);
    const stock = stockRows.map(toStockRecord).filter((s) => s.orderNumber);
    const meta = { importedAt: new Date().toISOString(), ordersCount: orders.length, stockCount: stock.length, ordersFileName, stockFileName };
    const results = await Promise.all([
      sSet(STORE_KEYS.orders, JSON.stringify(orders), true),
      sSet(STORE_KEYS.stock, JSON.stringify(stock), true),
      sSet(STORE_KEYS.meta, JSON.stringify(meta), true),
    ]);
    const ok = results.every(Boolean);
    if (ok) {
      setOrdersData(orders);
      setStockData(stock);
      setImportMeta(meta);
      setImportOpen(false);
    }
    return ok;
  }

  async function handleReservationSave(orderNumber, form) {
    const now = new Date();
    const freshRaw = await sGet(STORE_KEYS.overlays, true);
    const freshOverlays = freshRaw ? JSON.parse(freshRaw) : {};
    const current = freshOverlays[orderNumber] || { reservation: null, history: [] };
    const old = current.reservation || {};
    const history = [...(current.history || [])];
    [
      ["vendeur", "Vendeur"],
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
    const next = { ...freshOverlays, [orderNumber]: { ...current, reservation: form, history } };
    await sSet(STORE_KEYS.overlays, JSON.stringify(next), true);
    setOverlays(next);
  }

  async function handleAddAccident({ orderNumber, note, addedBy }) {
    const now = new Date();
    const freshRaw = await sGet(STORE_KEYS.accidents, true);
    const fresh = freshRaw ? JSON.parse(freshRaw) : [];
    const next = [
      { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, orderNumber, note, addedBy, addedAt: now.toLocaleDateString("fr-FR") },
      ...fresh,
    ];
    await sSet(STORE_KEYS.accidents, JSON.stringify(next), true);
    setAccidents(next);
  }

  async function handleRemoveAccident(id) {
    const freshRaw = await sGet(STORE_KEYS.accidents, true);
    const fresh = freshRaw ? JSON.parse(freshRaw) : [];
    const next = fresh.filter((a) => a.id !== id);
    await sSet(STORE_KEYS.accidents, JSON.stringify(next), true);
    setAccidents(next);
  }

  async function handleReset() {
    await Promise.all([
      sSet(STORE_KEYS.orders, JSON.stringify([]), true),
      sSet(STORE_KEYS.stock, JSON.stringify([]), true),
      sSet(STORE_KEYS.overlays, JSON.stringify({}), true),
      sSet(STORE_KEYS.meta, JSON.stringify(null), true),
    ]);
    setOrdersData([]);
    setStockData([]);
    setOverlays({});
    setImportMeta(null);
    setResetConfirm(false);
  }

  const vehicles = useMemo(() => {
    const stockByOrder = new Map(stockData.map((s) => [s.orderNumber, s]));
    return ordersData
      .map((o) => buildVehicle(o, stockByOrder.get(o.orderNumber) || null, overlays[o.orderNumber] || null))
      .filter((v) => v.baseStatus !== "livre_client");
  }, [ordersData, stockData, overlays]);

  const expandedOrder = selected?.orderNumber ?? null;
  function toggleExpand(v) {
    setSelected((prev) => (prev && prev.orderNumber === v.orderNumber ? null : v));
  }

  const stats = useMemo(
    () => ({
      total: vehicles.length,
      vp: vehicles.filter((v) => !v.vu).length,
      vu: vehicles.filter((v) => v.vu).length,
      disponibles: vehicles.filter((v) => v.baseStatus === "disponible").length,
      reserves: vehicles.filter((v) => v.baseStatus === "reserve").length,
      arrivees: vehicles.filter((v) => v.inStock && v.joursStock <= 3).length,
      dataWarnings: vehicles.filter((v) => v.dataWarning).length,
      byTypeVente: groupCount(vehicles, (v) => v.typeVente),
      byVendeur: groupCount(vehicles.filter((v) => v.reservation?.vendeur), (v) => v.reservation.vendeur),
    }),
    [vehicles]
  );

  const concessions = useMemo(() => [...new Set(vehicles.map((v) => v.concession))].filter(Boolean).sort(), [vehicles]);
  const typeVentes = useMemo(() => [...new Set(vehicles.map((v) => v.typeVente))].filter(Boolean).sort(), [vehicles]);
  const vendeurs = useMemo(() => [...new Set(vehicles.map((v) => v.reservation?.vendeur).filter(Boolean))].sort(), [vehicles]);

  const filtered = useMemo(() => {
    const terms = filters.query.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean);
    let list = vehicles.filter((v) => {
      if (filters.concession !== "all" && v.concession !== filters.concession) return false;
      if (filters.typeVente.length > 0 && !filters.typeVente.includes(v.typeVente)) return false;
      if (filters.vu === "vp" && v.vu) return false;
      if (filters.vu === "vu" && !v.vu) return false;
      if (filters.statut !== "all" && v.baseStatus !== filters.statut) return false;
      if (filters.vendeur !== "all" && v.reservation?.vendeur !== filters.vendeur) return false;
      if (terms.length > 0) {
        const hay = `${v.orderNumber} ${v.vin} ${v.description} ${v.model} ${v.concession} ${v.reservation?.vendeur || ""}`.toLowerCase();
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
    return list;
  }, [vehicles, filters, sortBy]);

  const totalAlerts = useMemo(() => vehicles.reduce((n, v) => n + v.alerts.length, 0), [vehicles]);

  return (
    <div
      className={`w-full overflow-hidden rounded-2xl border font-sans ${dark ? "border-zinc-800 bg-zinc-950" : "border-stone-200 bg-stone-50"}`}
      style={{
        minHeight: 640,
        backgroundImage: dark
          ? "radial-gradient(900px circle at 100% 0%, rgba(251,191,36,0.07), transparent 45%), radial-gradient(700px circle at 0% 100%, rgba(56,189,248,0.06), transparent 45%)"
          : "radial-gradient(900px circle at 100% 0%, rgba(217,119,6,0.05), transparent 45%)",
      }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700&display=swap');
        .font-display { font-family: 'Fraunces', ui-serif, Georgia, 'Times New Roman', serif; }
      `}</style>
      {!unlocked ? (
        <AccessGate dark={dark} onUnlock={handleUnlock} />
      ) : (
        <>
      <TopBar
        dark={dark}
        setDark={setDark}
        vendorName={vendorName}
        onOpenVendor={() => setShowVendorPrompt(true)}
        onImport={() => setImportOpen(true)}
        onRefresh={() => refreshAll(true)}
        lastSync={lastSync}
        alertCount={totalAlerts}
        onOpenAlerts={() => setAlertsOpen(true)}
        syncing={syncing}
      />
      {dbStatus === "error" && (
        <div className={`flex items-center gap-2 px-4 py-2 text-xs font-semibold md:px-6 ${dark ? "bg-rose-500/15 text-rose-300" : "bg-rose-50 text-rose-700"}`}>
          <AlertTriangle size={13} /> Connexion à la base de données impossible — vérifiez que la table Supabase existe (voir README) et que la clé API est correcte. Rien ne sera sauvegardé tant que ce n'est pas résolu.
        </div>
      )}

      {loading ? (
        <div className="flex h-[500px] items-center justify-center">
          <RefreshCw className={`animate-spin ${dark ? "text-zinc-600" : "text-stone-300"}`} size={24} />
        </div>
      ) : ordersData.length === 0 ? (
        <ImportGate dark={dark} onImport={handleImport} />
      ) : (
        <div className="space-y-6 p-4 md:p-6">
          <Tabs dark={dark} tab={tab} setTab={setTab} accidentCount={accidents.length} />

          {tab === "dashboard" ? (
            <>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
                <KPICard dark={dark} label="Total" value={stats.total} />
                <KPICard dark={dark} label="VP" value={stats.vp} />
                <KPICard dark={dark} label="VU" value={stats.vu} />
                <KPICard dark={dark} label="Disponibles" value={stats.disponibles} />
                <KPICard dark={dark} label="Réservés" value={stats.reserves} />
                <KPICard dark={dark} label="Arrivés (≤3j)" value={stats.arrivees} />
              </div>
              <ChartsRow dark={dark} stats={stats} />
            </>
          ) : tab === "accidentes" ? (
            <AccidentManualList dark={dark} accidents={accidents} vehicles={vehicles} vendorName={vendorName} onAdd={handleAddAccident} onRemove={handleRemoveAccident} />
          ) : (
            <>
              <VehiclesHeader dark={dark} count={filtered.length} totalCount={vehicles.length} />
              <FilterBar
                dark={dark}
                filters={filters}
                setFilters={setFilters}
                concessions={concessions}
                typeVentes={typeVentes}
                vendeurs={vendeurs}
                sortBy={sortBy}
                setSortBy={setSortBy}
                onExport={() => exportVehiclesToExcel(filtered)}
              />
              <div className="hidden lg:block">
                <VehicleTable dark={dark} vehicles={filtered} expandedOrder={expandedOrder} onSelect={toggleExpand} onSave={handleReservationSave} vendorName={vendorName} />
              </div>
              <div className="lg:hidden">
                <VehicleCardList dark={dark} vehicles={filtered} expandedOrder={expandedOrder} onSelect={toggleExpand} onSave={handleReservationSave} vendorName={vendorName} />
              </div>
              {importMeta && (
                <div className={`flex flex-wrap items-center justify-between gap-2 text-xs ${dark ? "text-zinc-600" : "text-stone-400"}`}>
                  <span>
                    Import du {new Date(importMeta.importedAt).toLocaleString("fr-FR")} · {importMeta.ordersCount} commandes, {importMeta.stockCount} en stock · véhicules livrés client masqués
                    {stats.dataWarnings > 0 && (
                      <span className={dark ? "text-amber-400" : "text-amber-600"}> · {stats.dataWarnings} fiche{stats.dataWarnings > 1 ? "s" : ""} à vérifier</span>
                    )}
                  </span>
                  <button onClick={() => (resetConfirm ? handleReset() : setResetConfirm(true))} className="flex items-center gap-1 hover:underline">
                    <RotateCcw size={12} /> {resetConfirm ? "Cliquer à nouveau pour confirmer" : "Réinitialiser les données"}
                  </button>
                </div>
              )}
            </>
          )}
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
          <ImportForm dark={dark} onImport={handleImport} existingMeta={importMeta} />
        </Modal>
      )}
      {showVendorPrompt && <VendorPrompt dark={dark} onSave={handleSetVendor} onClose={() => setShowVendorPrompt(false)} />}
        </>
      )}
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
