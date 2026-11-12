"use client";

import { Eye, EyeOff } from "lucide-react";
import { ComponentPropsWithoutRef, forwardRef, useState } from "react";
import { Input } from "@/components/ui/input";

export const PasswordInput = forwardRef<HTMLInputElement, ComponentPropsWithoutRef<typeof Input>>(function PasswordInput(
  { className = "", ...props }, ref
) {
  const [showPassword, setShowPassword] = useState(false);

  return (
    <div style={{ position: "relative" }}>
      <Input
        {...props}
        ref={ref}
        type={showPassword ? "text" : "password"}
        className={`${className} pr-10`.trim()}
        aria-label={props["aria-label"] ?? "密码"}
      />
      <button
        type="button"
        aria-label={showPassword ? "隐藏密码" : "显示密码"}
        onClick={() => setShowPassword((current) => !current)}
        onMouseDown={(event) => event.preventDefault()}
        style={{
          position: "absolute",
          right: 8,
          top: "50%",
          transform: "translateY(-50%)",
          display: "grid",
          placeItems: "center",
          width: 28,
          height: 28,
          border: "none",
          borderRadius: 8,
          background: "transparent",
          color: "#5a5f6f",
          cursor: "pointer"
        }}
      >
        {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>
    </div>
  );
});
