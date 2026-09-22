import { createTheme } from "@mui/material/styles";

const inputRadius = 18;

export const theme = createTheme({
  palette: {
    primary: { main: "#f2664b" },
  },
  typography: {
    fontFamily: '"Segoe UI", system-ui, -apple-system, sans-serif',
  },
  shape: {
    borderRadius: inputRadius,
  },
  components: {
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          borderRadius: inputRadius,
          backgroundColor: "#ffffff",
          boxShadow: "0 2px 10px rgba(0, 0, 0, 0.08)",
          "& .MuiOutlinedInput-notchedOutline": {
            borderColor: "#dcdcdc",
          },
          "&:hover .MuiOutlinedInput-notchedOutline": {
            borderColor: "#c8c8c8",
          },
          "&.Mui-focused .MuiOutlinedInput-notchedOutline": {
            borderColor: "#f2664b",
            borderWidth: 1,
          },
          "& .MuiOutlinedInput-input": {
            padding: "16px",
          },
        },
      },
    },
    MuiInputLabel: {
      styleOverrides: {
        outlined: {
          "&.Mui-focused": {
            color: "#f2664b",
          },
        },
      },
    },
  },
});