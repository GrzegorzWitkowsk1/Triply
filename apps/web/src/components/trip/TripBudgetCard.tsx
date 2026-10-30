import { formatMoney, decimalInput } from "../../i18n/format";
import { errorKey as localizedErrorKey, resolveMessage } from "../../i18n/errors";
import { expenseCategoryLabel } from "../../i18n/labels";
import { errorMessage as localizedError } from "../../i18n/errors";
import { useTranslation } from "react-i18next";
import i18n from "../../i18n";
import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { DeleteOutlined, KeyboardArrowDown } from "@mui/icons-material";
import { Alert, Button, IconButton, MenuItem, TextField, Tooltip } from "@mui/material";
import {
  decimalToMinor, expenseInputSchema, EXPENSE_CATEGORIES, EXPENSE_CATEGORY_LABELS,
  type ExpenseCategory, type ItineraryDay, type SpendingTotal, type TripAttraction, type TripBudgetData,
} from "@triply/shared";
import { useTripBudget } from "../../hooks/useTripBudget";
import type { BudgetSlice } from "../../config/trip";

interface TripBudgetCardProps {
  tripId?: string;
  budgetData?: TripBudgetData;
  days?: ItineraryDay[];
  activeDayIndex?: number;
  attractions?: TripAttraction[];
  whole: number;
  spent?: number | null;
  breakdown?: BudgetSlice[] | null;
  currencySymbol?: string;
}

const CATEGORY_COLORS: Record<ExpenseCategory, string> = {
  attractions: "#8064a2", food_drinks: "#eb995b", transport: "#6d9bcc",
  accommodation: "#68a68b", shopping: "#bc7ca0", other: "#999999",
};

function combinedAmount(total?: SpendingTotal): number | null {
  const amount = BigInt(total?.plannedMinor ?? 0) + BigInt(total?.actualMinor ?? 0);
  return amount <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(amount) : null;
}

function spendingLabel(totals: SpendingTotal[]): string {
  return totals.map(total => {
    const amount = combinedAmount(total);
    return amount === null ? i18n.t("amountUnavailable", { ns: "expenses", value0: total.currency }) : formatMoney(amount, total.currency);
  }).join(" · ") || "—";
}

export default function TripBudgetCard(props: TripBudgetCardProps) {
  const { t } = useTranslation("expenses", { i18n });
  if (props.tripId) return <PersistentBudgetCard key={props.tripId} {...props} tripId={props.tripId} />;
  return <section className="trip-card budget-card">
    <div className="trip-card-head">
      <h3>{t("title")}</h3>
      <span className="budget-total">{props.currencySymbol ?? "€"}{props.spent ?? 0} <em>/ {props.currencySymbol ?? "€"}{props.whole}</em></span>
    </div>
  </section>;
}

function PersistentBudgetCard({ tripId, budgetData, days = [], activeDayIndex }: TripBudgetCardProps & { tripId: string }) {
  const { t } = useTranslation("expenses", { i18n });
  const { query, mutation } = useTripBudget(tripId);
  const data = query.data ?? budgetData;
  const summary = data?.summary;
  const currency = summary?.currency;
  const defaultDayId = String(days.find(day => day.dayIndex === activeDayIndex)?.dayIndex ?? days[0]?.dayIndex ?? "");
  const [selectedDayId, setSelectedDayId] = useState(defaultDayId);
  const dayId = days.some(day => String(day.dayIndex) === selectedDayId) ? selectedDayId : defaultDayId;
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState<ExpenseCategory>(EXPENSE_CATEGORIES[0]);
  const [error, setError] = useState<string | null>(null);
  const [invalidAmount, setInvalidAmount] = useState(false);
  const amountInput = useRef<HTMLInputElement>(null);
  const [perDayOpen, setPerDayOpen] = useState(false);
  const requestId = useRef(crypto.randomUUID());
  const currentDefaultDayId = useRef(defaultDayId);
  currentDefaultDayId.current = defaultDayId;
  useEffect(() => {
    setSelectedDayId(defaultDayId);
    requestId.current = crypto.randomUUID();
  }, [defaultDayId]);
  const submitting = useRef(false);
  const expenses = [...(data?.expenses ?? [])].reverse().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const ownTotal = summary?.totals.find(total => total.currency === currency);
  const total = combinedAmount(ownTotal);
  const hasOtherCurrencies = summary?.totals.some(value => value.currency !== currency) ?? false;
  const spentLabel = hasOtherCurrencies ? spendingLabel(summary!.totals)
    : currency && total !== null ? formatMoney(total, currency) : "—";
  const budgetLabel = currency && summary?.totalBudgetMinor !== null && summary?.totalBudgetMinor !== undefined
    ? formatMoney(summary.totalBudgetMinor, currency) : "—";
  const categories = (summary?.categories ?? []).flatMap(item => {
    const amountMinor = combinedAmount(item.totals.find(value => value.currency === currency));
    return amountMinor !== null && amountMinor > 0 ? [{ ...item, amountMinor }] : [];
  });
  const chartWhole = Math.max(summary?.totalBudgetMinor ?? 0, total ?? 0, 1);
  const chartAvailable = Boolean(currency) && !hasOtherCurrencies && total !== null;
  const busy = mutation.isPending;

  const changeDraft = () => { requestId.current = crypto.randomUUID(); setError(null); setInvalidAmount(false); };
  const addExpense = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!data || !currency || !title.trim() || !amount.trim() || submitting.current) return;
    submitting.current = true; setError(null);
    try {
      let expense;
      try {
        expense = expenseInputSchema.parse({ title, category, amountMinor: decimalToMinor(decimalInput(amount.trim()), currency), currency, type: "actual", dayId: dayId || null });
      } catch {
        setError("errors:validation");
        setInvalidAmount(true); amountInput.current?.focus();
        return;
      }
      await mutation.mutateAsync({ type: "create", expense, id: requestId.current, revision: data.revision });
      setTitle(""); setAmount(""); setCategory(EXPENSE_CATEGORIES[0]); requestId.current = crypto.randomUUID();
      setSelectedDayId(currentDefaultDayId.current);
    } catch (failure) {
      setError(localizedErrorKey(failure));
    } finally { submitting.current = false; }
  };
  const deleteExpense = async (id: string) => {
    if (!data || submitting.current) return;
    submitting.current = true; setError(null);
    try { await mutation.mutateAsync({ type: "delete", id, revision: data.revision }); }
    catch (failure) { setError(localizedErrorKey(failure)); }
    finally { submitting.current = false; }
  };

  return <section className="trip-card budget-card">
    <div className="trip-card-head">
      <h3>{t("title")}</h3>
      <span className="budget-total" aria-label={i18n.t("totalExpensesAndBudget", { ns: "expenses" })}>{spentLabel} <em>/ {budgetLabel}</em></span>
    </div>
    <div className="budget-chart" aria-label={i18n.t("expensesByCategory", { ns: "expenses" })}>
      {chartAvailable && categories.map(item => <Tooltip key={item.category} title={`${expenseCategoryLabel(item.category)} · ${formatMoney(item.amountMinor, currency!)}`} placement="top" arrow>
        <span className="budget-segment" role="img" tabIndex={0} aria-label={`${expenseCategoryLabel(item.category)}: ${formatMoney(item.amountMinor, currency!)}`}
          style={{ background: CATEGORY_COLORS[item.category], width: `${item.amountMinor / chartWhole * 100}%` }} />
      </Tooltip>)}
    </div>
    {hasOtherCurrencies && <p className="budget-note">{i18n.t("expensesInDifferentCurrenciesAreShownSeparately", { ns: "expenses" })}</p>}
    {summary?.hasIncompletePricing && <p className="budget-note">{i18n.t("unconfirmedPrices", { ns: "expenses", count: summary.unknownAdmissionPriceCount })}</p>}
    {currency && total !== null && summary?.totalBudgetMinor !== null && summary?.totalBudgetMinor !== undefined && total > summary.totalBudgetMinor &&
      <p className="budget-note is-over-budget">{i18n.t("overBudget", { ns: "expenses", amount: formatMoney(total - summary.totalBudgetMinor, currency) })}</p>}
    {query.isLoading && !data && <p role="status" className="budget-note">{i18n.t("loadingExpenses", { ns: "expenses" })}</p>}
    {query.isError && <Alert severity="error">{i18n.t("couldNotLoadExpenses", { ns: "expenses" })}<Button onClick={() => void query.refetch()}>{i18n.t("retryExpenses", { ns: "expenses" })}</Button></Alert>}
    {error && <Alert severity="error">{resolveMessage(error)}</Alert>}

    <ul className="budget-list budget-expenses" aria-label={i18n.t("expenses", { ns: "expenses" })}>
      {expenses.map(expense => <li key={expense.id} className="budget-expense-row" style={{ "--expense-color": CATEGORY_COLORS[expense.category] } as CSSProperties}>
        <span className="budget-dot" aria-hidden="true" />
        <div className="budget-expense-description">
          <span className="budget-expense-title">{expense.title}</span>
          <span className="budget-expense-category">{expenseCategoryLabel(expense.category)}</span>
        </div>
        <span className="budget-amount">{formatMoney(expense.amountMinor, expense.currency)}</span>
        <IconButton size="small" className="budget-delete" aria-label={i18n.t("delete", { ns: "expenses", value0: expense.title })} disabled={busy} onClick={() => void deleteExpense(expense.id)}>
          <DeleteOutlined fontSize="small" />
        </IconButton>
      </li>)}
      {data && expenses.length === 0 && <li className="budget-empty">{i18n.t("noExpensesYet", { ns: "expenses" })}</li>}
    </ul>

    <div className="budget-per-day">
      <button type="button" className="budget-per-day-toggle" aria-expanded={perDayOpen} aria-controls={`budget-days-${tripId}`} onClick={() => setPerDayOpen(value => !value)}>
        <span>{i18n.t("perDaySpending", { ns: "expenses" })}</span><KeyboardArrowDown fontSize="small" />
      </button>
      {perDayOpen && <div className="budget-days" id={`budget-days-${tripId}`}>
        {(summary?.days ?? []).map(day => <div key={day.dayId ?? "unassigned"} className="budget-day">
          <div className="budget-day-head">
            <span>{day.dayId === null ? i18n.t("unassigned", { ns: "expenses" }) : i18n.t("day", { ns: "expenses", value0: day.dayId })}
              {day.dayId && days.find(value => String(value.dayIndex) === day.dayId)?.date && <small>{days.find(value => String(value.dayIndex) === day.dayId)!.date}</small>}
            </span>
            <strong>{spendingLabel(day.totals)}</strong>
          </div>
          <div className="budget-day-categories">{day.categories.filter(item => item.totals.some(value => value.plannedMinor > 0 || value.actualMinor > 0)).map(item =>
            <div key={item.category} className="budget-day-category" style={{ "--expense-color": CATEGORY_COLORS[item.category] } as CSSProperties}>
              <span className="budget-dot" aria-hidden="true" /><span>{expenseCategoryLabel(item.category)}</span><strong>{spendingLabel(item.totals)}</strong>
            </div>)}
            {day.totals.length === 0 && <span className="budget-note">{i18n.t("noExpensesAssigned", { ns: "expenses" })}</span>}
          </div>
        </div>)}
        {!summary?.days.length && <p className="budget-note">{i18n.t("noPerDayExpensesYet", { ns: "expenses" })}</p>}
      </div>}
    </div>

    <form className="budget-expense-form" aria-busy={busy} onSubmit={event => void addExpense(event)}>
      <div className="budget-form-name-row">
        <TextField fullWidth size="small" label={t("expenseName")} placeholder={t("expenseName")} value={title} disabled={busy}
          slotProps={{ htmlInput: { get "aria-label"() { return i18n.t("expenseName", { ns: "expenses" }); }, maxLength: 120 } }}
          onChange={event => { changeDraft(); setTitle(event.target.value); }} />
        <TextField select fullWidth size="small" label={t("tripDay")} value={dayId} disabled={busy || days.length === 0}
          slotProps={{ select: { inputProps: { get "aria-label"() { return i18n.t("tripDay", { ns: "expenses" }); } } } }}
          onChange={event => { changeDraft(); setSelectedDayId(event.target.value); }}>
          {days.map(day => <MenuItem key={day.dayIndex} value={String(day.dayIndex)}>{i18n.t("dayLabel", { ns: "common", day: day.dayIndex })}</MenuItem>)}
          {days.length === 0 && <MenuItem value="">—</MenuItem>}
        </TextField>
      </div>
      <div className="budget-form-row">
        <TextField select fullWidth size="small" label={i18n.t("category", { ns: "common" })} value={category} disabled={busy}
          slotProps={{ select: { inputProps: { get "aria-label"() { return i18n.t("category", { ns: "common" }); } } } }}
          onChange={event => { changeDraft(); setCategory(event.target.value as ExpenseCategory); }}>
          {EXPENSE_CATEGORIES.map(value => <MenuItem key={value} value={value}>{expenseCategoryLabel(value)}</MenuItem>)}
        </TextField>
        <TextField fullWidth size="small" label={t("amount")} inputRef={amountInput} error={invalidAmount}
          helperText={invalidAmount ? i18n.t("validation", { ns: "errors" }) : undefined}
          placeholder={currency ? i18n.t("amount2", { ns: "expenses", value0: currency }) : t("amount")} value={amount} disabled={busy}
          slotProps={{ htmlInput: { get "aria-label"() { return i18n.t("amount", { ns: "expenses" }); }, inputMode: "decimal" } }}
          onChange={event => { changeDraft(); setAmount(event.target.value); }} />
      </div>
      {!currency && data && <p className="budget-note">{i18n.t("setATripBudgetCurrencyToAddExpenses", { ns: "expenses" })}</p>}
      <Button fullWidth type="submit" variant="contained" color="primary" disableElevation disabled={!title.trim() || !amount.trim() || !currency || !data || query.isError || busy}>
        {busy && mutation.variables?.type === "create" ? i18n.t("addingExpense", { ns: "expenses" }) : i18n.t("addExpense", { ns: "expenses" })}
      </Button>
    </form>
  </section>;
}
