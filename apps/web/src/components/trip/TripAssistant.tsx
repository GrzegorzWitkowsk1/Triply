import { useTranslation } from "react-i18next";
import i18n, { getSelectedLanguage } from "../../i18n";
import { createPortal } from "react-dom";
import { useEffect, useRef, useState } from "react";
import { ChatOutlined, CloseOutlined, SendOutlined } from "@mui/icons-material";
import { Modal, useMediaQuery } from "@mui/material";
import type {
  AssistantMessage,
  AssistantMessageRequest,
  ItineraryDay,
} from "@triply/shared";
import { useTripAssistant } from "../../hooks/useTripAssistant";
import AssistantProposalCard from "./AssistantProposalCard";

interface TripAssistantProps {
  city: string;
  tripId: string;
  selectedDayId: string;
  itineraryVersion?: number;
  days?: ItineraryDay[];
  triggerHost?: HTMLElement | null;
}
// A trip change creates fresh local request/draft state, including with direct prop updates.
export default function TripAssistant(props: TripAssistantProps) {
  return <AssistantPanel key={props.tripId} {...props} />;
}

function AssistantPanel({
  city,
  tripId,
  selectedDayId,
  itineraryVersion,
  triggerHost,
}: TripAssistantProps) {
  const { t } = useTranslation("assistant", { i18n });
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState<AssistantMessage | null>(null);
  const [failed, setFailed] = useState<AssistantMessageRequest | null>(null);
  const [providerRetryable, setProviderRetryable] = useState(true);
  const [networkError, setNetworkError] = useState(false);
  const sendLock = useRef(false);
  const mounted = useRef(true);
  const assistant = useTripAssistant(tripId, open);
  const narrow = useMediaQuery("(max-width: 1023px)");
  const chatRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const saved = assistant.history.data?.messages ?? [];
  const messages = [
    ...saved,
    ...(pending && !saved.some((m) => m.id === pending.id) ? [pending] : []),
  ];
  const typing = sendLock.current && pending !== null;
  const actionBusy = assistant.apply?.isPending || assistant.cancel?.isPending;
  const proposals = assistant.history.data?.proposals ?? [];
  const persistedFailure = saved.at(-1)?.failed ? saved.at(-2) : undefined;
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!open || !viewport) return;
    const resize = () => {
      panelRef.current?.style.setProperty(
        "--assistant-height",
        `${viewport.height}px`,
      );
      panelRef.current?.style.setProperty(
        "--assistant-top",
        `${viewport.offsetTop}px`,
      );
    };
    resize();
    viewport.addEventListener("resize", resize);
    viewport.addEventListener("scroll", resize);
    return () => {
      viewport.removeEventListener("resize", resize);
      viewport.removeEventListener("scroll", resize);
    };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    if (!narrow) panelRef.current?.focus();
    return () => {
      triggerRef.current?.focus();
    };
  }, [open, narrow]);
  useEffect(() => {
    if (chatRef.current)
      chatRef.current.scrollTop = chatRef.current.scrollHeight;
  }, [messages.length, typing]);

  const send = async (text: string, retry = false) => {
    const trimmed = text.trim();
    if (
      !trimmed ||
      sendLock.current ||
      actionBusy ||
      assistant.history.isLoading ||
      assistant.history.error
    )
      return;
    const request: AssistantMessageRequest =
      retry && failed
        ? {
            ...failed,
            ...(failed.retryMessageId ? { locale: getSelectedLanguage() } : {}),
          }
        : {
            message: trimmed,
            locale: getSelectedLanguage(),
            requestId: crypto.randomUUID(),
            conversationId: assistant.history.data?.conversationId,
            selectedDayId,
            timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            ...(retry && persistedFailure
              ? { retryMessageId: persistedFailure.id }
              : {}),
          };
    sendLock.current = true;
    setNetworkError(false);
    const sentDraft = input.trim() === trimmed;
    if (sentDraft) setInput("");
    const optimistic = {
      id: request.retryMessageId ?? request.requestId!,
      role: "user" as const,
      text: trimmed,
    };
    setPending(optimistic);
    try {
      const result = await assistant.send.mutateAsync(request);
      if (!mounted.current) return;
      setPending(null);
      if (result.response.type === "error") {
        if (sentDraft) setInput((current) => current || text);
        setProviderRetryable(result.response.retryable);
        setFailed({
          ...request,
          requestId: crypto.randomUUID(),
          retryMessageId: result.messages.at(-2)?.id,
        });
      } else {
        setFailed(null);
      }
    } catch {
      if (mounted.current) {
        if (sentDraft) setInput((current) => current || text);
        setFailed(request);
        setNetworkError(true);
        setProviderRetryable(true);
      }
    } finally {
      sendLock.current = false;
      if (mounted.current)
        setPending((current) => (current ? { ...current } : null));
    }
  };
  const retryText = failed?.message ?? persistedFailure?.text;
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
  const panel = (
    <div
      ref={panelRef}
      id="trip-assistant-panel"
      className="assistant-panel"
      tabIndex={-1}
      role={narrow ? "dialog" : "complementary"}
      aria-modal={narrow || undefined}
      aria-label={t("panelLabel", { city })}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          setOpen(false);
        }
      }}
    >
      <div className="assistant-top">
        <h2 className="assistant-title">{t("panelTitle", { city })}</h2>
        <button
          type="button"
          className="assistant-close"
          onClick={() => setOpen(false)}
          aria-label={t("closeAssistant")}
        >
          <CloseOutlined />
        </button>
      </div>
      <div
        className="assistant-chat"
        ref={chatRef}
        role="log"
        aria-label={t("panelLabel", { city })}
        aria-live="polite"
        aria-relevant="additions text"
        aria-busy={typing || assistant.history.isLoading}
      >
        {!messages.length && (
          <div className="assistant-bubble is-ai is-intro">{t("intro")}</div>
        )}
        {messages.map((message) => (
          <div
            key={message.id}
            className={`assistant-bubble is-${message.role}`}
          >
            {message.text}
            {message.proposalId && proposals.filter(p => p.proposalId === message.proposalId).map(proposal => (
              <AssistantProposalCard key={proposal.proposalId} proposal={proposal} itineraryVersion={itineraryVersion}
                disabled={typing || Boolean(actionBusy)}
                onConfirm={id => assistant.apply.mutateAsync(id)} onCancel={id => assistant.cancel.mutateAsync(id)} />
            ))}
          </div>
        ))}
        {(typing || assistant.history.isLoading) && (
          <div
            className="assistant-bubble is-ai"
            role="status"
            aria-label={i18n.t("loading", { ns: "common" })}
          >
            <span className="assistant-typing" />
          </div>
        )}
      </div>
      <div className="assistant-composer">
        {assistant.history.error && (
          <p className="assistant-error" role="alert">
            {t("couldNotLoadConversationHistoryCloseAndReopen")}{" "}
            <button
              type="button"
              onClick={() => void assistant.history.refetch()}
            >
              {t("retryMessage")}
            </button>
          </p>
        )}
        {networkError && (
          <p className="assistant-error" role="alert">
            {t("couldNotSendYourMessagePleaseTryAgain")}
          </p>
        )}
        {retryText && providerRetryable && (
          <button
            type="button"
            className="assistant-suggestion"
            disabled={typing || actionBusy}
            onClick={() => void send(retryText, true)}
          >
            {t("retryMessage")}
          </button>
        )}
        <div className="assistant-suggestions">
          {[0, 1, 2].map((index) => (
            <button
              key={index}
              type="button"
              className="assistant-suggestion"
              disabled={
                typing ||
                actionBusy ||
                assistant.history.isLoading ||
                Boolean(assistant.history.error)
              }
              onClick={() => void send(t(`suggestion_${index}`))}
            >
              {t(`suggestion_${index}`)}
            </button>
          ))}
        </div>
        <div className="assistant-divider" />
        <div className="assistant-input-row">
          <input
            className="assistant-input"
            aria-label={t("messageInput")}
            enterKeyHint="send"
            value={input}
            maxLength={2000}
            placeholder={t("itWillRainTomorrowWhatWeShouldChange")}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.nativeEvent.isComposing)
                void send(
                  input,
                  Boolean(retryText && input.trim() === retryText),
                );
            }}
          />
          <button
            type="button"
            className="assistant-send"
            onClick={() =>
              void send(input, Boolean(retryText && input.trim() === retryText))
            }
            disabled={
              !input.trim() ||
              typing ||
              actionBusy ||
              assistant.history.isLoading ||
              Boolean(assistant.history.error)
            }
            aria-label={t("sendMessage")}
          >
            <SendOutlined />
          </button>
        </div>
      </div>
    </div>
  );
  return (
    <>
      {triggerHost ? createPortal(trigger, triggerHost) : trigger}
      {open &&
        (narrow ? (
          <Modal
            open
            disableScrollLock
            sx={{ zIndex: 1500 }}
            onClose={() => setOpen(false)}
            slotProps={{ backdrop: { className: "assistant-overlay" } }}
          >
            {panel}
          </Modal>
        ) : (
          panel
        ))}
    </>
  );
}
