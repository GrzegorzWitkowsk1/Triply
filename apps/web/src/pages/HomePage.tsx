import { useRef, useState } from "react";
import {
  ArrowForwardOutlined,
  AttachFileOutlined,
  CloseOutlined,
  MicOutlined,
} from "@mui/icons-material";
import { TextField } from "@mui/material";
import { HOME_BADGES, TRIPS } from "../config/home";
import TripCard from "../components/trips/TripCard";

interface VoiceHint {
  text: string;
  kind: "info" | "error";
}

const VOICE_ERRORS: Record<string, string> = {
  "not-allowed":
    "Microphone permission denied — allow the mic in your browser's address bar, then try again.",
  "no-speech": "No speech detected.",
  "audio-capture": "No microphone found.",
  network: "Speech service unreachable.",
};

function getRecognition(): SpeechRecognition | null {
  const Ctor = SpeechRecognition ?? webkitSpeechRecognition;
  return Ctor ? new Ctor() : null;
}

export default function HomePage() {
  const [prompt, setPrompt] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [listening, setListening] = useState(false);
  const [voiceHint, setVoiceHint] = useState<VoiceHint | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const interimRef = useRef("");
  const hadErrorRef = useRef(false);

  const getOrCreateRecognition = (): SpeechRecognition | null => {
    if (recognitionRef.current) return recognitionRef.current;

    const recognition = getRecognition();
    if (!recognition) {
      setVoiceHint({
        text: "Voice typing isn't supported in this browser",
        kind: "error",
      });
      return null;
    }

    recognition.lang = "en-US";
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onresult = (event) => {
      let finalText = "";
      let interimText = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          finalText += result[0].transcript;
        } else {
          interimText += result[0].transcript;
        }
      }

      setPrompt((prev) => {
        let base = prev;
        if (interimRef.current) {
          base = base.replace(interimRef.current, "");
        }
        const final = finalText.trim();
        const interim = interimText.trim();
        let next = base;
        if (final) {
          next = next ? `${next} ${final}` : final;
        }
        if (interim) {
          next = next ? `${next} ${interim}` : interim;
        }
        return next;
      });

      interimRef.current = interimText.trim();
      if (finalText) {
        setVoiceHint({ text: "Listening…", kind: "info" });
      }
    };

    recognition.onerror = (event) => {
      hadErrorRef.current = true;
      interimRef.current = "";
      setListening(false);
      setVoiceHint({
        text: VOICE_ERRORS[event.error] ?? "Voice input failed.",
        kind: "error",
      });
    };

    recognition.onend = () => {
      if (!hadErrorRef.current) {
        setVoiceHint(null);
      }
      hadErrorRef.current = false;
      interimRef.current = "";
      setListening(false);
      recognitionRef.current = null;
    };

    recognitionRef.current = recognition;
    return recognition;
  };

  const startListening = () => {
    const recognition = getOrCreateRecognition();
    if (!recognition) return;

    setVoiceHint({ text: "Listening…", kind: "info" });
    setListening(true);

    try {
      recognition.start();
    } catch {
      setListening(false);
      setVoiceHint({ text: "Voice input failed to start.", kind: "error" });
      recognitionRef.current = null;
    }
  };

  const toggleVoice = () => {
    if (listening) {
      recognitionRef.current?.stop();
      setListening(false);
      return;
    }
    startListening();
  };

  const onFilesPicked = (list: FileList | null) => {
    if (!list) return;
    setFiles((prev) => [...prev, ...Array.from(list)]);
  };

  return (
    <div className="home-page">
      <div className="home-inner">
        <p className="home-eyebrow">Your next favorite trip starts here</p>
        <h1 className="home-title">Plan a trip you’ll actually enjoy.</h1>
        <p className="home-subtitle">
          Tell Triply where you’re going, what you love, and how you like to
          travel. We’ll take care of the rest.
        </p>

        <div className="prompt-card">
          {files.length > 0 && (
            <div className="attach-chips">
              {files.map((file) => (
                <span key={`${file.name}-${file.lastModified}`} className="attach-chip">
                  <AttachFileOutlined fontSize="small" />
                  {file.name}
                  <button
                    type="button"
                    aria-label={`Remove ${file.name}`}
                    onClick={() =>
                      setFiles((prev) => prev.filter((f) => f !== file))
                    }
                  >
                    <CloseOutlined />
                  </button>
                </span>
              ))}
            </div>
          )}

          <TextField
            fullWidth
            variant="standard"
            multiline
            rows={3}
            placeholder="4 days in Barcelona, €500 budget, I love food and architecture, relaxed place..."
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            slotProps={{ input: { disableUnderline: true } }}
          />
          <div className="prompt-divider" />
          <div className="prompt-tools">
            <div className="prompt-tools-left">
              <input
                ref={fileInputRef}
                type="file"
                multiple
                hidden
                onChange={(e) => {
                  onFilesPicked(e.target.files);
                  e.target.value = "";
                }}
              />
              <button
                type="button"
                className="prompt-icon"
                aria-label="Attachments"
                onClick={() => fileInputRef.current?.click()}
              >
                <AttachFileOutlined />
              </button>
              <button
                type="button"
                className={`prompt-icon${listening ? " is-active" : ""}`}
                aria-label={listening ? "Stop voice writing" : "Voice writing"}
                onClick={toggleVoice}
              >
                <MicOutlined />
              </button>
            </div>
            <button type="button" className="btn btn-primary prompt-submit">
              Plan my trip
              <ArrowForwardOutlined fontSize="small" />
            </button>
          </div>
          {voiceHint && (
            <p className={`prompt-hint is-${voiceHint.kind}`}>{voiceHint.text}</p>
          )}
        </div>

        <div className="home-badges">
          {HOME_BADGES.map((badge) => {
            const Icon = badge.icon;
            return (
              <button
                key={badge.id}
                type="button"
                className="home-badge"
                onClick={() => setPrompt(badge.label)}
              >
                <Icon sx={{ color: badge.color }} fontSize="small" />
                {badge.label}
              </button>
            );
          })}
        </div>

        <section className="home-section">
          <p className="home-eyebrow">Pick up where you left off</p>
          <div className="trips-head">
            <h2 className="trips-title">My trips</h2>
            <button type="button" className="view-all">
              View all
              <ArrowForwardOutlined fontSize="small" />
            </button>
          </div>

          <div className="trips-grid">
            {TRIPS.map((trip, i) => (
              <TripCard key={trip.id} trip={trip} isFirst={i === 0} />
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}