import { useTranslation } from "react-i18next";
import i18n from "../../i18n";
import { CheckOutlined, FlightTakeoffOutlined } from "@mui/icons-material";
import { PLAN_STAGES, type PlanStageStatus } from "../../config/home";

interface PlanProgressCardProps {
  statuses: PlanStageStatus[];
  isDone: boolean;
}

export default function PlanProgressCard({
  statuses,
  isDone,
}: PlanProgressCardProps) {
  useTranslation();
  return (
    <section
      className="plan-card"
      role="status"
      aria-live="polite"
      aria-busy={!isDone}
    >
      <div className="plan-head">
        <span className="plan-icon" aria-hidden="true">
          <FlightTakeoffOutlined />
        </span>
        <div className="plan-head-text">
          <p className="plan-title">{i18n.t("planningYourTrip", { ns: "tripCreator/home" })}</p>
          <p className="plan-subtitle">{i18n.t("makingEveryDayFeelEffortless", { ns: "tripCreator/home" })}</p>
        </div>
      </div>

      <ol className="plan-stages">
        {PLAN_STAGES.map((stage, index) => {
          const status = statuses[index];
          return (
            <li key={stage.id} className={`plan-stage is-${status}`}>
              <span className="plan-stage-icon" aria-hidden="true">
                {status === "done" ? <CheckOutlined /> : null}
              </span>
              <span className="plan-stage-label">{stage.label}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}