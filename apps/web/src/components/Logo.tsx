import FlightIcon from "@mui/icons-material/Flight";

export default function Logo() {
  return (
    <span className="logo">
      <span className="logo-badge">
        <FlightIcon
          sx={{ ml: "4px", color: "#ffffff", transform: "rotate(45deg)" }}
          fontSize="small"
        />
      </span>
      <span className="logo-name">Triply</span>
    </span>
  );
}