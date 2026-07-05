import React, { useState, useEffect, useMemo, useCallback, useRef, Fragment } from "react";
import { createRoot } from "react-dom/client";
import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";
import {
  Car, Truck, Search, Bell, Sun, Moon, RefreshCw,
  Upload, X, ChevronRight, User, AlertTriangle,
  RotateCcw, FileSpreadsheet, Zap, SlidersHorizontal, CheckCircle2,
  CalendarClock, History, Info, Trash2, Plus, Download, Lock, Bookmark, Layers, Users, TrendingUp, List, LayoutGrid, FileText, Settings,
} from "lucide-react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
  PieChart, Pie, Cell, LineChart, Line,
} from "recharts";

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
  return { role: "Vendeur", permOverrides: {}, email: "", ...base };
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
function exportVehiclesToExcel(vehicles) {
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
function exportDossiersToExcel(dossiers) {
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
function exportVendeursToExcel(vendeursList) {
  const rows = vendeursList.map((v) => ({
    "Nom": v.nom,
    "Email": v.email || "",
    "Site": v.site || "",
    "Rôle": v.role || "Vendeur",
  }));
  const ws = XLSX.utils.json_to_sheet(rows);
  ws["!cols"] = Object.keys(rows[0] || {}).map((k) => ({ wch: Math.max(k.length, 20) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Vendeurs");
  const stamp = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `parclive-vendeurs-${stamp}.xlsx`);
}
function exportFullBackup(vehicles, dossiers, vendeursList) {
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
const ROLES = ["Directeur de plaque", "Chef des ventes", "Responsable de site", "Vendeur", "Secrétariat"];
const PERMISSION_KEYS = ["reserve", "reserveForOthers", "dashboard", "import", "dossiers", "accidentes", "vendeurs", "reset"];
const ROLE_PERMISSIONS = {
  "Directeur de plaque": { reserve: true, reserveForOthers: true, dashboard: true, import: true, dossiers: true, accidentes: true, vendeurs: true, reset: true },
  "Chef des ventes": { reserve: true, reserveForOthers: true, dashboard: true, import: true, dossiers: true, accidentes: true, vendeurs: true, reset: true },
  "Responsable de site": { reserve: true, reserveForOthers: true, dashboard: true, import: true, dossiers: true, accidentes: true, vendeurs: false, reset: false },
  "Vendeur": { reserve: true, reserveForOthers: false, dashboard: false, import: false, dossiers: false, accidentes: false, vendeurs: false, reset: false },
  "Secrétariat": { reserve: false, reserveForOthers: false, dashboard: true, import: true, dossiers: true, accidentes: true, vendeurs: false, reset: false },
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
  return v.baseStatus === "reserve" ? (v.reservation?.vendeur || "") : "";
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
  if (v.baseStatus === "reserve" && v.reservation?.client) return v.reservation.client;
  return "";
}

// ---------------------------------------------------------------------------
// Vehicle derivation (join order + stock + user overlay, compute status/alerts)
// ---------------------------------------------------------------------------
const DEFAULT_ALERT_SETTINGS = { arriveeRecente: 3, resaExpireBientot: 2, resaLongue: 21 };
function buildVehicle(order, stock, overlay, dossier, isAccidented, manualSale, alertSettings) {
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
  reserve: { label: "Réservé", dot: "bg-amber-500", text: "text-amber-800", bg: "bg-amber-100", textDark: "text-amber-300", bgDark: "bg-amber-500/20" },
  vendu: { label: "Vendu", dot: "bg-violet-600", text: "text-violet-800", bg: "bg-violet-100", textDark: "text-violet-300", bgDark: "bg-violet-500/20" },
  hs: { label: "HS", dot: "bg-rose-600", text: "text-rose-800", bg: "bg-rose-100", textDark: "text-rose-300", bgDark: "bg-rose-500/20" },
  commande: { label: "Commandé", dot: "bg-zinc-400", text: "text-zinc-700", bg: "bg-zinc-200", textDark: "text-zinc-300", bgDark: "bg-zinc-500/20" },
  non_serialise: { label: "Non sérialisé", dot: "bg-indigo-500", text: "text-indigo-800", bg: "bg-indigo-100", textDark: "text-indigo-300", bgDark: "bg-indigo-500/20" },
  livre_client: { label: "Livré client", dot: "bg-zinc-600", text: "text-zinc-700", bg: "bg-zinc-200", textDark: "text-zinc-200", bgDark: "bg-zinc-600/20" },
};
const STATUS_ACCENT = {
  disponible: "#10B981",
  reserve: "#F59E0B",
  vendu: "#7C3AED",
  hs: "#E11D48",
  commande: "#A1A1AA",
  non_serialise: "#6366F1",
  livre_client: "#71717A",
};

// ---------------------------------------------------------------------------
// Small presentational components
// ---------------------------------------------------------------------------
function StatusBadge({ vehicle, dark }) {
  const meta = STATUS_META[vehicle.baseStatus];
  const label = vehicle.baseStatus === "reserve" && vehicle.reservation?.statut ? vehicle.reservation.statut : meta.label;
  return (
    <span title={label} className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ${dark ? meta.bgDark + " " + meta.textDark : meta.bg + " " + meta.text}`}>
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

function KPICard({ label, value, dark, onClick, size }) {
  const compact = size === "sm";
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      onClick={onClick}
      className={`w-full rounded-2xl border text-left transition-colors ${compact ? "p-3" : "p-4"} ${
        dark ? "bg-zinc-900/60 border-zinc-800" : "bg-white border-stone-200"
      } ${onClick ? (dark ? "hover:border-amber-500/50 hover:bg-zinc-900 cursor-pointer" : "hover:border-amber-400 hover:bg-amber-50/30 cursor-pointer") : ""}`}
      style={dark ? { boxShadow: "inset 0 1px 0 rgba(255,255,255,0.05)" } : { boxShadow: "0 1px 2px rgba(0,0,0,0.03)" }}
    >
      <div className={`font-semibold uppercase tracking-widest ${compact ? "text-[10px]" : "text-[11px]"} ${dark ? "text-zinc-500" : "text-stone-400"}`}>{label}</div>
      <div className={`font-display mt-1 font-semibold tabular-nums ${compact ? "text-xl" : "text-3xl mt-1.5"} ${dark ? "text-zinc-50" : "text-stone-900"}`}>{value}</div>
    </Tag>
  );
}
function DashboardSection({ dark, icon: Icon, title, children }) {
  return (
    <div className="space-y-3">
      <div className={`flex items-center gap-2 text-sm font-bold uppercase tracking-widest ${dark ? "text-zinc-400" : "text-stone-500"}`}>
        <Icon size={15} className={dark ? "text-amber-400" : "text-amber-600"} />
        {title}
      </div>
      {children}
    </div>
  );
}


const NAV_ICONS = {
  vehicules: Car,
  logistique: Truck,
  dashboard: TrendingUp,
  dossiers: FileText,
  vendeurs: Users,
  permissions: Lock,
  accidentes: AlertTriangle,
};
function buildNavItems(permissions, dossierUnmatchedCount) {
  return [
    { id: "vehicules", label: "Véhicules" },
    { id: "logistique", label: "Logistique" },
    permissions.dashboard && { id: "dashboard", label: "Tableau de bord" },
    permissions.dossiers && { id: "dossiers", label: "Dossiers", count: dossierUnmatchedCount },
    permissions.accidentes && { id: "accidentes", label: "Accidentés" },
  ].filter(Boolean);
}
function Sidebar({ dark, tab, setTab, accidentCount, dossierUnmatchedCount, permissions }) {
  const items = buildNavItems(permissions, dossierUnmatchedCount);
  return (
    <nav className={`sticky top-20 flex w-56 shrink-0 flex-col gap-1 self-start rounded-2xl border p-2 ${dark ? "bg-zinc-900/60 border-zinc-800" : "bg-white border-stone-200"}`}>
      {items.map((it) => {
        const Icon = NAV_ICONS[it.id];
        const active = tab === it.id;
        return (
          <button
            key={it.id}
            onClick={() => setTab(it.id)}
            className={`flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
              active ? "bg-amber-500 text-zinc-950" : dark ? "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200" : "text-stone-500 hover:bg-stone-100 hover:text-stone-800"
            }`}
          >
            <Icon size={16} className="shrink-0" />
            <span className="flex-1 truncate text-left">{it.label}</span>
            {!!it.count && (
              <span className={`flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 text-[10px] font-bold ${active ? "bg-zinc-950/20 text-zinc-950" : "bg-rose-500 text-white"}`}>
                {it.count}
              </span>
            )}
          </button>
        );
      })}
    </nav>
  );
}

function Tabs({ dark, tab, setTab, accidentCount, dossierUnmatchedCount, permissions }) {
  const items = buildNavItems(permissions, dossierUnmatchedCount);
  return (
    <div className={`flex max-w-full gap-1 overflow-x-auto rounded-xl border p-1 ${dark ? "bg-zinc-900/60 border-zinc-800" : "bg-white border-stone-200"}`} style={{ scrollbarWidth: "none" }}>
      {items.map((it) => (
        <button
          key={it.id}
          onClick={() => setTab(it.id)}
          className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition-colors sm:px-4 ${
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

function TopBar({ dark, setDark, vendorName, onOpenPasswordModal, onLogout, onImport, onRefresh, lastSync, alertCount, onOpenAlerts, syncing, legendOpen, setLegendOpen, canImport, canManage, onOpenSettings }) {
  const [userMenuOpen, setUserMenuOpen] = useState(false);
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
      {canImport && (
        <button onClick={onImport} className={`gap-1.5 px-3 text-sm font-medium ${btnCls}`}>
          <Upload size={14} /> Importer
        </button>
      )}
      <div className="relative">
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
                <li><span className={`font-semibold ${dark ? "text-zinc-200" : "text-stone-700"}`}>Tableau de bord</span> — statistiques et tendances</li>
                <li><span className={`font-semibold ${dark ? "text-zinc-200" : "text-stone-700"}`}>Dossiers</span> — import MyAna, attribution des ventes</li>
                <li><span className={`font-semibold ${dark ? "text-zinc-200" : "text-stone-700"}`}>Accidentés</span> — véhicules signalés HS</li>
              </ul>
            </div>
          </>
        )}
      </div>
      {canManage && (
        <button onClick={onOpenSettings} className={`w-9 ${btnCls}`} title="Vendeurs, sites, rôles & permissions">
          <Settings size={16} />
        </button>
      )}
      <button onClick={() => setDark(!dark)} className={`w-9 ${btnCls}`} title={dark ? "Mode clair" : "Mode sombre"}>
        {dark ? <Sun size={16} /> : <Moon size={16} />}
      </button>
      <div className="relative">
        <button onClick={() => setUserMenuOpen((o) => !o)} className={`gap-2 px-3 text-sm font-medium ${btnCls}`}>
          <User size={14} /> {vendorName || "Compte non relié"}
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
    (filters.carrosserie !== "all" ? 1 : 0) +
    (filters.boite !== "all" ? 1 : 0) +
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
    setFilters((f) => ({ ...f, concession: "all", vu: "all", statut: "all", vendeur: "all", carrosserie: "all", boite: "all", typeVente: [] }));
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
          id="parclive-search"
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
      style={{ boxShadow: `inset 4px 0 0 ${hasAlert ? "#E11D48" : STATUS_ACCENT[v.baseStatus] || "transparent"}` }}
    >
      <td className="px-3 py-2 text-center">
        <VehicleTypeIcon vu={v.vu} dark={dark} size="sm" />
        <div className={`mt-1 truncate font-mono text-[11px] font-semibold transition-colors ${dark ? "text-zinc-300 group-hover:text-amber-400" : "text-stone-600 group-hover:text-amber-600"}`}>
          {v.orderNumber}
        </div>
      </td>
      <td className="px-2 py-2" title={v.description}>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <ModelYearLabel v={v} dark={dark} className={`truncate font-semibold ${dark ? "text-zinc-50" : "text-stone-900"}`} />
            {(isElectric || isPHEV) && (
              <Zap size={13} className={`shrink-0 ${isElectric ? (dark ? "text-sky-400" : "text-sky-600") : (dark ? "text-violet-400" : "text-violet-600")}`} aria-label={v.energy}>
                <title>{v.energy}</title>
              </Zap>
            )}
          </div>
          <div className={`truncate text-xs ${dark ? "text-zinc-400" : "text-stone-500"}`} title={meta}>{meta}</div>
        </div>
      </td>
      <td className="px-2 py-2">
        <div className="flex flex-col items-start gap-1">
          <div className="flex items-center gap-1.5">
            <StatusBadge vehicle={v} dark={dark} />
            {hasAlert && <AlertTriangle size={13} className="shrink-0 text-rose-500" />}
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
          {v.baseStatus === "reserve" && v.reservation?.vendeur && (
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



function VehicleTable({ dark, vehicles, expandedOrder, onSelect, onSave, vendorName, vendeursList }) {
  const thCls = `sticky top-0 z-10 py-2.5 text-left text-xs font-bold uppercase tracking-widest ${dark ? "bg-zinc-900 text-zinc-300 border-b-2 border-zinc-800" : "bg-stone-100 text-stone-600 border-b-2 border-stone-200"}`;
  return (
    <div className={`overflow-hidden rounded-2xl border-2 shadow-sm ${dark ? "border-zinc-800" : "border-stone-200"}`}>
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
            {vehicles.map((v, i) => {
              const isOpen = v.orderNumber === expandedOrder;
              return (
                <Fragment key={v.orderNumber}>
                  <VehicleRow v={v} dark={dark} onSelect={onSelect} expanded={isOpen} zebra={i % 2 === 1} />
                  {isOpen && (
                    <tr>
                      <td colSpan={5} className="p-0">
                        <ExpandedDetail v={v} dark={dark} onClose={() => onSelect(v)} onSave={onSave} vendorName={vendorName} vendeursList={vendeursList} />
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
        {v.baseStatus === "vendu" && (
          <span className={`flex items-center gap-1 text-xs font-medium ${dark ? "text-violet-300" : "text-violet-700"}`}>
            <User size={11} /> {venduLabel(v)}{clientLine(v) && ` · Client : ${clientLine(v)}`}
          </span>
        )}
        {v.baseStatus === "reserve" && v.reservation?.vendeur && (
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

function VehicleCardList({ dark, vehicles, expandedOrder, onSelect, onSave, vendorName, vendeursList }) {
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
                <ExpandedDetail v={v} dark={dark} onClose={() => onSelect(v)} onSave={onSave} vendorName={vendorName} vendeursList={vendeursList} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

const DONUT_COLORS_LIGHT = ["#D97706", "#0284C7", "#059669", "#DB2777", "#7C3AED", "#64748B"];
const DONUT_COLORS_DARK = ["#FBBF24", "#38BDF8", "#34D399", "#F472B6", "#A78BFA", "#94A3B8"];

function DonutCard({ dark, title, data }) {
  const colors = dark ? DONUT_COLORS_DARK : DONUT_COLORS_LIGHT;
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
                  <Cell key={i} fill={colors[i % colors.length]} />
                ))}
              </Pie>
              <Tooltip contentStyle={{ background: dark ? "#18181B" : "#fff", border: `1px solid ${gridColor}`, borderRadius: 10, fontSize: 12 }} />
            </PieChart>
          </ResponsiveContainer>
          <ul className="min-w-0 flex-1 space-y-1.5">
            {data.map((d, i) => (
              <li key={d.name} className="flex items-center gap-2 text-xs">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: colors[i % colors.length] }} />
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
    return (
      <div className={`rounded-2xl border p-8 text-center text-sm ${dark ? "border-zinc-800 bg-zinc-900/40 text-zinc-500" : "border-stone-200 bg-white text-stone-400"}`}>
        Aucun vendeur enregistré — ajoutez-en depuis l'icône réglages en haut.
      </div>
    );
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
            <tr key={r.nom} className={dark ? "hover:bg-zinc-900/60" : "hover:bg-amber-50/40"}>
              <td className={`px-4 py-2.5 font-semibold ${dark ? "text-zinc-100" : "text-stone-900"}`}>
                {i === 0 && r.total > 0 && "🥇 "}{i === 1 && r.total > 0 && "🥈 "}{i === 2 && r.total > 0 && "🥉 "}{r.nom}
              </td>
              <td className={`px-4 py-2.5 ${dark ? "text-zinc-400" : "text-stone-500"}`}>{r.site}</td>
              <td className={`${tdCls} ${dark ? "text-violet-400" : "text-violet-600"}`}>{r.ventes}</td>
              <td className={`${tdCls} ${dark ? "text-amber-400" : "text-amber-600"}`}>{r.reservations}</td>
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
            <tr key={r.concession} className={dark ? "hover:bg-zinc-900/60" : "hover:bg-amber-50/40"}>
              <td className={`px-4 py-2.5 font-semibold ${dark ? "text-zinc-100" : "text-stone-900"}`}>{r.concession}</td>
              <td className={tdCls}>{r.total}</td>
              <td className={`${tdCls} ${dark ? "text-emerald-400" : "text-emerald-600"}`}>{r.disponibles}</td>
              <td className={`${tdCls} ${dark ? "text-amber-400" : "text-amber-600"}`}>{r.reserves}</td>
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
            <Line type="monotone" dataKey="total" stroke={dark ? "#FBBF24" : "#D97706"} strokeWidth={2} dot={false} name="Total véhicules" />
            <Line type="monotone" dataKey="disponibles" stroke={dark ? "#34D399" : "#059669"} strokeWidth={2} dot={false} name="Disponibles" />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

function ExpandedDetail({ v, dark, onClose, onSave, vendorName, vendeursList }) {
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
  useEffect(() => {
    setForm(defaultForm());
    setSaved(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v.orderNumber]);

  const inputCls = `w-full rounded-lg border px-3 py-2 text-sm outline-none transition-shadow focus:ring-2 ${dark ? "bg-zinc-950 border-zinc-800 text-zinc-200 focus:ring-amber-500/30 focus:border-amber-500/40" : "bg-white border-stone-200 text-stone-700 focus:ring-amber-500/20 focus:border-amber-400"}`;

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
      className={`border-t-2 border-l-4 border-amber-500 px-5 py-5 ${dark ? "bg-zinc-950 border-t-zinc-800" : "bg-stone-50 border-t-stone-200"}`}
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
            <div className={`flex items-start gap-1.5 rounded-lg border px-2.5 py-2 text-xs font-medium ${dark ? "border-amber-800 bg-amber-500/10 text-amber-300" : "border-amber-300 bg-amber-50 text-amber-800"}`}>
              <AlertTriangle size={13} className="mt-0.5 shrink-0" /> {v.dataWarningReason}
            </div>
          )}
          <div className={`rounded-lg border p-3 text-xs leading-relaxed ${dark ? "border-zinc-800 bg-zinc-950 text-zinc-300" : "border-stone-200 bg-stone-50 text-stone-600"}`}>{v.description}</div>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-2.5 text-sm">
            <div><dt className={`text-[11px] font-medium ${dark ? "text-zinc-500" : "text-stone-400"}`}>VIN</dt><dd className={`font-mono font-medium ${dark ? "text-zinc-100" : "text-stone-800"}`}>{v.vin || "—"}</dd></div>
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
            <div className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium ${form.statut === "Réservation annulée" ? (dark ? "border-rose-800 bg-rose-500/10 text-rose-300" : "border-rose-200 bg-rose-50 text-rose-700") : (dark ? "border-amber-800 bg-amber-500/10 text-amber-300" : "border-amber-200 bg-amber-50 text-amber-700")}`}>
              <CheckCircle2 size={13} className="shrink-0" /> {form.statut === "Réservation annulée" ? "Réservation annulée" : "Réservé"}
            </div>
            <div className="flex gap-2">
              <input type="date" className={inputCls} value={form.dateDebut} onChange={(e) => setForm((f) => ({ ...f, dateDebut: e.target.value }))} />
              <input type="date" className={inputCls} value={form.dateFin} onChange={(e) => setForm((f) => ({ ...f, dateFin: e.target.value }))} />
            </div>
            <textarea className={inputCls} rows={3} placeholder="Commentaire libre" value={form.commentaire} onChange={(e) => setForm((f) => ({ ...f, commentaire: e.target.value }))} />
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button onClick={save} disabled={!form.client?.trim()} className="flex-1 rounded-lg bg-amber-500 px-3 py-2 text-sm font-bold text-zinc-950 shadow-sm transition-colors hover:bg-amber-400 disabled:opacity-40">Enregistrer</button>
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
          )}
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
      <div className={`relative max-h-[85vh] w-full overflow-y-auto rounded-2xl border p-5 ${size === "xl" ? "max-w-3xl" : "max-w-md"} ${dark ? "bg-zinc-900 border-zinc-800" : "bg-white border-stone-200"}`}>
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
              className={`flex cursor-pointer flex-wrap items-start gap-2.5 px-4 py-3 transition-colors ${dark ? "hover:bg-zinc-900/70" : "hover:bg-amber-50/40"}`}
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

function LogisticsTab({ dark, vehicles, vendeursList, sitesList, onOpenVehicle, simpleMode }) {
  const [query, setQuery] = useState("");
  const [contremarqueFilter, setContremarqueFilter] = useState("all");
  const [concessionFilter, setConcessionFilter] = useState("all");
  const [vendeurFilter, setVendeurFilter] = useState("all");
  const [siteFilter, setSiteFilter] = useState("all");
  const concessions = useMemo(() => [...new Set(vehicles.map((v) => v.concession))].filter(Boolean).sort(), [vehicles]);
  const vendeurSiteMap = useMemo(() => new Map(vendeursList.map((v) => [v.nom, v.site])), [vendeursList]);
  const vendorOf = (v) => v.venduPar || activeReservationVendeur(v);
  const q = query.trim().toLowerCase();
  const matches = (v) => {
    if (contremarqueFilter === "oui" && !v.vendu) return false;
    if (contremarqueFilter === "non" && v.vendu) return false;
    if (concessionFilter !== "all" && v.concession !== concessionFilter) return false;
    if (vendeurFilter !== "all" && vendorOf(v) !== vendeurFilter) return false;
    if (siteFilter !== "all" && (vendeurSiteMap.get(vendorOf(v)) || "") !== siteFilter) return false;
    if (!q) return true;
    return `${v.orderNumber} ${v.vin} ${v.model} ${v.typeVente} ${v.venduPar || ""} ${v.clientLabel || ""}`.toLowerCase().includes(q);
  };

  const enStock = useMemo(
    () => vehicles.filter((v) => v.inStock && matches(v)).sort((a, b) => (a.joursStock ?? 0) - (b.joursStock ?? 0)),
    [vehicles, q, contremarqueFilter, concessionFilter, vendeurFilter, siteFilter]
  );
  const enTransit = useMemo(
    () =>
      vehicles
        .filter((v) => !v.inStock && !!v.vin && matches(v))
        .sort((a, b) => (a.estRange?.end ? a.estRange.end.getTime() : Infinity) - (b.estRange?.end ? b.estRange.end.getTime() : Infinity)),
    [vehicles, q, contremarqueFilter, concessionFilter, vendeurFilter, siteFilter]
  );
  const nonSerialises = useMemo(() => vehicles.filter((v) => !v.vin && matches(v)), [vehicles, q, contremarqueFilter, concessionFilter, vendeurFilter, siteFilter]);

  const inputCls = `h-9 rounded-lg border px-3 text-sm outline-none transition-shadow focus:ring-2 ${dark ? "bg-zinc-950 border-zinc-800 text-zinc-200 focus:ring-amber-500/30" : "bg-white border-stone-200 text-stone-700 focus:ring-amber-500/20"}`;
  function chipCls(active) {
    return `rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
      active ? "bg-amber-500 text-zinc-950" : dark ? "bg-zinc-800 text-zinc-300 hover:bg-zinc-700" : "bg-stone-100 text-stone-600 hover:bg-stone-200"
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
        <select value={concessionFilter} onChange={(e) => setConcessionFilter(e.target.value)} className={inputCls}>
          <option value="all">Toutes concessions</option>
          {concessions.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
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
          onOpen={onOpenVehicle}
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
          onOpen={onOpenVehicle}
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
          onOpen={onOpenVehicle}
          renderExtra={(v) => (
            <div className="flex shrink-0 flex-col items-end gap-1">
              <span className={`text-xs font-medium ${dark ? "text-zinc-300" : "text-stone-600"}`}>{v.typeVente || "—"}</span>
              <StatusBadge vehicle={v} dark={dark} />
            </div>
          )}
        />
      </div>
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
  const dropCls = `flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-6 text-center cursor-pointer transition-colors ${dark ? "border-zinc-700 hover:border-amber-500/60 hover:bg-amber-500/5" : "border-stone-300 hover:border-amber-400 hover:bg-amber-50/50"}`;

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
      <button onClick={submit} disabled={!rows || busy} className="mt-3 w-full rounded-lg bg-amber-500 px-4 py-2.5 text-sm font-semibold text-zinc-950 transition-colors hover:bg-amber-400 disabled:opacity-40">
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
    <li className={`flex flex-wrap items-center gap-3 px-4 py-3.5 ${dark ? "hover:bg-zinc-900/70" : "hover:bg-amber-50/40"}`} style={{ boxShadow: `inset 4px 0 0 ${matched ? "transparent" : "#E11D48"}` }}>
      <div className="min-w-[130px]">
        <div className={`flex items-center gap-1.5 text-sm font-bold ${dark ? "text-amber-400" : "text-amber-700"}`}>
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
  const inputCls = `h-9 rounded-lg border px-2 text-sm outline-none transition-shadow focus:ring-2 ${dark ? "bg-zinc-950 border-zinc-800 text-zinc-200 focus:ring-amber-500/30" : "bg-white border-stone-200 text-stone-700 focus:ring-amber-500/20"}`;

  function confirm() {
    if (!ready) return;
    onAssign(v.orderNumber, { vendeur: vendeur.trim(), client: client.trim() });
  }

  return (
    <li className={`flex flex-wrap items-center gap-2 px-4 py-3 ${dark ? "hover:bg-zinc-900/70" : "hover:bg-amber-50/40"}`}>
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
      <button onClick={confirm} disabled={!ready} className="flex h-9 items-center gap-1 rounded-lg bg-amber-500 px-3 text-sm font-bold text-zinc-950 transition-colors hover:bg-amber-400 disabled:opacity-40">
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

function ManualSalesSection({ dark, vehicles, vendeursList, onAssign }) {
  const unattributed = useMemo(() => vehicles.filter((v) => v.vendu && !v.venduPar && !v.clientLabel), [vehicles]);
  const attributedManually = useMemo(() => vehicles.filter((v) => v.venduAttribManuelle), [vehicles]);
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const filtered = unattributed.filter((v) => !q || `${v.orderNumber} ${v.model} ${v.typeVente}`.toLowerCase().includes(q));
  const [attribOpen, setAttribOpen] = useState(false);
  const [attribQuery, setAttribQuery] = useState("");
  const aq = attribQuery.trim().toLowerCase();
  const attributedFiltered = attributedManually.filter(
    (v) => !aq || `${v.orderNumber} ${v.model} ${v.venduPar || ""} ${v.clientLabel || ""}`.toLowerCase().includes(aq)
  );

  return (
    <div className="space-y-3">
      <div className={`flex items-center gap-2 text-sm font-bold uppercase tracking-widest ${dark ? "text-zinc-400" : "text-stone-500"}`}>
        <User size={15} className={dark ? "text-amber-400" : "text-amber-600"} />
        Commandes vendues sans dossier MyAna
      </div>
      <p className={`text-sm ${dark ? "text-zinc-500" : "text-stone-400"}`}>
        Ces véhicules sont marqués "Vendu" d'après leur type de vente, sans dossier MyAna correspondant. Renseignez le vendeur et le nom du client, puis validez avec OK.
      </p>
      <div className={`flex h-9 items-center gap-2 rounded-lg border px-3 ${dark ? "bg-zinc-950 border-zinc-800" : "bg-stone-50 border-stone-200"}`}>
        <Search size={14} className={dark ? "text-zinc-500" : "text-stone-400"} />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Commande, modèle, type de vente…" className={`w-full bg-transparent text-sm outline-none ${dark ? "text-zinc-200 placeholder:text-zinc-600" : "text-stone-700 placeholder:text-stone-400"}`} />
      </div>
      {filtered.length === 0 ? (
        <div className={`rounded-2xl border p-8 text-center text-sm ${dark ? "border-zinc-800 bg-zinc-900/40 text-zinc-500" : "border-stone-200 bg-white text-stone-400"}`}>
          {unattributed.length === 0 ? "Toutes les ventes détectées sont attribuées." : "Aucune commande ne correspond."}
        </div>
      ) : (
        <div className={`overflow-hidden rounded-2xl border ${dark ? "border-zinc-800" : "border-stone-200"}`}>
          <ul className={`max-h-[420px] divide-y overflow-auto ${dark ? "divide-zinc-800" : "divide-stone-200"}`}>
            {filtered.map((v) => (
              <ManualSaleRow key={v.orderNumber} dark={dark} v={v} vendeursList={vendeursList} onAssign={onAssign} />
            ))}
          </ul>
        </div>
      )}
      {attributedManually.length > 0 && (
        <div className={`overflow-hidden rounded-2xl border ${dark ? "border-zinc-800" : "border-stone-200"}`}>
          <button
            onClick={() => setAttribOpen((o) => !o)}
            className={`flex w-full items-center justify-between border-b px-4 py-2.5 text-xs font-semibold uppercase tracking-widest transition-colors ${dark ? "border-zinc-800 bg-zinc-900 text-zinc-400 hover:bg-zinc-800/70" : "border-stone-200 bg-stone-100 text-stone-500 hover:bg-stone-200/70"}`}
          >
            <span>Attribuées manuellement ({attributedManually.length})</span>
            <ChevronRight size={14} className={`transition-transform ${attribOpen ? "rotate-90" : ""}`} />
          </button>
          {attribOpen && (
            <>
              <div className={`flex h-9 items-center gap-2 border-b px-3 ${dark ? "border-zinc-800 bg-zinc-950" : "border-stone-200 bg-stone-50"}`}>
                <Search size={14} className={dark ? "text-zinc-500" : "text-stone-400"} />
                <input
                  value={attribQuery}
                  onChange={(e) => setAttribQuery(e.target.value)}
                  placeholder="Commande, modèle, vendeur, client…"
                  className={`w-full bg-transparent text-sm outline-none ${dark ? "text-zinc-200 placeholder:text-zinc-600" : "text-stone-700 placeholder:text-stone-400"}`}
                />
              </div>
              {attributedFiltered.length === 0 ? (
                <div className={`p-6 text-center text-sm ${dark ? "text-zinc-500" : "text-stone-400"}`}>Aucune correspondance.</div>
              ) : (
                <ul className={`max-h-[420px] divide-y overflow-auto ${dark ? "divide-zinc-800" : "divide-stone-200"}`}>
                  {attributedFiltered.map((v) => (
                    <ManualSaleRow key={v.orderNumber} dark={dark} v={v} vendeursList={vendeursList} onAssign={onAssign} initialVendeur={v.venduPar} initialClient={v.clientLabel} isEdit />
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
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
  const inputCls = `h-9 rounded-lg border px-3 text-sm outline-none transition-shadow focus:ring-2 ${dark ? "bg-zinc-950 border-zinc-800 text-zinc-200 focus:ring-amber-500/30" : "bg-white border-stone-200 text-stone-700 focus:ring-amber-500/20"}`;

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

  const dropCls = `flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-6 text-center cursor-pointer transition-colors ${dark ? "border-zinc-700 hover:border-amber-500/60 hover:bg-amber-500/5" : "border-stone-300 hover:border-amber-400 hover:bg-amber-50/50"}`;

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
            <div className={dark ? "text-amber-400" : "text-amber-600"}>{dataWarningsCount} fiche{dataWarningsCount > 1 ? "s" : ""} véhicule à vérifier (données incomplètes)</div>
          )}
        </div>
      )}
      <button onClick={submit} disabled={!ordersRows || busy} className="w-full rounded-lg bg-amber-500 px-4 py-2.5 text-sm font-semibold text-zinc-950 transition-colors hover:bg-amber-400 disabled:opacity-40">
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

  const inputCls = `w-full rounded-lg border px-3 py-2 text-sm outline-none transition-shadow focus:ring-2 ${dark ? "bg-zinc-950 border-zinc-800 text-zinc-200 focus:ring-amber-500/30" : "bg-white border-stone-200 text-stone-700 focus:ring-amber-500/20"}`;

  return (
    <Modal dark={dark} title="Changer mon mot de passe" onClose={onClose}>
      <div className="space-y-2.5">
        <input type="password" autoFocus className={inputCls} placeholder="Nouveau mot de passe" value={pw1} onChange={(e) => setPw1(e.target.value)} />
        <input type="password" className={inputCls} placeholder="Confirmer le mot de passe" value={pw2} onChange={(e) => setPw2(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} />
        {error && <div className="text-xs font-semibold text-rose-500">{error}</div>}
        <button onClick={submit} disabled={busy} className="w-full rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-zinc-950 transition-colors hover:bg-amber-400 disabled:opacity-50">
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

  const inputCls = `h-9 rounded-lg border px-3 text-sm outline-none transition-shadow focus:ring-2 ${dark ? "bg-zinc-950 border-zinc-800 text-zinc-200 focus:ring-amber-500/30" : "bg-white border-stone-200 text-stone-700 focus:ring-amber-500/20"}`;

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
        <button onClick={submit} disabled={!name.trim()} className="flex h-9 items-center gap-1.5 rounded-lg bg-amber-500 px-3.5 text-sm font-bold text-zinc-950 transition-colors hover:bg-amber-400 disabled:opacity-40">
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
            className={`w-full rounded-lg border px-3 py-2 font-mono text-sm outline-none transition-shadow focus:ring-2 ${dark ? "bg-zinc-950 border-zinc-800 text-zinc-200 focus:ring-amber-500/30" : "bg-white border-stone-200 text-stone-700 focus:ring-amber-500/20"}`}
          />
          <div className="flex flex-wrap items-center gap-2">
            <select value={bulkSite} onChange={(e) => setBulkSite(e.target.value)} className={inputCls}>
              <option value="">— Site pour tous (optionnel) —</option>
              {sitesList.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <button onClick={submitBulk} disabled={!bulkText.trim() || bulkBusy} className="flex h-9 items-center gap-1.5 rounded-lg bg-amber-500 px-3.5 text-sm font-bold text-zinc-950 transition-colors hover:bg-amber-400 disabled:opacity-40">
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
          <button onClick={() => setSiteFilter("all")} className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${siteFilter === "all" ? "bg-amber-500 text-zinc-950" : dark ? "bg-zinc-800 text-zinc-300 hover:bg-zinc-700" : "bg-stone-100 text-stone-600 hover:bg-stone-200"}`}>
            Tous les sites
          </button>
          {sitesList.map((s) => (
            <button key={s} onClick={() => setSiteFilter(s)} className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${siteFilter === s ? "bg-amber-500 text-zinc-950" : dark ? "bg-zinc-800 text-zinc-300 hover:bg-zinc-700" : "bg-stone-100 text-stone-600 hover:bg-stone-200"}`}>
              {s}
            </button>
          ))}
        </div>
      )}

      {filtered.length === 0 ? (
        <div className={`rounded-2xl border p-10 text-center ${dark ? "border-zinc-800 bg-zinc-900/40 text-zinc-500" : "border-stone-200 bg-white text-stone-400"}`}>
          {vendeurs.length === 0 ? "Aucun vendeur enregistré pour l'instant." : "Aucun vendeur sur ce site."}
        </div>
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
  const selectCls = `h-9 rounded-lg border px-2.5 text-sm outline-none transition-shadow focus:ring-2 ${dark ? "bg-zinc-950 border-zinc-800 text-zinc-300 focus:ring-amber-500/30" : "bg-white border-stone-200 text-stone-600 focus:ring-amber-500/20"}`;
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
        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold ring-1 ${dark ? "bg-amber-500/10 text-amber-400 ring-amber-500/20" : "bg-amber-50 text-amber-700 ring-amber-200"}`}>
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
              className={`h-8 w-full rounded-lg border px-2 text-sm font-semibold outline-none focus:ring-2 ${dark ? "bg-zinc-950 border-zinc-800 text-zinc-200 focus:ring-amber-500/30" : "bg-white border-stone-200 text-stone-700 focus:ring-amber-500/20"}`}
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
                className={`h-7 min-w-[200px] flex-1 rounded-lg border px-2 text-xs outline-none focus:ring-2 ${dark ? "bg-zinc-950 border-zinc-800 text-zinc-200 focus:ring-amber-500/30" : "bg-white border-stone-200 text-stone-700 focus:ring-amber-500/20"}`}
              />
            ) : (
              <button onClick={() => { setEmailValue(v.email || ""); setEmailEditing(true); }} className={`truncate text-left text-xs hover:underline ${v.email ? (dark ? "text-zinc-400" : "text-stone-500") : "italic text-amber-500"}`}>
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
            <span className={`rounded-full px-2.5 py-1.5 text-xs font-bold ${dark ? "bg-amber-500/20 text-amber-300" : "bg-amber-100 text-amber-800"}`}>Accès complet</span>
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
            {hasOverrides && <span className={`h-1.5 w-1.5 rounded-full ${dark ? "bg-amber-400" : "bg-amber-500"}`} />}
            <Lock size={12} /> Personnaliser les permissions
            <ChevronRight size={12} className={`transition-transform ${open ? "rotate-90" : ""}`} />
          </button>
        )}
        <span className={`ml-auto text-xs font-medium ${dark ? "text-zinc-500" : "text-stone-400"}`}>{usage} vente{usage > 1 ? "s" : ""}/résa.</span>
      </div>

      {open && !superAdmin && (
        <div className={`mt-3 grid gap-2 rounded-xl border p-3 sm:grid-cols-2 ${dark ? "border-zinc-800 bg-zinc-950/50" : "border-stone-100 bg-stone-50/70"}`}>
          {PERMISSION_KEYS.map((key) => (
            <div key={key} className="flex items-center gap-2">
              <input type="checkbox" checked={!!effective[key]} onChange={(e) => onUpdatePermission(v.nom, key, e.target.checked)} className="accent-amber-500" />
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
  const inputCls = `h-9 rounded-lg border px-3 text-sm outline-none transition-shadow focus:ring-2 ${dark ? "bg-zinc-950 border-zinc-800 text-zinc-200 focus:ring-amber-500/30" : "bg-white border-stone-200 text-stone-700 focus:ring-amber-500/20"}`;
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
        <button onClick={add} disabled={!name.trim()} className="flex h-9 items-center gap-1.5 rounded-lg bg-amber-500 px-3.5 text-sm font-bold text-zinc-950 transition-colors hover:bg-amber-400 disabled:opacity-40">
          <Plus size={15} /> Ajouter
        </button>
      </div>
      {sitesList.length === 0 ? (
        <div className={`rounded-2xl border p-10 text-center ${dark ? "border-zinc-800 bg-zinc-900/40 text-zinc-500" : "border-stone-200 bg-white text-stone-400"}`}>
          Aucun site enregistré pour l'instant.
        </div>
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
                  className={`h-8 min-w-0 flex-1 rounded-lg border px-2 text-sm font-semibold outline-none focus:ring-2 ${dark ? "bg-zinc-950 border-zinc-800 text-zinc-200 focus:ring-amber-500/30" : "bg-white border-stone-200 text-stone-700 focus:ring-amber-500/20"}`}
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
  const inputCls = `h-9 w-20 rounded-lg border px-3 text-sm outline-none transition-shadow focus:ring-2 ${dark ? "bg-zinc-950 border-zinc-800 text-zinc-200 focus:ring-amber-500/30" : "bg-white border-stone-200 text-stone-700 focus:ring-amber-500/20"}`;
  const rows = [
    { key: "arriveeRecente", label: "Arrivée récente (véhicule en stock depuis moins de X jours)" },
    { key: "resaExpireBientot", label: "Réservation qui expire bientôt (dans moins de X jours)" },
    { key: "resaLongue", label: "Réservé depuis longtemps (plus de X jours)" },
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
      <button onClick={() => onUpdate(values)} className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-bold text-zinc-950 transition-colors hover:bg-amber-400">
        Enregistrer les seuils
      </button>
    </div>
  );
}

function GeneralSettingsPanel({ dark, activityLog, onExportBackup }) {
  return (
    <div className="space-y-4">
      <div>
        <div className={`mb-2 text-xs font-bold uppercase tracking-widest ${dark ? "text-zinc-400" : "text-stone-500"}`}>Sauvegarde</div>
        <button onClick={onExportBackup} className={`flex items-center gap-2 rounded-lg border px-3.5 py-2 text-sm font-semibold transition-colors ${dark ? "border-zinc-700 text-zinc-200 hover:bg-zinc-800" : "border-stone-300 text-stone-700 hover:bg-stone-100"}`}>
          <Download size={15} /> Exporter une sauvegarde complète (Excel)
        </button>
      </div>
      <div>
        <div className={`mb-2 text-xs font-bold uppercase tracking-widest ${dark ? "text-zinc-400" : "text-stone-500"}`}>Journal d'activité récente</div>
        {activityLog.length === 0 ? (
          <div className={`rounded-2xl border p-6 text-center text-sm ${dark ? "border-zinc-800 bg-zinc-900/40 text-zinc-500" : "border-stone-200 bg-white text-stone-400"}`}>
            Aucune action enregistrée pour l'instant.
          </div>
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

function SettingsPanel({ dark, vendeurs, vehicles, dossiers, sitesList, alertSettings, activityLog, onAdd, onRemove, onUpdateSite, onUpdateRole, onUpdatePermission, onRename, onUpdateEmail, onUpdateSites, onUpdateAlertSettings, onExportBackup }) {
  const [settingsTab, setSettingsTab] = useState("vendeurs");
  const items = [
    { id: "vendeurs", label: "Vendeurs", icon: Users },
    { id: "sites", label: "Sites", icon: Truck },
    { id: "alertes", label: "Alertes", icon: AlertTriangle },
    { id: "general", label: "Général", icon: Settings },
  ];
  return (
    <div className="space-y-4">
      <div className={`inline-flex gap-1 rounded-xl border p-1 ${dark ? "bg-zinc-900/60 border-zinc-800" : "bg-white border-stone-200"}`}>
        {items.map((it) => (
          <button
            key={it.id}
            onClick={() => setSettingsTab(it.id)}
            className={`flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-sm font-medium transition-colors ${
              settingsTab === it.id ? "bg-amber-500 text-zinc-950" : dark ? "text-zinc-400 hover:text-zinc-200" : "text-stone-500 hover:text-stone-800"
            }`}
          >
            <it.icon size={14} />
            {it.label}
          </button>
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
      ) : (
        <GeneralSettingsPanel dark={dark} activityLog={activityLog} onExportBackup={onExportBackup} />
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
        <div className={`rounded-2xl border p-10 text-center ${dark ? "border-zinc-800 bg-zinc-900/40 text-zinc-500" : "border-stone-200 bg-white text-stone-400"}`}>
          Aucun véhicule accidenté ajouté pour l'instant.
        </div>
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
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-4">
      <div
        className={`pointer-events-auto flex items-center gap-3 rounded-xl border px-4 py-2.5 text-sm font-medium shadow-lg ${
          isError
            ? dark
              ? "bg-rose-950 border-rose-800 text-rose-200"
              : "bg-rose-50 border-rose-200 text-rose-800"
            : dark
            ? "bg-zinc-900 border-zinc-700 text-zinc-100"
            : "bg-zinc-900 border-zinc-800 text-white"
        }`}
      >
        {isError ? <AlertTriangle size={15} className="shrink-0" /> : <CheckCircle2 size={15} className="shrink-0 text-emerald-400" />}
        <span>{toast.message}</span>
        {toast.action && (
          <button onClick={() => { toast.action.onClick(); onDismiss(); }} className="ml-1 shrink-0 rounded-md bg-amber-500 px-2.5 py-1 text-xs font-bold text-zinc-950 hover:bg-amber-400">
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

  const inputCls = `w-full rounded-lg border px-3 py-2.5 text-center text-sm outline-none transition-shadow focus:ring-2 ${dark ? "bg-zinc-950 border-zinc-800 text-zinc-200 focus:ring-amber-500/30" : "bg-white border-stone-200 text-stone-700 focus:ring-amber-500/20"}`;

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
        {mode === "login" ? (
          <>
            <p className={`mb-4 mt-1 text-sm ${dark ? "text-zinc-500" : "text-stone-400"}`}>Connectez-vous avec votre adresse professionnelle.</p>
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
            <button onClick={submit} disabled={checking} className="mt-3 w-full rounded-lg bg-amber-500 px-4 py-2.5 text-sm font-bold text-zinc-950 transition-colors hover:bg-amber-400 disabled:opacity-50">
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
                <button onClick={submitReset} disabled={checking} className="mt-3 w-full rounded-lg bg-amber-500 px-4 py-2.5 text-sm font-bold text-zinc-950 transition-colors hover:bg-amber-400 disabled:opacity-50">
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

  const inputCls = `w-full rounded-lg border px-3 py-2.5 text-center text-sm outline-none transition-shadow focus:ring-2 ${dark ? "bg-zinc-950 border-zinc-800 text-zinc-200 focus:ring-amber-500/30" : "bg-white border-stone-200 text-stone-700 focus:ring-amber-500/20"}`;

  return (
    <div className="flex min-h-[520px] items-center justify-center p-6">
      <div className={`w-full max-w-sm rounded-2xl border p-6 text-center shadow-sm ${dark ? "bg-zinc-900 border-zinc-800" : "bg-white border-stone-200"}`}>
        <div className="mb-4 flex justify-center">
          <span className={`flex h-12 w-12 items-center justify-center rounded-full ring-1 ${dark ? "bg-amber-500/10 text-amber-400 ring-amber-500/20" : "bg-amber-50 text-amber-700 ring-amber-200"}`}>
            <Lock size={20} />
          </span>
        </div>
        <div className={`font-display text-lg font-semibold ${dark ? "text-zinc-50" : "text-stone-900"}`}>Nouveau mot de passe</div>
        <p className={`mb-4 mt-1 text-sm ${dark ? "text-zinc-500" : "text-stone-400"}`}>Choisissez votre nouveau mot de passe.</p>
        <input type="password" autoFocus className={inputCls} placeholder="Nouveau mot de passe" value={pw1} onChange={(e) => setPw1(e.target.value)} />
        <input type="password" className={`mt-2 ${inputCls}`} placeholder="Confirmer" value={pw2} onChange={(e) => setPw2(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} />
        {error && <div className="mt-2 text-xs font-semibold text-rose-500">{error}</div>}
        <button onClick={submit} disabled={busy} className="mt-3 w-full rounded-lg bg-amber-500 px-4 py-2.5 text-sm font-bold text-zinc-950 transition-colors hover:bg-amber-400 disabled:opacity-50">
          {busy ? "Mise à jour…" : "Valider"}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main app
// ---------------------------------------------------------------------------
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

export default function App() {
  const [dark, setDark] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const [dbStatus, setDbStatus] = useState("checking");
  const [authEmail, setAuthEmail] = useState("");
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
  const [dossiersMeta, setDossiersMeta] = useState(null);
  const [lastSync, setLastSync] = useState(null);
  const [importOpen, setImportOpen] = useState(false);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [legendOpen, setLegendOpen] = useState(false);
  const [showWelcome, setShowWelcome] = useState(() => !loadLocal("dsr:welcome-seen", false));
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [selected, setSelected] = useState(() => {
    const saved = loadLocal("dsr:ui-selected", null);
    return saved ? { orderNumber: saved } : null;
  });
  const [resetConfirm, setResetConfirm] = useState(false);
  const [tab, setTab] = useState(() => loadLocal("dsr:ui-tab", "vehicules"));
  const [filters, setFilters] = useState(() =>
    loadLocal("dsr:ui-filters", { concession: "all", typeVente: [], vu: "all", statut: "all", vendeur: "all", carrosserie: "all", boite: "all", query: "" })
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
  const lastRawRef = useRef({});
  const refreshAll = useCallback(async (indicate) => {
    if (indicate) setSyncing(true);
    const versionBefore = localWriteVersionRef.current;
    const [o, s, ov, meta, acc, doss, dossMeta, vends, manual, sites, alertCfg, log] = await Promise.all([
      sGet(STORE_KEYS.orders, true),
      sGet(STORE_KEYS.stock, true),
      sGet(STORE_KEYS.overlays, true),
      sGet(STORE_KEYS.meta, true),
      sGet(STORE_KEYS.accidents, true),
      sGet(STORE_KEYS.dossiers, true),
      sGet(STORE_KEYS.dossiersMeta, true),
      sGet(STORE_KEYS.vendeurs, true),
      sGet(STORE_KEYS.manualSales, true),
      sGet(STORE_KEYS.sites, true),
      sGet(STORE_KEYS.alertSettings, true),
      sGet(STORE_KEYS.activityLog, true),
    ]);
    const raw = lastRawRef.current;
    const changed = (key, value) => {
      if (raw[key] === value) return false;
      raw[key] = value;
      return true;
    };
    if (o && changed("orders", o)) setOrdersData(JSON.parse(o));
    if (s && changed("stock", s)) setStockData(JSON.parse(s));
    if (meta && changed("meta", meta)) setImportMeta(JSON.parse(meta));
    if (dossMeta && changed("dossMeta", dossMeta)) setDossiersMeta(JSON.parse(dossMeta));
    if (sites && changed("sites", sites)) setSitesList(JSON.parse(sites));
    if (alertCfg && changed("alertCfg", alertCfg)) setAlertSettings({ ...DEFAULT_ALERT_SETTINGS, ...JSON.parse(alertCfg) });
    if (log && changed("log", log)) setActivityLog(JSON.parse(log));
    // Skip overwriting locally-edited stores if a save happened while this fetch was in flight —
    // the fetch may have captured data from just before that save committed. The next poll (8s later)
    // will pick up the now-committed version.
    if (versionBefore === localWriteVersionRef.current) {
      if (changed("overlays", ov || "")) setOverlays(ov ? JSON.parse(ov) : {});
      if (changed("accidents", acc || "")) setAccidents(acc ? JSON.parse(acc) : []);
      if (changed("dossiers", doss || "")) setDossiersData(doss ? JSON.parse(doss) : []);
      if (vends && changed("vendeurs", vends)) setVendeursList(JSON.parse(vends).map(normalizeVendeur));
      if (changed("manualSales", manual || "")) setManualSales(manual ? JSON.parse(manual) : {});
    }
    setLastSync(new Date());
    if (indicate) setSyncing(false);
  }, []);

  useEffect(() => {
    (async () => {
      const t = await sGet(STORE_KEYS.theme, false);
      if (t) setDark(t === "dark");
      sGet(STORE_KEYS.vendeurs, true).then((v) => v && setVendeursList(JSON.parse(v).map(normalizeVendeur)));

      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user?.email) {
        setAuthEmail(session.user.email);
        setUnlocked(true);

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

        Promise.all([
          sGet(STORE_KEYS.accidents, true),
          sGet(STORE_KEYS.dossiers, true),
          sGet(STORE_KEYS.dossiersMeta, true),
          sGet(STORE_KEYS.manualSales, true),
          sGet(STORE_KEYS.sites, true),
          sGet(STORE_KEYS.alertSettings, true),
          sGet(STORE_KEYS.activityLog, true),
        ]).then(([acc2, doss, dossMeta, manual, sites, alertCfg, log]) => {
          setAccidents(acc2 ? JSON.parse(acc2) : []);
          setDossiersData(doss ? JSON.parse(doss) : []);
          if (dossMeta) setDossiersMeta(JSON.parse(dossMeta));
          setManualSales(manual ? JSON.parse(manual) : {});
          if (sites) setSitesList(JSON.parse(sites));
          if (alertCfg) setAlertSettings({ ...DEFAULT_ALERT_SETTINGS, ...JSON.parse(alertCfg) });
          if (log) setActivityLog(JSON.parse(log));
        });
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
      } else if (session?.user?.email) {
        setAuthEmail(session.user.email);
        setUnlocked(true);
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
      showToast(`Import réussi — ${orders.length} commandes, ${stock.length} en stock`);
      logActivity(`Import véhicules — ${orders.length} commandes, ${stock.length} en stock`);
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
    const next = { ...freshOverlays, [orderNumber]: { ...current, reservation: form, history } };
    await sSet(STORE_KEYS.overlays, JSON.stringify(next), true);
    setOverlays(next);
    localWriteVersionRef.current++;
    if (form.statut === "Réservation annulée") logActivity(`Annulation réservation — commande ${orderNumber}`);
    else if (!old.statut) logActivity(`Nouvelle réservation — commande ${orderNumber} pour ${form.client || "client inconnu"}`);
  }


  async function handleImportDossiers({ rows, fileName }) {
    const dossiers = rows.map(toDossierRecord).filter((d) => d.numero || d.numeroUsine || d.vendeur);
    const meta = { importedAt: new Date().toISOString(), count: dossiers.length, fileName };
    const results = await Promise.all([
      sSet(STORE_KEYS.dossiers, JSON.stringify(dossiers), true),
      sSet(STORE_KEYS.dossiersMeta, JSON.stringify(meta), true),
    ]);
    const ok = results.every(Boolean);
    if (ok) {
      setDossiersData(dossiers);
      setDossiersMeta(meta);
      showToast(`Import réussi — ${dossiers.length} dossiers`);
      logActivity(`Import dossiers MyAna — ${dossiers.length} dossiers`);

      const foundNames = [...new Set(dossiers.map((d) => d.vendeur).filter(Boolean))];
      const freshVendeursRaw = await sGet(STORE_KEYS.vendeurs, true);
      const freshVendeurs = freshVendeursRaw ? JSON.parse(freshVendeursRaw).map(normalizeVendeur) : [];
      const lowerExisting = new Set(freshVendeurs.map((v) => v.nom.toLowerCase()));
      const newNames = foundNames.filter((n) => !lowerExisting.has(n.toLowerCase()));
      if (newNames.length > 0) {
        const newOnes = newNames.map((n) => {
          const localisation = dossiers.find((d) => d.vendeur === n)?.localisation || "";
          const matchedSite = sitesList.find((s) => localisation && s.toLowerCase().includes(localisation.toLowerCase()));
          return { nom: n, site: matchedSite || "" };
        });
        const merged = [...freshVendeurs, ...newOnes];
        await sSet(STORE_KEYS.vendeurs, JSON.stringify(merged), true);
        setVendeursList(merged);
        showToast(`${newOnes.length} nouveau${newOnes.length > 1 ? "x" : ""} vendeur${newOnes.length > 1 ? "s" : ""} ajouté${newOnes.length > 1 ? "s" : ""} depuis l'import`);
      }
    }
    return ok;
  }

  const pendingAccidentDeleteRef = useRef(null);
  const pendingVendeurDeleteRef = useRef(null);

  async function patchVendeursList(updater) {
    const freshRaw = await sGet(STORE_KEYS.vendeurs, true);
    const fresh = freshRaw ? JSON.parse(freshRaw).map(normalizeVendeur) : [];
    const next = updater(fresh);
    const ok = await sSet(STORE_KEYS.vendeurs, JSON.stringify(next), true);
    setVendeursList(next);
    localWriteVersionRef.current++;
    return ok;
  }

  async function handleAddVendeur(name, site) {
    const freshRaw = await sGet(STORE_KEYS.vendeurs, true);
    const fresh = freshRaw ? JSON.parse(freshRaw).map(normalizeVendeur) : [];
    if (fresh.some((v) => v.nom.toLowerCase() === name.toLowerCase())) {
      showToast(`${name} est déjà dans la liste`, { type: "error" });
      return;
    }
    const ok = await patchVendeursList(() => [...fresh, { nom: name, site: site || "" }]);
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
    const freshRaw = await sGet(STORE_KEYS.activityLog, true);
    const fresh = freshRaw ? JSON.parse(freshRaw) : [];
    const next = [entry, ...fresh].slice(0, 200);
    await sSet(STORE_KEYS.activityLog, JSON.stringify(next), true);
    setActivityLog(next);
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

  async function handleRenameVendeur(oldName, newName) {
    const clean = newName.trim();
    if (!clean || clean === oldName) return;
    const freshVendeursRaw = await sGet(STORE_KEYS.vendeurs, true);
    const freshVendeurs = freshVendeursRaw ? JSON.parse(freshVendeursRaw).map(normalizeVendeur) : [];
    if (freshVendeurs.some((v) => v.nom.toLowerCase() === clean.toLowerCase())) {
      showToast(`${clean} existe déjà dans la liste`, { type: "error" });
      return;
    }
    const nextVendeurs = freshVendeurs.map((v) => (v.nom === oldName ? { ...v, nom: clean } : v));
    const okV = await sSet(STORE_KEYS.vendeurs, JSON.stringify(nextVendeurs), true);
    setVendeursList(nextVendeurs);

    const freshOverlaysRaw = await sGet(STORE_KEYS.overlays, true);
    const freshOverlays = freshOverlaysRaw ? JSON.parse(freshOverlaysRaw) : {};
    const nextOverlays = {};
    Object.entries(freshOverlays).forEach(([orderNumber, ov]) => {
      const nov = { ...ov };
      if (nov.reservation?.vendeur === oldName) nov.reservation = { ...nov.reservation, vendeur: clean };
      nextOverlays[orderNumber] = nov;
    });
    await sSet(STORE_KEYS.overlays, JSON.stringify(nextOverlays), true);
    setOverlays(nextOverlays);

    const freshManualRaw = await sGet(STORE_KEYS.manualSales, true);
    const freshManual = freshManualRaw ? JSON.parse(freshManualRaw) : {};
    const nextManual = {};
    Object.entries(freshManual).forEach(([orderNumber, ms]) => {
      const m = typeof ms === "string" ? { vendeur: ms, client: "" } : ms;
      nextManual[orderNumber] = m.vendeur === oldName ? { ...m, vendeur: clean } : m;
    });
    await sSet(STORE_KEYS.manualSales, JSON.stringify(nextManual), true);
    setManualSales(nextManual);

    localWriteVersionRef.current++;
    if (okV) showToast(`${oldName} renommé en ${clean}`);
    else showToast("Échec de l'enregistrement — vérifiez la connexion à la base de données", { type: "error" });
  }

  async function handleAssignManualSale(orderNumber, patch) {
    const key = normalizeOrderNum(orderNumber);
    const freshRaw = await sGet(STORE_KEYS.manualSales, true);
    const fresh = freshRaw ? JSON.parse(freshRaw) : {};
    const next = { ...fresh };
    const existing = fresh[key];
    const existingObj = typeof existing === "string" ? { vendeur: existing, client: "" } : existing || { vendeur: "", client: "" };
    const merged = { ...existingObj, ...patch };
    if (merged.vendeur || merged.client) next[key] = merged;
    else delete next[key];
    const ok = await sSet(STORE_KEYS.manualSales, JSON.stringify(next), true);
    setManualSales(next);
    localWriteVersionRef.current++;
    if (ok) showToast(merged.vendeur || merged.client ? `Commande ${orderNumber} mise à jour` : `Attribution retirée pour ${orderNumber}`);
    else showToast("Échec de l'enregistrement — vérifiez la connexion à la base de données", { type: "error" });
  }

  async function commitVendeurDelete(name) {
    const freshRaw = await sGet(STORE_KEYS.vendeurs, true);
    const fresh = freshRaw ? JSON.parse(freshRaw).map(normalizeVendeur) : [];
    const next = fresh.filter((v) => v.nom !== name);
    await sSet(STORE_KEYS.vendeurs, JSON.stringify(next), true);
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
    const freshRaw = await sGet(STORE_KEYS.accidents, true);
    const fresh = freshRaw ? JSON.parse(freshRaw) : [];
    const next = fresh.filter((a) => a.id !== id);
    await sSet(STORE_KEYS.accidents, JSON.stringify(next), true);
  }

  async function handleAddAccident({ orderNumber, note, addedBy }) {
    const now = new Date();
    const freshRaw = await sGet(STORE_KEYS.accidents, true);
    const fresh = freshRaw ? JSON.parse(freshRaw) : [];
    const next = [
      { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, orderNumber, note, addedBy, addedAt: now.toLocaleDateString("fr-FR") },
      ...fresh,
    ];
    const ok = await sSet(STORE_KEYS.accidents, JSON.stringify(next), true);
    setAccidents(next);
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
    const dossierByOrder = new Map();
    dossiersData.forEach((d) => {
      if ((d.categorie || "").toUpperCase().trim() === "VD") return;
      const key = normalizeOrderNum(d.numeroUsine);
      if (key && !dossierByOrder.has(key)) dossierByOrder.set(key, d);
    });
    const accidentedOrders = new Set(accidents.map((a) => normalizeOrderNum(a.orderNumber)));
    return ordersData
      .map((o) =>
        buildVehicle(
          o,
          stockByOrder.get(o.orderNumber) || null,
          overlays[o.orderNumber] || null,
          dossierByOrder.get(normalizeOrderNum(o.orderNumber)) || null,
          accidentedOrders.has(normalizeOrderNum(o.orderNumber)),
          manualSales[normalizeOrderNum(o.orderNumber)] || null,
          alertSettings
        )
      )
      .filter((v) => v.baseStatus !== "livre_client");
  }, [ordersData, stockData, overlays, dossiersData, accidents, manualSales, alertSettings]);

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
    setFilters((f) => ({ ...f, concession: "all", typeVente: [], vu: "all", statut: "all", vendeur: "all", carrosserie: "all", boite: "all", query: "", ...patch }));
  }

  const stats = useMemo(() => computeStats(vehicles), [vehicles]);

  const concessions = useMemo(() => [...new Set(vehicles.map((v) => v.concession))].filter(Boolean).sort(), [vehicles]);
  const typeVentes = useMemo(() => [...new Set(vehicles.map((v) => v.typeVente))].filter(Boolean).sort(), [vehicles]);
  const vendeurs = useMemo(() => [...new Set(vehicles.map((v) => activeReservationVendeur(v)).filter(Boolean))].sort(), [vehicles]);

  const filtered = useMemo(() => {
    const terms = filters.query.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean);
    let list = vehicles.filter((v) => {
      if (filters.concession !== "all" && v.concession !== filters.concession) return false;
      if (filters.typeVente.length > 0 && !filters.typeVente.includes(v.typeVente)) return false;
      if (filters.vu === "vp" && v.vu) return false;
      if (filters.vu === "vu" && !v.vu) return false;
      if (filters.statut !== "all" && v.baseStatus !== filters.statut) return false;
      if (filters.vendeur !== "all" && activeReservationVendeur(v) !== filters.vendeur) return false;
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
    return list;
  }, [vehicles, filters, sortBy]);

  const totalAlerts = useMemo(() => vehicles.reduce((n, v) => n + v.alerts.length, 0), [vehicles]);
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
  const permissions = useMemo(() => getPermissions(vendorName, vendeursList), [vendorName, vendeursList]);

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
    const vehicleSite = (v) => {
      const nom = v.venduPar || activeReservationVendeur(v);
      return nom ? siteByVendeur.get(nom) : null;
    };
    return vehicles.filter((v) => {
      const site = vehicleSite(v);
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
    if (tab === "vendeurs" || tab === "permissions") { setTab("vehicules"); return; }
    const gated = { dossiers: permissions.dossiers, accidentes: permissions.accidentes, dashboard: permissions.dashboard };
    if (tab in gated && !gated[tab]) setTab("vehicules");
  }, [tab, permissions]);

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
      className={`mx-auto w-full max-w-[1500px] overflow-hidden rounded-2xl border font-sans ${dark ? "border-zinc-800 bg-zinc-950" : "border-stone-200 bg-stone-50"}`}
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
            <button onClick={handleLogout} className="w-full rounded-lg bg-amber-500 px-4 py-2.5 text-sm font-bold text-zinc-950 transition-colors hover:bg-amber-400">
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
        canManage={permissions.vendeurs}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      {dbStatus === "error" && (
        <div className={`flex items-center gap-2 px-4 py-2 text-xs font-semibold md:px-6 ${dark ? "bg-rose-500/15 text-rose-300" : "bg-rose-50 text-rose-700"}`}>
          <AlertTriangle size={13} /> Connexion à la base de données impossible — vérifiez que la table Supabase existe (voir README) et que la clé API est correcte. Rien ne sera sauvegardé tant que ce n'est pas résolu.
        </div>
      )}
      {showWelcome && vendorName && (
        <div className={`flex flex-wrap items-center gap-2 px-4 py-2 text-xs font-medium md:px-6 ${dark ? "bg-amber-500/10 text-amber-300" : "bg-amber-50 text-amber-800"}`}>
          <Info size={13} className="shrink-0" />
          <span>
            Bienvenue {vendorName} — vous êtes connecté avec le rôle <span className="font-semibold">{isSuperAdmin(vendorName) ? "Accès complet" : (findVendeur(vendeursList, vendorName)?.role || "Vendeur")}</span>.
            {" "}Certaines fonctionnalités sont réservées aux rôles de gestion.
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
        <div className="p-4 md:p-6">
          <div className="mb-6 lg:hidden">
            <Tabs dark={dark} tab={tab} setTab={setTab} accidentCount={accidents.length} dossierUnmatchedCount={dossiers.filter((d) => !d.vehicle).length} permissions={permissions} />
          </div>
          <div className="flex items-start gap-6">
            <div className="hidden lg:block">
              <Sidebar
                dark={dark}
                tab={tab}
                setTab={setTab}
                accidentCount={accidents.length}
                dossierUnmatchedCount={dossiers.filter((d) => !d.vehicle).length}
                permissions={permissions}
              />
            </div>
            <div className="min-w-0 flex-1 space-y-6">

          {tab === "logistique" ? (
            <LogisticsTab dark={dark} vehicles={logisticsVehicles} vendeursList={mySiteScope ? vendeursList.filter((v) => v.site === mySiteScope) : vendeursList} sitesList={sitesList} onOpenVehicle={openInVehicules} simpleMode={myRole === "Vendeur" && !!mySiteScope} />
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
                  <BarListCard dark={dark} title="Par type de vente" data={dashboardStats.byTypeVente.slice(0, 8)} color={dark ? "#FBBF24" : "#D97706"} />
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
            <div className="space-y-8">
              <div className="space-y-4">
                {dossiers.length > 0 ? (
                  <DossierList dark={dark} dossiers={dossiers} onExport={exportDossiersToExcel} />
                ) : (
                  <div className={`rounded-2xl border p-8 text-center text-sm ${dark ? "border-zinc-800 bg-zinc-900/40 text-zinc-500" : "border-stone-200 bg-white text-stone-400"}`}>
                    Aucun dossier importé pour l'instant — utilisez le bouton <span className="font-semibold">Importer</span> en haut de la page pour charger le fichier MyAna.
                  </div>
                )}
              </div>
              <ManualSalesSection dark={dark} vehicles={vehicles} vendeursList={vendeursList} onAssign={handleAssignManualSale} />
            </div>
          ) : (
            <>
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
                <VehicleTable dark={dark} vehicles={filtered} expandedOrder={expandedOrder} onSelect={toggleExpand} onSave={handleReservationSave} vendorName={vendorName} vendeursList={vendeursList} />
              </div>
              <div className="lg:hidden">
                <VehicleCardList dark={dark} vehicles={filtered} expandedOrder={expandedOrder} onSelect={toggleExpand} onSave={handleReservationSave} vendorName={vendorName} vendeursList={vendeursList} />
              </div>
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
      {settingsOpen && (
        <Modal dark={dark} title="Réglages" onClose={() => setSettingsOpen(false)} size="xl">
          <SettingsPanel
            dark={dark}
            vendeurs={vendeursList}
            vehicles={vehicles}
            dossiers={dossiers}
            sitesList={sitesList}
            alertSettings={alertSettings}
            activityLog={activityLog}
            onAdd={handleAddVendeur}
            onRemove={handleRemoveVendeur}
            onUpdateSite={handleUpdateVendeurSite}
            onUpdateRole={handleUpdateVendeurRole}
            onUpdatePermission={handleUpdateVendeurPermission}
            onRename={handleRenameVendeur}
            onUpdateEmail={handleUpdateVendeurEmail}
            onUpdateSites={handleUpdateSites}
            onUpdateAlertSettings={handleUpdateAlertSettings}
            onExportBackup={() => exportFullBackup(vehicles, dossiers, vendeursList)}
          />
        </Modal>
      )}
        </>
      )}
      <Toast dark={dark} toast={toast} onDismiss={() => setToast(null)} />
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
