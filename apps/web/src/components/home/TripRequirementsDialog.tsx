import { resolveMessage } from "../../i18n/errors";
import { interestLabel as localizedInterest, paceLabel } from "../../i18n/labels";
import { useTranslation } from "react-i18next";
import i18n from "../../i18n";
import { zodResolver } from "@hookform/resolvers/zod";
import { AddOutlined, CloseOutlined } from "@mui/icons-material";
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  MenuItem,
  TextField,
} from "@mui/material";
import { useEffect, useMemo, useRef, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import {
  addDays,
  diffDaysInclusive,
  isIsoDate,
  PACE_OPTIONS,
  type AskableField,
  type TripAnalysis,
  type UpdateTripRequirements,
} from "@triply/shared";
import {
  BUDGET_SUGGESTIONS,
  BUDGET_TYPE_OPTIONS,
  CUSTOM_BUDGET_ID,
  CUSTOM_BUDGET_OPTION,
  CURRENCY_OPTIONS,
  DATE_FIELDS_HINT,
  FIELD_COPY,
  INTEREST_OPTIONS,
  NOTES_HELPER,
  NOTES_TITLE,
  PACE_TITLE,
  WALKING_HELPER,
  WALKING_TITLE,
  interestIcon,
} from "../../config/tripAnalysis";
import {
  buildRequirementsPayload,
  createRequirementsDefaultValues,
  createRequirementsSchema,
  type TripRequirementsFormValues,
} from "../../schemas/tripAnalysis";

interface TripRequirementsDialogProps {
  maxTripDays?: number;
  mode?: "complete" | "edit";
  open: boolean;
  analysis: TripAnalysis;
  missingFields: AskableField[];
  isSaving: boolean;
  error: string | null;
  onSave: (payload: UpdateTripRequirements) => void;
  onClose: () => void;
}

export default function TripRequirementsDialog({
  maxTripDays,
  mode = "complete",
  open,
  analysis,
  missingFields,
  isSaving,
  error,
  onSave,
  onClose,
}: TripRequirementsDialogProps) {
  const { t } = useTranslation("tripCreator", { i18n });
  const needs = (field: AskableField): boolean => missingFields.includes(field);
  const needsDates =
    needs("startDate") || needs("endDate") || needs("durationDays");

  const schema = useMemo(
    () => createRequirementsSchema(missingFields),
    [missingFields],
  );

  const {
    register,
    control,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isValid },
  } = useForm<TripRequirementsFormValues>({
    resolver: zodResolver(schema),
    mode: "onChange",
    defaultValues: createRequirementsDefaultValues(analysis),
  });

  const [interestDraft, setInterestDraft] = useState("");

  const endDateAutoFilledRef = useRef(false);
  const lastAutoEndDateRef = useRef<string | null>(null);

  const startDate = watch("startDate");
  const endDate = watch("endDate");
  const durationDaysValue = watch("durationDays");

  const hasRange =
    isIsoDate(startDate) && isIsoDate(endDate) && endDate >= startDate;
  const derivedDurationDays = hasRange ? diffDaysInclusive(startDate, endDate) : null;
  const durationTooLong = maxTripDays !== undefined && (derivedDurationDays ?? Number(durationDaysValue)) > maxTripDays;

  useEffect(() => {
    if (derivedDurationDays === null) {
      return;
    }

    setValue("durationDays", String(derivedDurationDays), {
      shouldValidate: true,
      shouldDirty: true,
    });
  }, [derivedDurationDays, setValue]);

  useEffect(() => {
    if (!isIsoDate(startDate)) {
      endDateAutoFilledRef.current = false;
      lastAutoEndDateRef.current = null;
      return;
    }

    const duration = Number(durationDaysValue.trim());
    const durationIsValid = Number.isInteger(duration) && duration > 0 && duration <= 365;

    if (!durationIsValid) {
      return;
    }

    if (endDateAutoFilledRef.current && isIsoDate(endDate) && endDate === lastAutoEndDateRef.current) {
      const nextEndDate = addDays(startDate, duration - 1);
      if (nextEndDate !== endDate) {
        lastAutoEndDateRef.current = nextEndDate;
        setValue("endDate", nextEndDate, { shouldValidate: true, shouldDirty: true });
      }
      return;
    }

    if (!isIsoDate(endDate) || endDate === lastAutoEndDateRef.current) {
      const nextEndDate = addDays(startDate, duration - 1);
      lastAutoEndDateRef.current = nextEndDate;
      endDateAutoFilledRef.current = true;
      setValue("endDate", nextEndDate, { shouldValidate: true, shouldDirty: true });
    }
  }, [startDate, durationDaysValue, endDate, setValue]);

  const submit = handleSubmit((values) => {
    if (durationTooLong) return;
    onSave(buildRequirementsPayload(values, missingFields));
  });

  const addInterest = (raw: string) => {
    const interest = raw.trim().toLowerCase();

    if (!interest) {
      return;
    }

    const current = watch("interests");

    if (!current.includes(interest)) {
      setValue("interests", [...current, interest], {
        shouldValidate: true,
        shouldDirty: true,
      });
    }

    setInterestDraft("");
  };

  return (
    <Dialog
      open={open}
      onClose={isSaving ? undefined : onClose}
      fullWidth
      maxWidth="sm"
      className="requirements-dialog"
    >
      <form onSubmit={submit} className="requirements-form">
        <DialogTitle className="requirements-title">
          {t(mode === "edit" ? "editDetailsTitle" : "detailsTitle")}
          <IconButton
            aria-label={t("close", { ns: "common" })}
            onClick={onClose}
            disabled={isSaving}
            className="requirements-close"
          >
            <CloseOutlined />
          </IconButton>
        </DialogTitle>

        <DialogContent className="requirements-content">
          <p className="requirements-lead">
            {mode === "edit"
              ? i18n.t("updateYourDestinationDatesOrPreferencesBeforeTrying", { ns: "tripCreator/fields" })
              : i18n.t("yourRequestDidnTCoverEverythingFillIn", { ns: "tripCreator/fields" })}
          </p>

          {needs("destination") && (
            <TextField
              label={FIELD_COPY.destination.title}
              helperText={
                (errors.destination?.message ? i18n.t(errors.destination?.message!) : undefined) ?? FIELD_COPY.destination.helper
              }
              error={!!errors.destination}
              fullWidth
              {...register("destination")}
            />
          )}

          {needs("country") && (
            <TextField
              label={FIELD_COPY.country.title}
              helperText={(errors.country?.message ? i18n.t(errors.country?.message!) : undefined) ?? FIELD_COPY.country.helper}
              error={!!errors.country}
              fullWidth
              {...register("country")}
            />
          )}

          {needsDates && (
            <div className="requirements-group">
              <div className="requirements-row">
                {needs("startDate") && (
                  <TextField
                    label={FIELD_COPY.startDate.title}
                    type="date"
                    fullWidth
                    error={!!errors.startDate}
                    helperText={(errors.startDate?.message ? i18n.t(errors.startDate?.message!) : undefined)}
                    slotProps={{ inputLabel: { shrink: true } }}
                    {...register("startDate")}
                  />
                )}

                {needs("endDate") && (
                  <TextField
                    label={FIELD_COPY.endDate.title}
                    type="date"
                    fullWidth
                    error={!!errors.endDate}
                    helperText={(errors.endDate?.message ? i18n.t(errors.endDate?.message!) : undefined)}
                    slotProps={{ inputLabel: { shrink: true } }}
                    {...register("endDate", {
                      onChange: (event) => {
                        endDateAutoFilledRef.current = false;
                        lastAutoEndDateRef.current = null;
                        return event.target.value;
                      },
                    })}
                  />
                )}
              </div>

              {needsDates && (
                <TextField
                  label={FIELD_COPY.durationDays.title}
                  type="number"
                  fullWidth
                  disabled={hasRange && !endDateAutoFilledRef.current}
                  error={!!errors.durationDays}
                  helperText={
                    (errors.durationDays?.message ? i18n.t(errors.durationDays?.message!) : undefined) ??
                    (hasRange
                      ? endDateAutoFilledRef.current
                        ? FIELD_COPY.durationDays.helper
                        : i18n.t("calculatedFromYourDates", { ns: "tripCreator/fields" })
                      : FIELD_COPY.durationDays.helper)
                  }
                  slotProps={{ htmlInput: { min: 1, max: 365 } }}
                  {...register("durationDays")}
                />
              )}

              <p className="requirements-hint">{i18n.t(DATE_FIELDS_HINT)}{maxTripDays !== undefined && i18n.t("guestDaysHint", { ns: "tripCreator/fields", count: maxTripDays })}</p>
              {durationTooLong && <p role="alert">{i18n.t("guestDaysError", { ns: "tripCreator/fields", count: maxTripDays })}</p>}
            </div>
          )}

          {needs("travelers") && (
            <TextField
              label={FIELD_COPY.travelers.title}
              type="number"
              fullWidth
              error={!!errors.travelers}
              helperText={
                (errors.travelers?.message ? i18n.t(errors.travelers?.message!) : undefined) ?? FIELD_COPY.travelers.helper
              }
              slotProps={{ htmlInput: { min: 1, max: 50 } }}
              {...register("travelers")}
            />
          )}

          {needs("budget") && (
            <div className="requirements-group">
              <span className="requirements-legend">{FIELD_COPY.budget.title}</span>

              <Controller
                control={control}
                name="budgetChoice"
                render={({ field }) => (
                  <div className="requirements-options">
                    {[...BUDGET_SUGGESTIONS, CUSTOM_BUDGET_OPTION].map(
                      (option) => (
                        <button
                          key={option.id}
                          type="button"
                          className={`requirements-option${
                            field.value === option.id ? " is-active" : ""
                          }`}
                          aria-pressed={field.value === option.id}
                          onClick={() => field.onChange(option.id)}
                        >
                          {option.label}
                        </button>
                      ),
                    )}
                  </div>
                )}
              />

              {errors.budgetChoice && (
                <p className="requirements-error">
                  {i18n.t(errors.budgetChoice.message ?? "errors:validation")}
                </p>
              )}

              {watch("budgetChoice") === CUSTOM_BUDGET_ID && (
                <div className="requirements-budget-custom">
                  <TextField
                    label={i18n.t("myBudget", { ns: "tripCreator/fields" })}
                    type="number"
                    error={!!errors.budgetAmount}
                    helperText={(errors.budgetAmount?.message ? i18n.t(errors.budgetAmount?.message!) : undefined)}
                    slotProps={{ htmlInput: { min: 0 } }}
                    {...register("budgetAmount")}
                  />

                  <Controller
                    control={control}
                    name="budgetCurrency"
                    render={({ field }) => (
                      <TextField
                        label={i18n.t("currency", { ns: "common" })}
                        select
                        error={!!errors.budgetCurrency}
                        helperText={(errors.budgetCurrency?.message ? i18n.t(errors.budgetCurrency?.message!) : undefined)}
                        value={field.value}
                        onChange={field.onChange}
                      >
                        {CURRENCY_OPTIONS.map((currency) => (
                          <MenuItem key={currency} value={currency}>
                            {currency}
                          </MenuItem>
                        ))}
                      </TextField>
                    )}
                  />

                  <Controller
                    control={control}
                    name="budgetType"
                    render={({ field }) => (
                      <TextField
                        label={i18n.t("budgetIs", { ns: "tripCreator/fields" })}
                        select
                        value={field.value}
                        onChange={field.onChange}
                      >
                        {BUDGET_TYPE_OPTIONS.map((option) => (
                          <MenuItem key={option.value} value={option.value}>
                            {option.label}
                          </MenuItem>
                        ))}
                      </TextField>
                    )}
                  />
                </div>
              )}
            </div>
          )}

          {needs("interests") && (
            <div className="requirements-group">
              <span className="requirements-legend">
                {FIELD_COPY.interests.title}
              </span>

              <Controller
                control={control}
                name="interests"
                render={({ field }) => {
                  const custom = field.value.filter(
                    (interest) =>
                      !INTEREST_OPTIONS.some((option) => option.id === interest),
                  );

                  return (
                    <>
                      <div className="requirements-tags">
                        {INTEREST_OPTIONS.map((option) => {
                          const Icon = interestIcon(option.id);
                          const selected = field.value.includes(option.id);

                          return (
                            <button
                              key={option.id}
                              type="button"
                              className={`requirements-tag${
                                selected ? " is-active" : ""
                              }`}
                              aria-pressed={selected}
                              onClick={() =>
                                field.onChange(
                                  selected
                                    ? field.value.filter(
                                        (interest) => interest !== option.id,
                                      )
                                    : [...field.value, option.id],
                                )
                              }
                            >
                              {Icon ? <Icon /> : null}
                              {option.label}
                            </button>
                          );
                        })}
                      </div>

                      {custom.length > 0 && (
                        <div className="requirements-chosen">
                          {custom.map((interest) => (
                            <span
                              key={interest}
                              className="requirements-chosen-tag"
                            >
                              {interest}
                              <button
                                type="button"
                                aria-label={i18n.t("remove", { ns: "tripCreator/fields", value0: interest })}
                                onClick={() =>
                                  field.onChange(
                                    field.value.filter((id) => id !== interest),
                                  )
                                }
                              >
                                <CloseOutlined fontSize="small" />
                              </button>
                            </span>
                          ))}
                        </div>
                      )}
                    </>
                  );
                }}
              />

              <div className="requirements-interest-add">
                <TextField
                  label={i18n.t("addYourOwn", { ns: "tripCreator/fields" })}
                  size="small"
                  value={interestDraft}
                  error={!!errors.interests}
                  helperText={
                    (errors.interests?.message ? i18n.t(errors.interests?.message!) : undefined) ?? FIELD_COPY.interests.helper
                  }
                  onChange={(event) => setInterestDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      addInterest(interestDraft);
                    }
                  }}
                />
                <Button
                  type="button"
                  variant="outlined"
                  startIcon={<AddOutlined />}
                  disabled={interestDraft.trim().length === 0}
                  onClick={() => addInterest(interestDraft)}
                >
                  {i18n.t("add", { ns: "common" })}</Button>
              </div>
            </div>
          )}

          <div className="requirements-group">
            <span className="requirements-legend">{i18n.t(PACE_TITLE)}</span>
            <Controller
              control={control}
              name="pace"
              render={({ field }) => (
                <div className="pref-slider-options">
                  {PACE_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      className={`pref-slider-option${
                        field.value === option.value ? " is-active" : ""
                      }`}
                      aria-pressed={field.value === option.value}
                      onClick={() => field.onChange(option.value)}
                    >
                      {paceLabel(option.value)}
                    </button>
                  ))}
                </div>
              )}
            />
          </div>

          <TextField
            label={i18n.t(WALKING_TITLE)}
            type="number"
            fullWidth
            error={!!errors.maxWalkingDistanceKm}
            helperText={
              (errors.maxWalkingDistanceKm?.message ? i18n.t(errors.maxWalkingDistanceKm?.message!) : undefined) ?? i18n.t(WALKING_HELPER)
            }
            slotProps={{ htmlInput: { min: 0, max: 100 } }}
            {...register("maxWalkingDistanceKm")}
          />

          <TextField
            label={i18n.t(NOTES_TITLE)}
            multiline
            minRows={3}
            fullWidth
            error={!!errors.notes}
            helperText={(errors.notes?.message ? i18n.t(errors.notes?.message!) : undefined) ?? i18n.t(NOTES_HELPER)}
            {...register("notes")}
          />

          {error && <p className="requirements-error is-server">{resolveMessage(error)}</p>}
        </DialogContent>

        <DialogActions className="requirements-actions">
          <Button type="button" onClick={onClose} disabled={isSaving}>
            {t("cancel", { ns: "common" })}
          </Button>
          <Button
            type="submit"
            variant="contained"
            disabled={!isValid || isSaving}
          >
            {isSaving ? i18n.t("saving", { ns: "tripCreator/fields" }) : i18n.t("continue", { ns: "tripCreator/fields" })}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
