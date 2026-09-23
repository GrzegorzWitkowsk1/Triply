import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import {
  preferencesSchema,
  type PreferencesFormValues,
} from "../../schemas/profile";

export default function PreferencesCard() {
  const { handleSubmit, formState } = useForm<PreferencesFormValues>({
    resolver: zodResolver(preferencesSchema),
    mode: "onChange",
  });

  const onSubmit = (values: PreferencesFormValues) => {
    void values;
  };

  return (
    <form className="settings-card" onSubmit={handleSubmit(onSubmit)}>
      <p className="settings-placeholder">Placeholder</p>

      <div className="settings-footer">
        <button
          type="submit"
          className="btn btn-primary settings-submit"
          disabled={!formState.isValid}
        >
          Save
        </button>
      </div>
    </form>
  );
}