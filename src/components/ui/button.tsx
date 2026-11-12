import { ButtonHTMLAttributes, forwardRef } from "react";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "default" | "outline" | "subtle" | "destructive";
  size?: "default" | "small";
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "default", size = "default", className = "", ...props }, ref
) {
  return <button
    ref={ref}
    className={`button-primary ui-button-${variant} ui-button-${size} ${className}`.trim()}
    {...props}
  />;
});
