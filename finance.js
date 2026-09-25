/* ============================================================
   finance.js — gross → net earnings estimate
   ------------------------------------------------------------
   Models the common Italian "regime forfettario" shape used by
   most freelance professionals:
     reddito imponibile = fatturato lordo × coefficiente di redditività
     contributi previdenziali = imponibile × aliquota contributi
     base imposta = imponibile − contributi versati
     imposta sostitutiva = base imposta × aliquota imposta sostitutiva
     netto stimato = fatturato − contributi − imposta sostitutiva

   All three rates are editable in Impostazioni — this is an
   estimate to plan around, not a substitute for a commercialista,
   and it does not model every regime (e.g. ENPAP has its own
   fixed-contribution structure rather than a pure percentage).
   ============================================================ */

function computeNetEstimate(grossTotal, settings) {
  const coeff = settings.coefficienteRedditivita;
  const aliqContrib = settings.aliquotaContributi;
  const aliqImposta = settings.aliquotaImpostaSostitutiva;

  const imponibile = grossTotal * coeff;
  const contributi = imponibile * aliqContrib;
  const baseImposta = Math.max(0, imponibile - contributi);
  const impostaSostitutiva = baseImposta * aliqImposta;
  const netto = grossTotal - contributi - impostaSostitutiva;

  return {
    lordo: grossTotal,
    imponibile,
    contributi,
    impostaSostitutiva,
    netto: Math.max(0, netto),
  };
}

function eventDurationHours(evt) {
  const [sh, sm] = evt.start.split(':').map(Number);
  const [eh, em] = evt.end.split(':').map(Number);
  return Math.max(0, ((eh * 60 + em) - (sh * 60 + sm)) / 60);
}

function eventGross(evt, categoriesById) {
  const rate = (evt.rateGross != null && evt.rateGross !== '')
    ? Number(evt.rateGross)
    : Number((categoriesById[evt.categoryId] || {}).defaultRateGross || 0);
  return rate * eventDurationHours(evt);
}

function fmtEUR(n) {
  return (n || 0).toLocaleString('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
}
function fmtEURprecise(n) {
  return (n || 0).toLocaleString('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 });
}
