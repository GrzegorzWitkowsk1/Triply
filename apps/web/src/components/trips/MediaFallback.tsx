import FlightIcon from "@mui/icons-material/Flight";

interface MediaFallbackProps {
  alt: string;
}

export default function MediaFallback({ alt }: MediaFallbackProps) {
  return (
    <div className="media-fallback" role="img" aria-label={alt}>
      <span className="media-fallback-badge">
        <FlightIcon sx={{ color: "#ffffff", transform: "rotate(45deg)" }} />
      </span>
      <span className="media-fallback-name">Triply</span>
    </div>
  );
}
