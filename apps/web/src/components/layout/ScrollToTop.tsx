import { useEffect } from "react";
import { useLocation } from "react-router-dom";

export default function ScrollToTop() {
  const { pathname } = useLocation();

  useEffect(() => {
    window.scrollTo(0, 0);
    const frame = requestAnimationFrame(() => {
      const main = document.querySelector<HTMLElement>("main");
      if (main) { main.tabIndex = -1; main.focus({ preventScroll: true }); }
    });
    return () => cancelAnimationFrame(frame);
  }, [pathname]);

  return null;
}
