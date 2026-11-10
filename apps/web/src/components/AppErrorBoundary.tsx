import { Component, type PropsWithChildren } from "react";
import { useTranslation } from "react-i18next";
import i18n from "../i18n";

function Recovery({ retry }: { retry: () => void }) {
  const { t } = useTranslation(["errors", "common", "navigation"], { i18n });
  return <main className="trip-page"><section className="trip-inner" role="alert">
    <h1>{t("unexpected", { ns: "errors" })}</h1>
    <p>{t("renderRecovery", { ns: "errors" })}</p>
    <button type="button" onClick={retry}>{t("tryAgain", { ns: "common" })}</button>
    <p><a href="/home">{t("home", { ns: "navigation" })}</a></p>
  </section></main>;
}

/** One explicit retry per click; repeated failures return to the fallback. */
export class AppErrorBoundary extends Component<PropsWithChildren, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    return this.state.failed
      ? <Recovery retry={() => this.setState({ failed: false })} />
      : this.props.children;
  }
}
