"use strict";

/**
 * Tarif résidentiel économique (Tarif 20, puissance <= 3,3 kW),
 * basé sur les tarifs ORE publiés.
 *
 * Les tranches sont cumulatives sur le mois :
 * - T1 : 0 à 130 kWh, 340 Ar/kWh
 * - T2 : 130 à 300 kWh, 560 Ar/kWh
 * - T3 : au-delà de 300 kWh, 764 Ar/kWh
 *
 * La TVA est une estimation appliquée au cumul taxable :
 * exonération jusqu'à 100 kWh/mois, puis 20 % sur le cumul taxable.
 */
const MODEL = Object.freeze({
  bands: [
    { limit: 130, rate: 340 },
    { limit: 300, rate: 560 },
    { limit: Infinity, rate: 764 }
  ],
  fixedRatePerKw: 3018,
  monthlyFee: 8000,
  communalRate: 0.06,
  surtaxRate: 0.04,
  fneRate: 0.0125,
  vatRate: 0.20,
  vatExemptKwh: 100,
  maxPurchaseKwh: 1000,
  maxPriorKwh: 5000,
  maxBudget: 2000000
});

const state = {
  mode: "kwh",
  currentResult: null,
  history: loadHistory()
};

const $ = (id) => document.getElementById(id);
const elements = {
  root: document.documentElement,
  themeToggle: $("themeToggle"),
  tabs: [...document.querySelectorAll(".segment")],
  form: $("purchaseForm"),
  meterNumber: $("meterNumber"),
  meterError: $("meterError"),
  purchaseDate: $("purchaseDate"),
  monthLabel: $("monthLabel"),
  amountInput: $("amountInput"),
  amountLabel: $("amountLabel"),
  amountUnit: $("amountUnit"),
  amountHelp: $("amountHelp"),
  amountError: $("amountError"),
  rangeHint: $("rangeHint"),
  quickValues: $("quickValues"),
  priorKwh: $("priorKwh"),
  subscribedPower: $("subscribedPower"),
  chargesAlreadyPaid: $("chargesAlreadyPaid"),
  chargesHelp: $("chargesHelp"),
  arrears: $("arrears"),
  inferHistory: $("inferHistory"),
  summaryTitle: $("summaryTitle"),
  monthlyPosition: $("monthlyPosition"),
  totalAmount: $("totalAmount"),
  budgetRemainder: $("budgetRemainder"),
  energyValue: $("energyValue"),
  consumptionValue: $("consumptionValue"),
  fixedValue: $("fixedValue"),
  feeValue: $("feeValue"),
  localTaxValue: $("localTaxValue"),
  vatValue: $("vatValue"),
  arrearsValue: $("arrearsValue"),
  communalTax: $("communalTax"),
  surtax: $("surtax"),
  fneTax: $("fneTax"),
  vatTax: $("vatTax"),
  band1Value: $("band1Value"),
  band2Value: $("band2Value"),
  band3Value: $("band3Value"),
  historyList: $("historyList"),
  clearHistory: $("clearHistory"),
  dialog: $("receiptDialog"),
  closeDialog: $("closeDialog"),
  tokenValue: $("tokenValue"),
  receiptMeter: $("receiptMeter"),
  receiptDate: $("receiptDate"),
  receiptEnergy: $("receiptEnergy"),
  receiptTotal: $("receiptTotal"),
  copyToken: $("copyToken"),
  newSimulation: $("newSimulation"),
  toast: $("toast")
};

const ariaryFormatter = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const energyFormatter = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const monthFormatter = new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric" });
const dateFormatter = new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium" });

function roundMoney(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

function formatAriary(value) {
  return `${ariaryFormatter.format(roundMoney(value))} Ar`;
}

function formatEnergy(value) {
  return `${energyFormatter.format(Math.max(0, value))} kWh`;
}

function parseLocalDate(value) {
  const safe = /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : new Date().toISOString().slice(0, 10);
  return new Date(`${safe}T12:00:00`);
}

function monthKey(dateValue) {
  return String(dateValue || "").slice(0, 7);
}

function bandCumulative(kwh) {
  const safe = Math.max(0, kwh);
  const t1 = Math.min(safe, 130);
  const t2 = Math.min(Math.max(safe - 130, 0), 170);
  const t3 = Math.max(safe - 300, 0);
  return [
    { kwh: t1, amount: t1 * 340 },
    { kwh: t2, amount: t2 * 560 },
    { kwh: t3, amount: t3 * 764 }
  ];
}

function cumulativeBill(rawKwh, context, includeMonthlyCharges) {
  const kwh = clamp(rawKwh, 0, MODEL.maxPriorKwh + MODEL.maxPurchaseKwh);
  const bands = bandCumulative(kwh);
  const consumption = bands.reduce((sum, band) => sum + band.amount, 0);
  const fixedCharge = includeMonthlyCharges ? context.power * MODEL.fixedRatePerKw : 0;
  const fee = includeMonthlyCharges ? MODEL.monthlyFee : 0;
  const communalTax = consumption * MODEL.communalRate;
  const surtax = consumption * MODEL.surtaxRate;
  const fne = consumption * MODEL.fneRate;
  const preVat = consumption + fixedCharge + fee + communalTax + surtax + fne;
  const exemptBase = MODEL.vatExemptKwh * MODEL.bands[0].rate;
  const vat = kwh > MODEL.vatExemptKwh ? Math.max(0, preVat - exemptBase) * MODEL.vatRate : 0;

  return {
    kwh,
    bands,
    consumption: roundMoney(consumption),
    fixedCharge: roundMoney(fixedCharge),
    fee: roundMoney(fee),
    communalTax: roundMoney(communalTax),
    surtax: roundMoney(surtax),
    fne: roundMoney(fne),
    vat: roundMoney(vat),
    total: roundMoney(preVat + vat)
  };
}

function currentContext() {
  return {
    priorKwh: clamp(elements.priorKwh.value, 0, MODEL.maxPriorKwh),
    power: clamp(elements.subscribedPower.value, 0, 100),
    chargesAlreadyPaid: elements.chargesAlreadyPaid.checked,
    arrears: clamp(elements.arrears.value, 0, 5000000),
    purchaseDate: elements.purchaseDate.value
  };
}

function subtractBand(after, before) {
  return {
    kwh: Math.max(0, roundMoney(after.kwh - before.kwh)),
    amount: Math.max(0, roundMoney(after.amount - before.amount))
  };
}

function calculatePurchaseByKwh(rawPurchaseKwh, context = currentContext()) {
  const purchaseKwh = clamp(rawPurchaseKwh, 0, MODEL.maxPurchaseKwh);
  if (purchaseKwh <= 0) {
    return emptyResult(context);
  }

  const beforeHasCharges = context.priorKwh > 0 || context.chargesAlreadyPaid;
  const before = cumulativeBill(context.priorKwh, context, beforeHasCharges);
  const after = cumulativeBill(context.priorKwh + purchaseKwh, context, true);
  const bands = after.bands.map((band, index) => subtractBand(band, before.bands[index]));

  const result = {
    kwh: purchaseKwh,
    priorKwh: context.priorKwh,
    afterKwh: context.priorKwh + purchaseKwh,
    bands,
    consumption: roundMoney(after.consumption - before.consumption),
    fixedCharge: roundMoney(after.fixedCharge - before.fixedCharge),
    fee: roundMoney(after.fee - before.fee),
    communalTax: roundMoney(after.communalTax - before.communalTax),
    surtax: roundMoney(after.surtax - before.surtax),
    fne: roundMoney(after.fne - before.fne),
    vat: roundMoney(after.vat - before.vat),
    arrears: roundMoney(context.arrears)
  };
  result.localTaxes = roundMoney(result.communalTax + result.surtax + result.fne);
  result.totalTax = roundMoney(result.localTaxes + result.vat);
  result.total = roundMoney(result.consumption + result.fixedCharge + result.fee + result.totalTax + result.arrears);
  return result;
}

function emptyResult(context) {
  return {
    kwh: 0,
    priorKwh: context.priorKwh,
    afterKwh: context.priorKwh,
    bands: [{ kwh: 0, amount: 0 }, { kwh: 0, amount: 0 }, { kwh: 0, amount: 0 }],
    consumption: 0,
    fixedCharge: 0,
    fee: 0,
    communalTax: 0,
    surtax: 0,
    fne: 0,
    vat: 0,
    arrears: 0,
    localTaxes: 0,
    totalTax: 0,
    total: 0
  };
}

function calculateByBudget(rawBudget, context = currentContext()) {
  const budget = clamp(rawBudget, 0, MODEL.maxBudget);
  const minimum = calculatePurchaseByKwh(0.01, context);
  if (budget < minimum.total) {
    return { ...emptyResult(context), budget, remainder: budget };
  }

  let low = 0;
  let high = MODEL.maxPurchaseKwh;
  for (let i = 0; i < 80; i += 1) {
    const mid = (low + high) / 2;
    if (calculatePurchaseByKwh(mid, context).total <= budget) low = mid;
    else high = mid;
  }

  const kwh = Math.floor(low * 100) / 100;
  const result = calculatePurchaseByKwh(kwh, context);
  return { ...result, budget, remainder: roundMoney(Math.max(0, budget - result.total)) };
}

function currentCalculation() {
  const value = Number(elements.amountInput.value);
  const context = currentContext();
  return state.mode === "kwh" ? calculatePurchaseByKwh(value, context) : calculateByBudget(value, context);
}

function updateSummary() {
  const result = currentCalculation();
  state.currentResult = result;

  elements.summaryTitle.textContent = state.mode === "kwh" ? formatEnergy(result.kwh) : `${formatEnergy(result.kwh)} estimés`;
  elements.monthlyPosition.textContent = `Position mensuelle : ${formatEnergy(result.priorKwh)} → ${formatEnergy(result.afterKwh)}`;
  elements.totalAmount.textContent = formatAriary(result.total);
  elements.energyValue.textContent = formatEnergy(result.kwh);
  elements.consumptionValue.textContent = formatAriary(result.consumption);
  elements.fixedValue.textContent = formatAriary(result.fixedCharge);
  elements.feeValue.textContent = formatAriary(result.fee);
  elements.localTaxValue.textContent = formatAriary(result.localTaxes);
  elements.vatValue.textContent = formatAriary(result.vat);
  elements.arrearsValue.textContent = formatAriary(result.arrears);
  elements.communalTax.textContent = formatAriary(result.communalTax);
  elements.surtax.textContent = formatAriary(result.surtax);
  elements.fneTax.textContent = formatAriary(result.fne);
  elements.vatTax.textContent = formatAriary(result.vat);
  elements.band1Value.textContent = `${formatEnergy(result.bands[0].kwh)} · ${formatAriary(result.bands[0].amount)}`;
  elements.band2Value.textContent = `${formatEnergy(result.bands[1].kwh)} · ${formatAriary(result.bands[1].amount)}`;
  elements.band3Value.textContent = `${formatEnergy(result.bands[2].kwh)} · ${formatAriary(result.bands[2].amount)}`;

  if (state.mode === "price") {
    elements.budgetRemainder.hidden = false;
    elements.budgetRemainder.textContent = result.kwh > 0
      ? `Reste estimé : ${formatAriary(result.remainder)}`
      : `Budget insuffisant : minimum ${formatAriary(calculatePurchaseByKwh(0.01).total)}`;
  } else {
    elements.budgetRemainder.hidden = true;
  }

  updateMonthLabel();
  updateChargesState();
}

function setMode(mode) {
  state.mode = mode;
  elements.tabs.forEach((tab) => {
    const active = tab.dataset.mode === mode;
    tab.classList.toggle("is-active", active);
    tab.setAttribute("aria-selected", String(active));
  });

  if (mode === "kwh") {
    elements.amountLabel.textContent = "Quantité souhaitée";
    elements.amountUnit.textContent = "kWh";
    elements.amountInput.min = "1";
    elements.amountInput.max = String(MODEL.maxPurchaseKwh);
    elements.amountInput.step = "1";
    elements.amountInput.value = "50";
    elements.rangeHint.textContent = "1 à 1 000 kWh";
    elements.amountHelp.textContent = "La quantité est ventilée dans les tranches restantes du mois.";
    renderQuickValues([25, 50, 100, 150], "kWh", 50);
  } else {
    elements.amountLabel.textContent = "Budget disponible";
    elements.amountUnit.textContent = "Ar";
    elements.amountInput.min = "1000";
    elements.amountInput.max = String(MODEL.maxBudget);
    elements.amountInput.step = "100";
    elements.amountInput.value = "50000";
    elements.rangeHint.textContent = "1 000 à 2 000 000 Ar";
    elements.amountHelp.textContent = "Le budget couvre les charges, taxes et un éventuel arriéré, puis le maximum de kWh possible.";
    renderQuickValues([25000, 50000, 75000, 100000], "Ar", 50000);
  }
  clearErrors();
  updateSummary();
}

function renderQuickValues(values, unit, selectedValue) {
  elements.quickValues.innerHTML = values.map((value) => {
    const label = unit === "Ar" ? `${new Intl.NumberFormat("fr-FR").format(value)} Ar` : `${value} kWh`;
    return `<button type="button" data-value="${value}" class="${value === selectedValue ? "is-selected" : ""}">${label}</button>`;
  }).join("");
}

function updateMonthLabel() {
  const date = parseLocalDate(elements.purchaseDate.value);
  elements.monthLabel.textContent = `Tranches de ${monthFormatter.format(date)}`;
}

function updateChargesState() {
  const prior = Number(elements.priorKwh.value) || 0;
  if (prior > 0) {
    elements.chargesAlreadyPaid.checked = true;
    elements.chargesAlreadyPaid.disabled = true;
    elements.chargesHelp.textContent = "Considérées comme déjà prélevées puisqu’un achat existe dans ce mois.";
  } else {
    elements.chargesAlreadyPaid.disabled = false;
    elements.chargesHelp.textContent = "À cocher uniquement si elles ont été payées sans achat de kWh.";
  }
}

function clearErrors() {
  elements.meterError.textContent = "";
  elements.amountError.textContent = "";
}

function validateForm() {
  clearErrors();
  const meter = elements.meterNumber.value.trim();
  const amount = Number(elements.amountInput.value);
  let valid = true;

  if (meter && !/^\d{8,16}$/.test(meter)) {
    elements.meterError.textContent = "Saisissez entre 8 et 16 chiffres, ou laissez vide pour la démo.";
    valid = false;
  }

  const min = Number(elements.amountInput.min);
  const max = Number(elements.amountInput.max);
  if (!Number.isFinite(amount) || amount < min || amount > max) {
    elements.amountError.textContent = state.mode === "kwh"
      ? "Saisissez une quantité comprise entre 1 et 1 000 kWh."
      : "Saisissez un budget compris entre 1 000 et 2 000 000 Ar.";
    valid = false;
  }

  if (state.mode === "price" && currentCalculation().kwh <= 0) {
    elements.amountError.textContent = "Ce budget ne couvre pas les charges, taxes et l'éventuel arriéré.";
    valid = false;
  }
  return valid;
}

function inferFromHistory() {
  const meter = elements.meterNumber.value.trim();
  const month = monthKey(elements.purchaseDate.value);
  if (!meter) {
    showToast("Renseignez d’abord le numéro de compteur");
    return;
  }
  const total = state.history
    .filter((item) => item.meter === meter && monthKey(item.purchaseDate) === month)
    .reduce((sum, item) => sum + Number(item.kwh || 0), 0);
  elements.priorKwh.value = String(roundMoney(total));
  updateSummary();
  showToast(total > 0 ? `${formatEnergy(total)} retrouvés pour ce mois` : "Aucun achat local retrouvé pour ce mois");
}

function generateToken() {
  const digits = Array.from({ length: 20 }, () => Math.floor(Math.random() * 10)).join("");
  return digits.match(/.{1,4}/g).join(" ");
}

function submitSimulation(event) {
  event.preventDefault();
  if (!validateForm()) return;

  const result = currentCalculation();
  const meter = elements.meterNumber.value.trim() || "Compteur de démonstration";
  const token = generateToken();
  const record = {
    id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
    meter,
    kwh: result.kwh,
    total: result.total,
    token,
    purchaseDate: elements.purchaseDate.value,
    createdAt: new Date().toISOString()
  };

  state.history = [record, ...state.history].slice(0, 12);
  saveHistory();
  renderHistory();

  elements.tokenValue.textContent = token;
  elements.receiptMeter.textContent = meter;
  elements.receiptDate.textContent = dateFormatter.format(parseLocalDate(elements.purchaseDate.value));
  elements.receiptEnergy.textContent = formatEnergy(result.kwh);
  elements.receiptTotal.textContent = formatAriary(result.total);
  elements.dialog.showModal();
}

function loadHistory() {
  try {
    const stored = JSON.parse(localStorage.getItem("jirama-sim-history-v2") || "[]");
    return Array.isArray(stored) ? stored : [];
  } catch {
    return [];
  }
}

function saveHistory() {
  localStorage.setItem("jirama-sim-history-v2", JSON.stringify(state.history));
}

function renderHistory() {
  elements.clearHistory.hidden = state.history.length === 0;
  if (!state.history.length) {
    elements.historyList.innerHTML = `
      <div class="empty-state">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 2h9l4 4v16H6z"/><path d="M14 2v5h5M9 12h6m-6 4h6"/></svg>
        <p>Aucune simulation enregistrée.</p>
      </div>`;
    return;
  }

  elements.historyList.innerHTML = state.history.map((item) => {
    const date = dateFormatter.format(parseLocalDate(item.purchaseDate || item.createdAt.slice(0, 10)));
    return `
      <article class="history-item">
        <div>
          <strong>${escapeHtml(item.meter)}</strong>
          <span>${formatEnergy(item.kwh)} · Jeton ${escapeHtml(item.token.slice(-9))}</span>
        </div>
        <time datetime="${escapeHtml(item.purchaseDate || item.createdAt)}">${date}</time>
        <span class="history-total">${formatAriary(item.total)}</span>
      </article>`;
  }).join("");
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
  })[character]);
}

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("is-visible");
  window.clearTimeout(showToast.timeoutId);
  showToast.timeoutId = window.setTimeout(() => elements.toast.classList.remove("is-visible"), 2200);
}

function initTheme() {
  const stored = localStorage.getItem("jirama-sim-theme");
  const preferred = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  elements.root.dataset.theme = stored || preferred;
}

function toggleTheme() {
  const next = elements.root.dataset.theme === "dark" ? "light" : "dark";
  elements.root.dataset.theme = next;
  localStorage.setItem("jirama-sim-theme", next);
}

function initDate() {
  elements.purchaseDate.value = new Date().toISOString().slice(0, 10);
}

const reactiveInputs = [elements.amountInput, elements.purchaseDate, elements.priorKwh, elements.subscribedPower, elements.chargesAlreadyPaid, elements.arrears];
reactiveInputs.forEach((input) => input.addEventListener("input", updateSummary));
elements.tabs.forEach((tab) => tab.addEventListener("click", () => setMode(tab.dataset.mode)));
elements.quickValues.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-value]");
  if (!button) return;
  elements.amountInput.value = button.dataset.value;
  [...elements.quickValues.children].forEach((item) => item.classList.toggle("is-selected", item === button));
  updateSummary();
});
elements.inferHistory.addEventListener("click", inferFromHistory);
elements.form.addEventListener("submit", submitSimulation);
elements.themeToggle.addEventListener("click", toggleTheme);
elements.closeDialog.addEventListener("click", () => elements.dialog.close());
elements.newSimulation.addEventListener("click", () => { elements.dialog.close(); elements.amountInput.focus(); });
elements.copyToken.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(elements.tokenValue.textContent.replaceAll(" ", ""));
    showToast("Jeton fictif copié");
  } catch {
    showToast("Copie indisponible dans ce navigateur");
  }
});
elements.clearHistory.addEventListener("click", () => {
  state.history = [];
  saveHistory();
  renderHistory();
  showToast("Historique effacé");
});
elements.dialog.addEventListener("click", (event) => { if (event.target === elements.dialog) elements.dialog.close(); });

initTheme();
initDate();
renderQuickValues([25, 50, 100, 150], "kWh", 50);
renderHistory();
updateSummary();
