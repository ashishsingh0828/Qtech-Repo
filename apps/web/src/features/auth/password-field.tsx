import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";
import { IconButton, Input, Label } from "../../components/ui";

export function PasswordField({
  id,
  label,
  value,
  onChange,
  autoComplete,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: string;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input
          id={id}
          type={visible ? "text" : "password"}
          value={value}
          autoComplete={autoComplete}
          onChange={(event) => onChange(event.target.value)}
          className="pr-12"
        />
        <IconButton
          label={visible ? "Hide password" : "Show password"}
          className="absolute right-0 top-0"
          onClick={() => setVisible((current) => !current)}
        >
          {visible ? <EyeOff className="size-4" strokeWidth={1.5} /> : <Eye className="size-4" strokeWidth={1.5} />}
        </IconButton>
      </div>
    </div>
  );
}
