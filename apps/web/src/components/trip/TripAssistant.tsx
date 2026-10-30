import { resolveMessage } from "../../i18n/errors";
import { useTranslation } from "react-i18next";
import i18n from "../../i18n";
import { createPortal } from "react-dom";
import { useEffect, useRef, useState } from "react";
import { ChatOutlined, CloseOutlined, SendOutlined } from "@mui/icons-material";

import { Button, Dialog, DialogTitle, DialogContent, DialogActions, Modal, useMediaQuery } from "@mui/material";
import type { AssistantMessageRequest, AssistantResponse, ItineraryDay } from "@triply/shared";
import AttractionPicker from "./AttractionPicker";
import RegenerateDayDialog from "./RegenerateDayDialog";
import { useTripAssistant } from "../../hooks/useTripAssistant";
import { useApplyRegeneration } from "../../hooks/useTripRegeneration";

interface ChatMessage {
  id: number | string;
  role: "ai" | "user";
  text: string;
}

interface TripAssistantProps {
  city: string;
  tripId: string;
  selectedDayId: string;
  itineraryVersion?: number;
  days?: ItineraryDay[];
  triggerHost?: HTMLElement | null;
}

const INTRO_MESSAGE =
  "Ask me anything about your trip — rain plans, cheaper days, shorter walks.";

const SUGGESTIONS = ["Plan for rain", "Make it cheaper", "Less Walking"];

export default function TripAssistant({ city, tripId, selectedDayId, itineraryVersion, days, triggerHost }: TripAssistantProps) {
  const { t } = useTranslation("assistant", { i18n });
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([
    { id: 0, role: "ai", text: INTRO_MESSAGE },
  ]);
  const [input, setInput] = useState("");
  const [typing, setTyping] = useState(false);
  const narrow = useMediaQuery("(max-width: 1023px)");
  const sendLock = useRef(false);
  const confirmLock = useRef(false);
  const [sendError, setSendError] = useState(false);
  const chatRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const assistant = useTripAssistant(tripId, open);
  const regeneration = useApplyRegeneration();
  const [proposal, setProposal] = useState<Extract<AssistantResponse, { type: "action_preview" }> | null>(null);
  const staleProposal = proposal?.actionType === "regenerate_day" && itineraryVersion !== undefined && proposal.preview.baseItineraryVersion !== itineraryVersion;
  const [actionError, setActionError] = useState<string | null>(null);
  const [picker, setPicker] = useState<Extract<AssistantResponse, { type: "clarification" }>["picker"]>(undefined);
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!open || !viewport) return;
    const resize = () => {
      panelRef.current?.style.setProperty("--assistant-height", `${viewport.height}px`);
      panelRef.current?.style.setProperty("--assistant-top", `${viewport.offsetTop}px`);
    };
    resize(); viewport.addEventListener("resize", resize); viewport.addEventListener("scroll", resize);
    return () => { viewport.removeEventListener("resize", resize); viewport.removeEventListener("scroll", resize); };
  }, [open]);
  useEffect(() => {
    if (assistant.history.data?.messages.length) setMessages(assistant.history.data.messages);
  }, [assistant.history.data]);
  useEffect(() => {
    if (assistant.history.error) setMessages(current => [...current, { id: Date.now(), role: "ai", get text() { return i18n.t("couldNotLoadConversationHistoryCloseAndReopen", { ns: "assistant" }); } }]);
  }, [assistant.history.error]);

  useEffect(() => {
    if (!open) return;
    if (!narrow) panelRef.current?.focus();
    return () => { triggerRef.current?.focus(); };
  }, [open]);

  useEffect(() => {
    if (!chatRef.current) return;
    chatRef.current.scrollTop = chatRef.current.scrollHeight;
  }, [messages, typing]);

  const send = async (text: string, candidate?: AssistantMessageRequest["candidate"]) => {
    const trimmed = text.trim();
    if (!trimmed || sendLock.current || typing || assistant.history.isLoading || proposal) return;
    sendLock.current = true; setSendError(false);
    setMessages(current => [...current.filter(message => message.id !== 0), { id: Date.now(), role: "user", text: trimmed }]);
    setTyping(true);
    try {
      const result = await assistant.send.mutateAsync({ message: trimmed, conversationId: assistant.history.data?.conversationId, selectedDayId, ...(candidate ? { candidate } : {}) });
      setMessages(result.messages);
      setInput(current => current.trim() === trimmed ? "" : current);
      setPicker(result.response.type === "clarification" ? result.response.picker : undefined);
      if (result.response.type === "action_preview") { setActionError(null); setProposal(result.response); }
    } catch {
      setSendError(true);
    } finally { sendLock.current = false; setTyping(false); }
  };
  const confirm = async () => {
    if (!proposal || staleProposal || confirmLock.current || busy) return;
    confirmLock.current = true;
    try {
      if (proposal.actionType === "regenerate_day") await regeneration.mutateAsync({ tripId, dayIndex: proposal.preview.dayIndex, previewId: proposal.preview.previewId });
      else await assistant.apply.mutateAsync(proposal.previewId);
      setMessages(current => [...current, { id: Date.now(), role: "ai", text: i18n.t(proposal.actionType === "expense" ? "confirmedYourExpensesWereUpdated" : "confirmedYourItineraryWasUpdated", { ns: "assistant" }) }]);
      setProposal(null);
    } catch { setActionError("assistant:couldNotApplyThisProposalItMayBe"); }
    finally { confirmLock.current = false; }
  };
  const busy = assistant.apply.isPending || regeneration.isPending || assistant.cancel.isPending;
  const cancelProposal = () => {
    if (busy || !proposal) return;
    const previewId = proposal.actionType === "regenerate_day" ? proposal.preview.previewId : proposal.previewId;
    assistant.cancel.mutate(previewId, { onSuccess: () => setProposal(null), onError: () => setActionError("assistant:couldNotCancelThePreviewPleaseTryAgain") });
  };

  const trigger = (
    <button
        type="button"
        className={`assistant-fab${triggerHost ? " is-inline" : ""}`}
        ref={triggerRef}
        aria-expanded={open}
        aria-controls={open ? "trip-assistant-panel" : undefined}
        onClick={() => setOpen(true)}
        aria-label={t("openLabel")}
      >
        <ChatOutlined />
        <span className="assistant-fab-label">{t("openLabel")}</span>
      </button>
  );
  const panel = <div ref={panelRef} id="trip-assistant-panel" className="assistant-panel" tabIndex={-1}
    role={narrow ? "dialog" : "complementary"} aria-modal={narrow || undefined} aria-label={t("panelLabel", { city })}
    onKeyDown={event => { if (event.key === "Escape" && !proposal && !picker) { event.stopPropagation(); setOpen(false); } }}>
            <div className="assistant-top">
              <h2 className="assistant-title">{i18n.t("panelTitle", { ns: "assistant", city })}</h2>
              <button
                type="button"
                className="assistant-close"
                onClick={() => setOpen(false)}
                aria-label={i18n.t("closeAssistant", { ns: "assistant" })}
              >
                <CloseOutlined />
              </button>
            </div>

            <div className="assistant-chat" ref={chatRef} role="log" aria-label={t("panelLabel", { city })} aria-live="polite" aria-relevant="additions text" aria-busy={typing || assistant.history.isLoading}>
              {messages.map((message) => (
                <div
                  key={message.id}
                  className={`assistant-bubble is-${message.role}${
                    message.id === 0 ? " is-intro" : ""
                  }`}
                >
                  {message.id === 0 ? i18n.t("intro", { ns: "assistant" }) : message.text}
                </div>
              ))}
              {(typing || assistant.history.isLoading) && (
                <div className="assistant-bubble is-ai" role="status" aria-label={i18n.t("loading", { ns: "common" })}>
                  <span className="assistant-typing" />
                </div>
              )}
            </div>

            <div className="assistant-composer">
              {sendError && <p className="assistant-error" role="alert">{t("couldNotSendYourMessagePleaseTryAgain")}</p>}
              <div className="assistant-suggestions">
                {SUGGESTIONS.map((suggestion, index) => (
                  <button
                    key={suggestion}
                    type="button"
                    className="assistant-suggestion"
                    disabled={typing || assistant.history.isLoading || Boolean(proposal)}
                    onClick={() => send(suggestion)}
                  >
                    {t(`suggestion_${index}`)}
                  </button>
                ))}
              </div>
              <div className="assistant-divider" />
              <div className="assistant-input-row">
                <input
                  className="assistant-input"
                  aria-label={i18n.t("messageInput", { ns: "assistant" })}
                  enterKeyHint="send"
                  value={input}
                  maxLength={2000}
                  placeholder={i18n.t("itWillRainTomorrowWhatWeShouldChange", { ns: "assistant" })}
                  onChange={(event) => setInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.nativeEvent.isComposing) send(input);
                  }}
                />
                <button
                  type="button"
                  className="assistant-send"
                  onClick={() => send(input)}
                  disabled={!input.trim() || typing || assistant.history.isLoading || Boolean(proposal)}
                  aria-label={i18n.t("sendMessage", { ns: "assistant" })}
                >
                  <SendOutlined />
                </button>
              </div>
            </div>
          </div>;
  return <>
      <AttractionPicker zIndex={1600} tripId={tripId} open={Boolean(picker)} replace={picker?.replace ?? false} stopCount={picker?.stopCount ?? 0}
        saving={typing} error={null} onClose={() => setPicker(undefined)}
        onConfirm={(attractionId, position) => void send(i18n.t("useTheSelectedAttraction", { ns: "assistant" }), { attractionId, position })} />
      <RegenerateDayDialog zIndex={1600} open={proposal?.actionType === "regenerate_day"} dayNumber={proposal?.actionType === "regenerate_day" ? proposal.preview.dayIndex : 1}
        preview={proposal?.actionType === "regenerate_day" ? proposal.preview : null} isGenerating={false} isApplying={busy} error={resolveMessage(actionError)}
        isStale={staleProposal} originalDay={days?.find(day => proposal?.actionType === "regenerate_day" && day.dayIndex === proposal.preview.dayIndex)}
        onGenerate={() => {}} onApply={() => void confirm()} onEditOptions={cancelProposal} onClose={cancelProposal} />
      <Dialog sx={{ zIndex: 1600 }} open={proposal?.actionType === "edit_itinerary" || proposal?.actionType === "expense"} onClose={busy ? undefined : cancelProposal} fullWidth maxWidth="sm">
        <DialogTitle>{proposal?.actionType === "expense" ? i18n.t("reviewExpenseChange", { ns: "assistant" }) : i18n.t("reviewItineraryChange", { ns: "assistant" })}</DialogTitle>
        <DialogContent>
          <p>{proposal?.message}</p>
          {proposal?.actionType === "edit_itinerary" && proposal.days.map(day => <p key={day.dayIndex}>{i18n.t("actionDay", { ns: "assistant", day: day.dayIndex, summary: day.activities.filter(activity => activity.type === "attraction").map(activity => activity.title + " (" + activity.startTime.slice(11,16) + ")").join(", ") || i18n.t("noAttractions", { ns: "assistant" }) })}</p>)}
          {proposal?.actionType === "edit_itinerary" && proposal.warnings.map(warning => <p key={warning}>{warning}</p>)}
          {actionError && <p role="alert">{resolveMessage(actionError)}</p>}
        </DialogContent>
        <DialogActions><Button disabled={busy} onClick={cancelProposal}>{i18n.t("cancel", { ns: "common" })}</Button><Button disabled={busy} onClick={() => void confirm()}>{i18n.t("applyChanges", { ns: "common" })}</Button></DialogActions>
      </Dialog>
      {triggerHost ? createPortal(trigger, triggerHost) : trigger}
      {open && (narrow ? <Modal open sx={{ zIndex: 1500 }} onClose={() => { if (!proposal && !picker) setOpen(false); }} slotProps={{ backdrop: { className: "assistant-overlay" } }}>{panel}</Modal> : panel)}
    </>;
}
